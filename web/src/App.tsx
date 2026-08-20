import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  type Application,
  type ApplicationStatus,
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

  const refresh = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([api.list(), api.skillsSummary()]);
      setApps(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
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
    if (!apps?.some((a) => a.analysisStatus === "pending")) return;
    const id = setTimeout(() => void refresh(), 5000);
    return () => clearTimeout(id);
  }, [apps, refresh]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    try {
      await api.create({ url: String(data.get("url") ?? "").trim() });
      form.reset();
      await refresh();
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
          <h1>{"<Jobscope>"}</h1>
          <p className="hero-sub">{"//job application tracker"}</p>
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
              <button type="submit" className="boxed-btn" disabled={saving}>
                {saving ? "saving..." : "add application"}
              </button>
            </div>
          </form>
        </section>

        {summary && summary.skills.length > 0 && (
          <section className="block">
            <h2 className="block-label">{"//requested skills"}</h2>
            <p className="block-note">
              {summary.analyzedApplications} of {summary.totalApplications}{" "}
              applications analyzed
            </p>
            <ul className="skills">
              {summary.skills.slice(0, 15).map((skill) => (
                <li key={skill.name}>
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-track">
                    <span
                      className="skill-bar"
                      style={{ width: `${(skill.count / maxCount) * 100}%` }}
                    />
                  </span>
                  <span className="skill-count">{skill.count}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="block">
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
