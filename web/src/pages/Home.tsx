import type { ChangeEvent, RefObject } from "react";
import type { Profile, SkillsSummary } from "../api";
import { Dots } from "../common";

function SkillRow({
  skill,
  maxCount,
  hasProfile,
}: {
  skill: { name: string; count: number; owned: boolean };
  maxCount: number;
  hasProfile: boolean;
}) {
  return (
    <li>
      <span className="skill-name">{skill.name}</span>
      <span className="skill-track">
        <span
          className={`skill-bar${hasProfile && !skill.owned ? " missing" : ""}`}
          style={{ width: `${(skill.count / maxCount) * 100}%` }}
        />
      </span>
      <span className="skill-count">{skill.count}</span>
    </li>
  );
}

interface HomeProps {
  profile: Profile | null;
  summary: SkillsSummary | null;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  onResumeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onResumeDelete: () => void;
}

export function Home({
  profile,
  summary,
  uploading,
  fileInputRef,
  onResumeChange,
  onResumeDelete,
}: HomeProps) {
  const maxCount = summary?.skills[0]?.count ?? 1;

  return (
    <>
      <section className="intro">
        <div className="intro-brand">
          <img
            className="hero-mark"
            src="/mark.jpg"
            alt=""
            width={112}
            height={108}
          />
          <div className="hero-text">
            <h1>{"<Jobscope>"}</h1>
            <p className="hero-sub">{"//job application tracker"}</p>
          </div>
        </div>

        <div className="intro-about">
          <h2 className="block-label">{"//about"}</h2>
          <p className="about-copy">
            paste the link of a job posting. an async pipeline reads the page,
            fills in company and role, and extracts the required skills. upload
            your resume and it shows exactly which of those skills you are
            missing.
          </p>
        </div>
      </section>

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
              upload your resume to unlock the skill gap. it is read by the same
              pipeline that reads job postings.
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
            {profile.analysisStatus === "done" && (
              <p className="profile-meta">
                <span className="profile-identity">
                  {[profile.name, profile.title].filter(Boolean).join(" //")}
                </span>
                {profile.location && ` //${profile.location}`}
              </p>
            )}

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

            {profile.analysisStatus === "done" &&
              (profile.skills?.length ?? 0) > 0 && (
                <details className="skills-drawer">
                  <summary>
                    <span className="drawer-marker" aria-hidden="true" />
                    my skills ({profile.skills!.length})
                  </summary>
                  <div className="tags">
                    {profile.skills!.map((s) => (
                      <span key={s} className="tag">
                        [{s}]
                      </span>
                    ))}
                  </div>
                </details>
              )}
          </div>
        )}
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
            {summary.skills.slice(0, 3).map((skill) => (
              <SkillRow
                key={skill.name}
                skill={skill}
                maxCount={maxCount}
                hasProfile={summary.hasProfile}
              />
            ))}
          </ul>

          {summary.skills.length > 3 && (
            <details className="skills-drawer">
              <summary>
                <span className="drawer-marker" aria-hidden="true" />
                {summary.skills.length - 3} more
              </summary>
              <ul className="skills">
                {summary.skills.slice(3).map((skill) => (
                  <SkillRow
                    key={skill.name}
                    skill={skill}
                    maxCount={maxCount}
                    hasProfile={summary.hasProfile}
                  />
                ))}
              </ul>
            </details>
          )}
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
              <span className="stat-value">{summary.missingSkills.length}</span>
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
                    <span className="app-company">
                      {" //"}
                      {m.company}
                    </span>
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

      {summary && summary.totalApplications === 0 && (
        <section className="block">
          <p className="empty">
            no applications yet. add the first one in{" "}
            <a href="#/applications">{"//applications"}</a>.
          </p>
        </section>
      )}
    </>
  );
}
