import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  api,
  type Application,
  type ApplicationStatus,
  type Profile,
  type SkillsSummary,
} from "./api";

const STATUSES: ApplicationStatus[] = [
  "wishlist",
  "applied",
  "interview",
  "offer",
  "rejected",
];

function hostOf(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

// Dots light up in sequence so a running action never looks frozen.
function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time dateTime={now.toISOString()}>
      {now.toLocaleTimeString("en-US", { hour12: true })}
    </time>
  );
}

function SkeletonList() {
  return (
    <ul className="apps" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i} className="app-row">
          <div className="skeleton" style={{ width: "38%" }} />
          <div className="skeleton" style={{ width: "12%" }} />
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [apps, setApps] = useState<Application[] | null>(null);
  const [summary, setSummary] = useState<SkillsSummary | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [trackedId, setTrackedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The application submitted last, surfaced as a status line by the form.
  const tracked = apps?.find((a) => a.id === trackedId) ?? null;
  const appsSectionRef = useRef<HTMLElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, sum, prof] = await Promise.all([
        api.list(),
        api.skillsSummary(),
        api.profile(),
      ]);
      setProfile(prof);
      setApps(
        list.sort((a, b) =>
          (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
        )
      );
      setSummary(sum);
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setApps((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the pipeline is extracting, poll for the result.
  useEffect(() => {
    const analyzing =
      apps?.some((a) => a.analysisStatus === "pending") ||
      profile?.analysisStatus === "pending";
    if (!analyzing) return;
    const id = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(id);
  }, [apps, profile, refresh]);

  async function onResumeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError("");
    try {
      const created = await api.uploadResume(file);
      setProfile(created);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function onResumeDelete() {
    if (!confirm("Delete the uploaded resume and its extracted profile?")) return;
    await api.deleteProfile();
    setProfile(null);
    await refresh();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setTrackedId(null);
    try {
      const created = await api.create({
        url: String(data.get("url") ?? "").trim(),
        status: data.get("status") as ApplicationStatus,
      });
      setTrackedId(created.id);
      form.reset();
      await refresh();
      appsSectionRef.current?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onStatusChange(id: string, status: ApplicationStatus) {
    await api.update(id, { status });
    await refresh();
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this application?")) return;
    await api.remove(id);
    await refresh();
  }

  const maxCount = summary?.skills[0]?.count ?? 1;

  return (
    <div className="frame">
      <header className="meta-grid">
        <div className="meta-cell">
          <span className="meta-label">{"//tracker"}</span>
          <span>jobscope</span>
        </div>
        <div className="meta-cell">
          <span className="meta-label">{"//stack"}</span>
          <span>aws serverless</span>
        </div>
        <div className="meta-cell">
          <span className="meta-label">{"//github"}</span>
          <a
            href="https://github.com/Kaleugit/jobscope"
            target="_blank"
            rel="noreferrer"
          >
            Kaleugit/jobscope
          </a>
        </div>
        <div className="meta-cell">
          <span className="meta-label">{"//local time"}</span>
          <Clock />
        </div>
      </header>

      <main>
        <section className="hero">
          <img className="hero-mark" src="/mark.jpg" alt="" width={112} height={108} />
          <div className="hero-text">
            <h1>{"<Jobscope>"}</h1>
            <p className="hero-sub">{"//job application tracker"}</p>
          </div>
        </section>

        <section className="block">
          <h2 className="block-label">{"//about"}</h2>
          <p className="about-copy">
            paste the link of a job posting. an async pipeline reads the page,
            fills in company and role, and extracts the required skills, so you
            can see what the market keeps asking for.
          </p>
        </section>

        {error && (
          <div className="error" role="alert">
            [error] {error}
          </div>
        )}

        <section className="block">
          <h2 className="block-label">{"//profile"}</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={onResumeChange}
            hidden
          />

          {!profile && (
            <div className="upload-empty">
              <p className="block-note upload-note">
                upload your resume to unlock the skill gap. it is read by the
                same pipeline that reads job postings.
              </p>
              <button
                type="button"
                className="boxed-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    uploading
                    <Dots />
                  </>
                ) : (
                  "upload resume"
                )}
              </button>
            </div>
          )}

          {profile && (
            <div className="profile-card">
              <div className="profile-file">
                <span className="file-name">[file] {profile.fileName}</span>
                <div className="app-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <>
                        [uploading
                        <Dots />]
                      </>
                    ) : (
                      "[replace]"
                    )}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={onResumeDelete}
                  >
                    [delete]
                  </button>
                </div>
              </div>

              {profile.analysisStatus === "pending" && (
                <p className="pipeline-status">
                  {"> reading your resume"}
                  <span className="cursor">█</span>
                </p>
              )}

              {profile.analysisStatus === "failed" && (
                <p className="pipeline-status status-failed">
                  {"> could not read this file. try a text-based pdf."}
                </p>
              )}

              {profile.analysisStatus === "done" && (
                <>
                  <p className="profile-meta">
                    {[
                      profile.name,
                      profile.title,
                      profile.yearsExperience
                        ? `${profile.yearsExperience} years`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" //")}
                  </p>
                  <div className="tags">
                    {profile.skills?.map((s) => (
                      <span key={s} className="tag">
                        [{s}]
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <section className="block">
          <h2 className="block-label">{"//new application"}</h2>
          <form onSubmit={onSubmit} className="form">
            <div className="url-row">
              <div className="field url-field">
                <label htmlFor="url">job posting url</label>
                <input
                  id="url"
                  name="url"
                  type="url"
                  required
                  autoComplete="off"
                  placeholder="https://..."
                />
              </div>
              <div className="field status-field">
                <label htmlFor="status">status</label>
                <select id="status" name="status" defaultValue="applied">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="boxed-btn" disabled={saving}>
                {saving ? (
                  <>
                    saving
                    <Dots />
                  </>
                ) : (
                  "add application"
                )}
              </button>
            </div>

            {(saving || tracked) && (
              <p className="pipeline-status" role="status" aria-live="polite">
                {saving && (
                  <>
                    {"> submitting"}
                    <span className="cursor">█</span>
                  </>
                )}
                {!saving && tracked?.analysisStatus === "pending" && (
                  <>
                    {"> reading the posting, extracting skills"}
                    <span className="cursor">█</span>
                  </>
                )}
                {!saving && tracked?.analysisStatus === "done" && (
                  <span className="status-done">
                    {`> added: ${tracked.role} at ${tracked.company} (${
                      tracked.skills?.length ?? 0
                    } skills)`}
                  </span>
                )}
                {!saving && tracked?.analysisStatus === "failed" && (
                  <span className="status-failed">
                    {
                      "> could not read this posting. the page may block robots."
                    }
                  </span>
                )}
              </p>
            )}
          </form>
        </section>

        {summary && summary.skills.length > 0 && (
          <section className="block">
            <h2 className="block-label">{"//requested skills"}</h2>
            <p className="block-note">
              {summary.analyzedApplications} of {summary.totalApplications}{" "}
              applications analyzed
              {summary.hasProfile && (
                <>
                  {" // "}
                  <span className="legend">
                    <span className="legend-swatch owned" /> you have
                  </span>
                  <span className="legend">
                    <span className="legend-swatch missing" /> gap
                  </span>
                </>
              )}
            </p>
            <ul className="skills">
              {summary.skills.slice(0, 15).map((skill) => (
                <li key={skill.name}>
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-track">
                    <span
                      className={`skill-bar${
                        summary.hasProfile && !skill.owned ? " missing" : ""
                      }`}
                      style={{ width: `${(skill.count / maxCount) * 100}%` }}
                    />
                  </span>
                  <span className="skill-count">{skill.count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary?.hasProfile && summary.matches.length > 0 && (
          <section className="block">
            <h2 className="block-label">{"//skill gap"}</h2>

            <div className="stats">
              <div className="stat">
                <span className="stat-value">{summary.averageMatch}%</span>
                <span className="stat-label">average match</span>
              </div>
              <div className="stat">
                <span className="stat-value">
                  {summary.skills.length - summary.missingSkills.length}/
                  {summary.skills.length}
                </span>
                <span className="stat-label">requested skills covered</span>
              </div>
              <div className="stat">
                <span className="stat-value">
                  {summary.missingSkills.length}
                </span>
                <span className="stat-label">skills to learn</span>
              </div>
            </div>

            {summary.missingSkills.length > 0 && (
              <div className="gap-group">
                <h3 className="gap-title">{"//learn next"}</h3>
                <p className="block-note">
                  most requested skills missing from your resume
                </p>
                <div className="tags">
                  {summary.missingSkills.slice(0, 12).map((s) => (
                    <span key={s.name} className="tag missing">
                      [{s.name} x{s.count}]
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="gap-group">
              <h3 className="gap-title">{"//match per application"}</h3>
              <ul className="matches">
                {summary.matches.map((m) => (
                  <li key={m.id}>
                    <span className="match-role">
                      {m.role}
                      <span className="app-company">{" //"}{m.company}</span>
                    </span>
                    <span className="skill-track">
                      <span
                        className="skill-bar"
                        style={{ width: `${m.score}%` }}
                      />
                    </span>
                    <span className="match-score">
                      {m.score}%
                      <span className="match-detail">
                        {" "}
                        {m.owned}/{m.required}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {summary.unusedSkills.length > 0 && (
              <div className="gap-group">
                <h3 className="gap-title">{"//not requested"}</h3>
                <p className="block-note">
                  skills you have that these roles do not ask for
                </p>
                <div className="tags">
                  {summary.unusedSkills.slice(0, 12).map((s) => (
                    <span key={s} className="tag">
                      [{s}]
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <section className="block" ref={appsSectionRef}>
          <h2 className="block-label">
            {"//applications"}
            {apps && apps.length > 0 && (
              <span className="block-count"> ({apps.length})</span>
            )}
          </h2>

          {apps === null && <SkeletonList />}

          {apps !== null && apps.length === 0 && (
            <p className="empty">
              no applications yet. add the first one above.
            </p>
          )}

          {apps !== null && apps.length > 0 && (
            <ul className="apps">
              {apps.map((app) => (
                <li key={app.id} className="app-row">
                  <div className="app-main">
                    <span className="app-title">
                      <span className="app-role">
                        {app.role || hostOf(app.url) || "job posting"}
                      </span>
                      {app.company && (
                        <span className="app-company">
                          {" //"}
                          {app.company}
                        </span>
                      )}
                      {app.url && (
                        <a
                          className="app-link"
                          href={app.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          [link]
                        </a>
                      )}
                    </span>
                    {app.analysisStatus === "pending" && (
                      <span className="tags pending">
                        reading the posting...
                      </span>
                    )}
                    {app.analysisStatus === "failed" && (
                      <span className="tags pending">
                        could not read this posting. the page may block robots.
                      </span>
                    )}
                    {app.skills && app.skills.length > 0 && (
                      <span className="tags">
                        {app.skills.map((s) => (
                          <span key={s} className="tag">
                            [{s}]
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <div className="app-actions">
                    <select
                      aria-label={`status of ${app.role} at ${app.company}`}
                      value={app.status}
                      onChange={(e) =>
                        onStatusChange(
                          app.id,
                          e.target.value as ApplicationStatus
                        )
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ghost-btn"
                      onClick={() => onDelete(app.id)}
                      aria-label={`delete ${app.role} at ${app.company}`}
                    >
                      [x]
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
