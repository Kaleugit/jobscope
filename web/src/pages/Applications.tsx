import type { FormEvent, RefObject } from "react";
import type { Application, ApplicationStatus } from "../api";
import { Dots, SkeletonList, STATUSES, hostOf } from "../common";

interface ApplicationsProps {
  apps: Application[] | null;
  tracked: Application | null;
  saving: boolean;
  appsSectionRef: RefObject<HTMLElement>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onDelete: (id: string) => void;
}

export function Applications({
  apps,
  tracked,
  saving,
  appsSectionRef,
  onSubmit,
  onStatusChange,
  onDelete,
}: ApplicationsProps) {
  return (
    <>
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
                  {"> could not read this posting. the page may block robots."}
                </span>
              )}
            </p>
          )}
        </form>
      </section>

      <section className="block" ref={appsSectionRef}>
        <h2 className="block-label">
          {"//applications"}
          {apps && apps.length > 0 && (
            <span className="block-count"> ({apps.length})</span>
          )}
        </h2>

        {apps === null && <SkeletonList />}

        {apps !== null && apps.length === 0 && (
          <p className="empty">no applications yet. add the first one above.</p>
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
                    <span className="tags pending">reading the posting...</span>
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
                      onStatusChange(app.id, e.target.value as ApplicationStatus)
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
    </>
  );
}
