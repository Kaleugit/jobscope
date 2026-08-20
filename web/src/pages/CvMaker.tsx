import type { Profile, SkillsSummary } from "../api";

interface CvMakerProps {
  profile: Profile | null;
  summary: SkillsSummary | null;
}

export function CvMaker({ profile, summary }: CvMakerProps) {
  const ready = profile?.analysisStatus === "done";
  const targets = summary?.matches.slice(0, 3) ?? [];

  return (
    <section className="block">
      <h2 className="block-label">{"//cv-maker"}</h2>
      <p className="about-copy">
        tailor your resume to a specific posting: pick one of your saved
        applications and generate a version that leads with the skills that role
        actually asks for.
      </p>

      <p className="pipeline-status build-note">{"> not built yet"}</p>

      <div className="gap-group">
        <h3 className="gap-title">{"//planned"}</h3>
        <ul className="plan-list">
          <li>rewrite your summary for the selected role</li>
          <li>reorder skills so the required ones come first</li>
          <li>flag the requirements your resume never mentions</li>
          <li>export as pdf</li>
        </ul>
      </div>

      <div className="gap-group">
        <h3 className="gap-title">{"//inputs it will use"}</h3>
        <p className="block-note">
          {ready
            ? `resume: ${profile.fileName}`
            : "resume: none uploaded yet"}
        </p>
        {targets.length > 0 ? (
          <ul className="plan-list">
            {targets.map((m) => (
              <li key={m.id}>
                {m.role}
                <span className="app-company">
                  {" //"}
                  {m.company}
                </span>
                <span className="match-detail"> {m.score}% match</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="block-note">no analyzed applications yet</p>
        )}
      </div>
    </section>
  );
}
