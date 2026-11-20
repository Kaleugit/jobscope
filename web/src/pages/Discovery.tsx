import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api,
  type AtsCompany,
  type DiscoveredJob,
  type DiscoveryRun,
  type DiscoverySettings,
  type JobsPage,
  type JobWindow,
} from "../api";
import { Dots, SkeletonList } from "../common";

// The Owner Area: remote international jobs open to Brazil, collected at 07:00
// and 13:00, filtered by rules and scored by Work Nature. Master account only.

type Tab = "jobs" | "review" | "discarded" | "runs" | "settings";
const TABS: Tab[] = ["jobs", "review", "discarded", "runs", "settings"];
const WINDOWS: { id: JobWindow; label: string }[] = [
  { id: "today", label: "today" },
  { id: "24h", label: "24h" },
  { id: "48h", label: "48h" },
  { id: "7d", label: "7d" },
];

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

const sourceName = (source: string) => source.split(":")[0];

const CONTRACT_LABEL: Record<string, string> = {
  contractor: "contractor",
  eor: "eor",
  full_time_local: "local employee",
  unknown: "contract ?",
};

export function Discovery({ onPromoted }: { onPromoted: () => void }) {
  const [tab, setTab] = useState<Tab>("jobs");
  const [span, setSpan] = useState<JobWindow>("today");
  const [page, setPage] = useState<JobsPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPage(await api.discovery.jobs(span));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [span]);

  useEffect(() => {
    setPage(null);
    void load();
  }, [load]);

  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const promote = (job: DiscoveredJob) =>
    act(job.jobKey, async () => {
      await api.discovery.promote(job.jobKey);
      onPromoted();
    });
  const triage = (job: DiscoveredJob, next: "new" | "ignored") =>
    act(job.jobKey, () => api.discovery.triage(job.jobKey, next));

  return (
    <>
      <section className="block">
        <h2 className="block-label">{"//discovery"}</h2>
        <div className="toggle" role="tablist" aria-label="Discovery sections">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={`toggle-option${t === tab ? " active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
              {page && t === "review" && page.counts.review > 0 && ` (${page.counts.review})`}
            </button>
          ))}
        </div>
        {(tab === "jobs" || tab === "review" || tab === "discarded") && (
          <div className="disc-window">
            <div className="toggle" role="group" aria-label="Published within">
              {WINDOWS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`toggle-option${w.id === span ? " active" : ""}`}
                  aria-pressed={w.id === span}
                  onClick={() => setSpan(w.id)}
                >
                  {w.label}
                </button>
              ))}
            </div>
            {page && (
              <span className="block-note disc-counts">
                {page.counts.main} scored · {page.counts.pending} waiting for the llm · {page.counts.review} to review ·{" "}
                {page.counts.discarded} discarded
              </span>
            )}
          </div>
        )}
      </section>

      {error && (
        <div className="error" role="alert">
          [error] {error}
        </div>
      )}

      {tab === "jobs" && <JobsTab page={page} busy={busy} onPromote={promote} onTriage={triage} />}
      {tab === "review" && <ReviewTab page={page} busy={busy} onPromote={promote} onTriage={triage} />}
      {tab === "discarded" && <DiscardedTab page={page} />}
      {tab === "runs" && <RunsTab onRan={load} />}
      {tab === "settings" && <SettingsTab />}
    </>
  );
}

// ── jobs ─────────────────────────────────────────────────────────────────

type Market = "all" | "international" | "local";
type Bucket = "all" | "confirmed" | "likely";
type TriageFilter = "open" | "new" | "promoted" | "ignored";

function JobsTab({
  page,
  busy,
  onPromote,
  onTriage,
}: {
  page: JobsPage | null;
  busy: string | null;
  onPromote: (job: DiscoveredJob) => void;
  onTriage: (job: DiscoveredJob, next: "new" | "ignored") => void;
}) {
  const [bucket, setBucket] = useState<Bucket>("all");
  const [market, setMarket] = useState<Market>("all");
  const [source, setSource] = useState("all");
  const [triage, setTriage] = useState<TriageFilter>("open");

  const visible = useMemo(() => {
    const jobs = (page?.jobs ?? []).filter((j) => !j.discardReason && j.llmStatus !== "review");
    return jobs
      .filter((j) => bucket === "all" || j.latam?.bucket === bucket)
      .filter((j) => market === "all" || (market === "local" ? j.localMarket : !j.localMarket))
      .filter((j) => source === "all" || j.sources.some((s) => sourceName(s.source) === source))
      .filter((j) => (triage === "open" ? j.triage !== "ignored" : j.triage === triage))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.publishedAt.localeCompare(a.publishedAt));
  }, [page, bucket, market, source, triage]);

  const sources = useMemo(
    () => [...new Set((page?.jobs ?? []).flatMap((j) => j.sources.map((s) => sourceName(s.source))))].sort(),
    [page]
  );

  return (
    <section className="block">
      <div className="disc-filters">
        <label className="field">
          <span>latam</span>
          <select value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)}>
            <option value="all">confirmed + likely</option>
            <option value="confirmed">confirmed</option>
            <option value="likely">likely</option>
          </select>
        </label>
        <label className="field">
          <span>market</span>
          <select value={market} onChange={(e) => setMarket(e.target.value as Market)}>
            <option value="all">all</option>
            <option value="international">international</option>
            <option value="local">local (brl)</option>
          </select>
        </label>
        <label className="field">
          <span>source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">all</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>status</span>
          <select value={triage} onChange={(e) => setTriage(e.target.value as TriageFilter)}>
            <option value="open">new + promoted</option>
            <option value="new">new</option>
            <option value="promoted">promoted</option>
            <option value="ignored">ignored</option>
          </select>
        </label>
      </div>

      {page === null && <SkeletonList />}
      {page !== null && visible.length === 0 && (
        <p className="empty">no jobs in this window with these filters. try 24h or 48h.</p>
      )}
      {visible.length > 0 && (
        <ul className="apps">
          {visible.map((job) => (
            <JobRow key={job.jobKey} job={job} busy={busy === job.jobKey} onPromote={onPromote} onTriage={onTriage} />
          ))}
        </ul>
      )}
    </section>
  );
}

function JobRow({
  job,
  busy,
  onPromote,
  onTriage,
  note,
}: {
  job: DiscoveredJob;
  busy: boolean;
  onPromote?: (job: DiscoveredJob) => void;
  onTriage?: (job: DiscoveredJob, next: "new" | "ignored") => void;
  note?: string;
}) {
  const scored = typeof job.score === "number";
  return (
    <li className="app-row disc-row">
      <div className={`disc-score${scored && job.score! >= 80 ? " high" : ""}`} aria-label={scored ? `score ${job.score}` : "not scored yet"}>
        {scored ? job.score : "··"}
      </div>
      <div className="app-main">
        <span className="app-title">
          <span className="app-role">{job.title}</span>
          <span className="app-company">
            {" //"}
            {job.company}
          </span>
          {job.sources.map((s) => (
            <a key={`${s.source}#${s.externalId}`} className="app-link" href={s.url} target="_blank" rel="noreferrer">
              [{sourceName(s.source)}]
            </a>
          ))}
        </span>
        <span className="tags">
          <span className={`tag disc-latam ${job.latam?.bucket ?? "unknown"}`}>
            [latam {job.latam?.bucket ?? "?"}
            {job.latam?.decidedBy === "llm" ? " · llm" : ""}]
          </span>
          {job.locationRaw && <span className="tag">[{job.locationRaw.length > 60 ? `${job.locationRaw.slice(0, 57)}…` : job.locationRaw}]</span>}
          {job.contractType && <span className="tag">[{CONTRACT_LABEL[job.contractType]}]</span>}
          {job.timezoneRequirement && <span className="tag">[tz {job.timezoneRequirement}]</span>}
          {job.salary && <span className="tag">[{job.salary}]</span>}
          {job.agency && <span className="tag">[agency]</span>}
          {job.localMarket && <span className="tag">[local market]</span>}
          <span className="tag">[{ago(job.publishedAt)} ago]</span>
          {job.alertedAt && <span className="tag">[e-mailed]</span>}
        </span>
        {job.scoreReason && <span className="disc-reason">{job.scoreReason}</span>}
        {!scored && job.llmStatus === "pending" && !note && <span className="tags pending">waiting for the llm score...</span>}
        {job.latam?.evidence && <span className="disc-evidence">“{job.latam.evidence}”</span>}
        {note && <span className="disc-note">{note}</span>}
      </div>
      <div className="app-actions disc-actions">
        {busy && <Dots />}
        {!busy && job.triage === "promoted" && (
          <a className="app-link" href="#/applications">
            [{job.applicationStatus ?? "application"}]
          </a>
        )}
        {!busy && job.triage !== "promoted" && onPromote && (
          <button type="button" className="ghost-btn disc-promote" onClick={() => onPromote(job)} title="Track as an application (wishlist)">
            [promote]
          </button>
        )}
        {!busy && job.triage === "new" && onTriage && (
          <button type="button" className="ghost-btn" onClick={() => onTriage(job, "ignored")}>
            [ignore]
          </button>
        )}
        {!busy && job.triage === "ignored" && onTriage && (
          <button type="button" className="ghost-btn disc-promote" onClick={() => onTriage(job, "new")}>
            [restore]
          </button>
        )}
      </div>
    </li>
  );
}

// ── review and discarded ─────────────────────────────────────────────────

function ReviewTab({
  page,
  busy,
  onPromote,
  onTriage,
}: {
  page: JobsPage | null;
  busy: string | null;
  onPromote: (job: DiscoveredJob) => void;
  onTriage: (job: DiscoveredJob, next: "new" | "ignored") => void;
}) {
  const jobs = (page?.jobs ?? []).filter((j) => j.llmStatus === "review" && !j.discardReason);
  return (
    <section className="block">
      <p className="block-note">
        jobs whose llm answer failed the deterministic checks (invalid output, or a latam quote not found in the posting). open the posting and decide.
      </p>
      {page === null && <SkeletonList />}
      {page !== null && jobs.length === 0 && <p className="empty">nothing to review in this window.</p>}
      {jobs.length > 0 && (
        <ul className="apps">
          {jobs.map((job) => (
            <JobRow key={job.jobKey} job={job} busy={busy === job.jobKey} onPromote={onPromote} onTriage={onTriage} note={job.reviewReason} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Barreira de Experiência: pede 5+ anos (você tem 3)" -> "Barreira de Experiência". */
const reasonGroup = (reason: string) => reason.split(":")[0].trim();

function DiscardedTab({ page }: { page: JobsPage | null }) {
  const [group, setGroup] = useState("all");
  const jobs = (page?.jobs ?? []).filter((j) => j.discardReason);
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of jobs) counts.set(reasonGroup(j.discardReason!), (counts.get(reasonGroup(j.discardReason!)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [jobs]);
  const shown = group === "all" ? jobs : jobs.filter((j) => reasonGroup(j.discardReason!) === group);

  return (
    <section className="block">
      <p className="block-note">every job a filter removed, with the reason. use it to check the rules are not throwing good jobs away.</p>
      {groups.length > 0 && (
        <div className="disc-filters">
          <label className="field">
            <span>reason</span>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="all">all ({jobs.length})</option>
              {groups.map(([g, n]) => (
                <option key={g} value={g}>
                  {g} ({n})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {page === null && <SkeletonList />}
      {page !== null && shown.length === 0 && <p className="empty">nothing discarded in this window.</p>}
      {shown.length > 0 && (
        <ul className="apps">
          {shown.slice(0, 300).map((job) => (
            <li key={job.jobKey} className="app-row">
              <div className="app-main">
                <span className="app-title">
                  <span className="app-role">{job.title}</span>
                  <span className="app-company">
                    {" //"}
                    {job.company}
                  </span>
                  {job.sources.slice(0, 1).map((s) => (
                    <a key={s.url} className="app-link" href={s.url} target="_blank" rel="noreferrer">
                      [{sourceName(s.source)}]
                    </a>
                  ))}
                </span>
                <span className="disc-note">{job.discardReason}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown.length > 300 && <p className="block-note">showing 300 of {shown.length}.</p>}
    </section>
  );
}

// ── runs ─────────────────────────────────────────────────────────────────

function RunsTab({ onRan }: { onRan: () => void }) {
  const [runs, setRuns] = useState<DiscoveryRun[] | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRuns(await api.discovery.runs());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // After a manual start, poll until a newer run shows up finished.
  useEffect(() => {
    if (!started) return;
    const id = setInterval(async () => {
      const list = await api.discovery.runs().catch(() => null);
      if (!list) return;
      setRuns(list);
      if (list[0]?.trigger === "manual" && list[0].finishedAt && Date.now() - new Date(list[0].finishedAt).getTime() < 15 * 60_000) {
        setStarted(false);
        onRan();
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [started, onRan]);

  async function runNow() {
    setError("");
    try {
      await api.discovery.run();
      setStarted(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const last = runs?.[0];
  return (
    <section className="block">
      <div className="disc-window">
        <button type="button" className="boxed-btn" onClick={runNow} disabled={started}>
          {started ? (
            <>
              running
              <Dots />
            </>
          ) : (
            "run now"
          )}
        </button>
        <span className="block-note disc-counts">scheduled at 07:00 and 13:00 (brazil). a run takes a few minutes.</span>
      </div>
      {error && <p className="status-failed">{error}</p>}
      {runs === null && <SkeletonList />}
      {runs !== null && runs.length === 0 && <p className="empty">no runs yet.</p>}
      {last && (
        <div className="disc-run">
          <h3 className="block-label">
            {"//last run "}
            {new Date(last.startedAt).toLocaleString("pt-BR")} ({last.trigger})
          </h3>
          <div className="stats">
            <Stat value={last.newJobs} label="new jobs" />
            <Stat value={last.evaluation?.scored ?? 0} label="scored" />
            <Stat value={last.llmCalls} label="llm calls" />
            <Stat value={last.evaluation?.pending ?? 0} label="still pending" />
            <Stat value={last.alertsSent} label="e-mailed" />
          </div>
          {last.evaluation?.llmStoppedBy && (
            <p className="status-failed">llm stopped by the {last.evaluation.llmStoppedBy === "quota" ? "daily quota" : "per-run cap"}; the rest is scored next run.</p>
          )}
          {last.evaluation?.alertSkipped && <p className="block-note">alert: {last.evaluation.alertSkipped}</p>}
          {last.evaluation?.llmErrors?.map((e) => (
            <p key={e} className="status-failed">llm: {e}</p>
          ))}
          <table className="disc-table">
            <thead>
              <tr>
                <th>source</th>
                <th>jobs</th>
                <th>errors</th>
                <th>time</th>
              </tr>
            </thead>
            <tbody>
              {last.sources.map((s) => (
                <tr key={s.source} className={s.errors ? "has-error" : undefined}>
                  <td>{s.source}</td>
                  <td>{s.fetched}</td>
                  <td title={s.errorMessages?.join("\n")}>{s.errors || ""}</td>
                  <td>{(s.durationMs / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {runs && runs.length > 1 && (
        <ul className="plan-list disc-history">
          {runs.slice(1).map((r) => (
            <li key={r.sk}>
              {new Date(r.startedAt).toLocaleString("pt-BR")} · {r.trigger} · {r.newJobs} new · {r.llmCalls} llm calls · {r.alertsSent} e-mailed
              {r.sources.some((s) => s.errors) && " · source errors"}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

// ── settings ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const [settings, setSettings] = useState<DiscoverySettings | null>(null);
  const [companies, setCompanies] = useState<AtsCompany[] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.discovery.settings(), api.discovery.companies()]);
      setSettings(s);
      setCompanies(c.sort((a, b) => b.latamJobsSeen - a.latamJobsSeen || a.name.localeCompare(b.name)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.discovery.saveSettings({
        alertEmail: String(data.get("alertEmail") ?? ""),
        alertThreshold: Number(data.get("alertThreshold")),
        ownerYears: Number(data.get("ownerYears")),
        adherenceProfile: String(data.get("adherenceProfile") ?? ""),
      });
      setSettings(saved);
      setMessage(
        saved.alertEmailStatus === "pending"
          ? "saved. the next run asks aws to mail a confirmation link to the new address; alerts start once you click it."
          : "saved."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function addCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setMessage("");
    try {
      const added = await api.discovery.addCompany({
        ats: String(data.get("ats")),
        token: String(data.get("token") ?? "").trim(),
        name: String(data.get("name") ?? "").trim(),
      });
      form.reset();
      setMessage(`${added.name} added: the board answered with ${added.openJobs} open jobs.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggle(company: AtsCompany) {
    await api.discovery.setCompanyActive(company.ats, company.token, !company.active);
    await load();
  }

  if (!settings) return <section className="block">{error ? <p className="status-failed">{error}</p> : <SkeletonList />}</section>;

  return (
    <>
      <section className="block">
        <h2 className="block-label">{"//alert and filters"}</h2>
        <form className="form" onSubmit={save}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="alertEmail">alert e-mail</label>
              <input id="alertEmail" name="alertEmail" type="email" defaultValue={settings.alertEmail ?? ""} autoComplete="email" />
              <span className="block-note disc-inline-note">
                {settings.alertEmail
                  ? settings.alertEmailStatus === "verified"
                    ? "verified"
                    : `waiting for the aws confirmation link${settings.verifiedAlertEmail ? `; alerts still go to ${settings.verifiedAlertEmail}` : ""}`
                  : "no alerts"}
              </span>
            </div>
            <div className="field">
              <label htmlFor="alertThreshold">alert from score</label>
              <input id="alertThreshold" name="alertThreshold" type="number" min={0} max={100} defaultValue={settings.alertThreshold} />
            </div>
            <div className="field">
              <label htmlFor="ownerYears">my years</label>
              <input id="ownerYears" name="ownerYears" type="number" min={0} max={40} defaultValue={settings.ownerYears} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="adherenceProfile">adherence profile (sent to the llm to score jobs; no contact data)</label>
            <textarea id="adherenceProfile" name="adherenceProfile" rows={16} defaultValue={settings.adherenceProfile} />
          </div>
          <div>
            <button type="submit" className="boxed-btn" disabled={saving}>
              {saving ? (
                <>
                  saving
                  <Dots />
                </>
              ) : (
                "save"
              )}
            </button>
          </div>
          {message && <p className="status-done">{message}</p>}
          {error && <p className="status-failed">{error}</p>}
        </form>
      </section>

      <section className="block">
        <h2 className="block-label">{"//ats companies"}</h2>
        <p className="block-note">latam = jobs seen open to brazil. over time this shows which companies really hire here.</p>
        <table className="disc-table">
          <thead>
            <tr>
              <th>company</th>
              <th>ats</th>
              <th>latam / seen</th>
              <th>last latam job</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(companies ?? []).map((c) => (
              <tr key={`${c.ats}#${c.token}`} className={c.active ? undefined : "inactive"}>
                <td>{c.name}</td>
                <td>
                  {c.ats}:{c.token}
                </td>
                <td>
                  {c.latamJobsSeen} / {c.totalJobsSeen}
                </td>
                <td>{c.lastLatamJobAt ? new Date(c.lastLatamJobAt).toLocaleDateString("pt-BR") : "-"}</td>
                <td>
                  <button type="button" className="ghost-btn" onClick={() => toggle(c)}>
                    {c.active ? "[pause]" : "[resume]"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form className="form disc-add" onSubmit={addCompany}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="ats">ats</label>
              <select id="ats" name="ats" defaultValue="greenhouse">
                <option value="greenhouse">greenhouse</option>
                <option value="lever">lever</option>
                <option value="ashby">ashby</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="token">board token</label>
              <input id="token" name="token" required placeholder="e.g. coderoad" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="name">name</label>
              <input id="name" name="name" placeholder="Company" autoComplete="off" />
            </div>
          </div>
          <div>
            <button type="submit" className="boxed-btn">
              add company
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
