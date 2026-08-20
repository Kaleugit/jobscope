import type { Session } from "./api";
import { ROUTES, type Route } from "./useRoute";

const LABELS: Record<string, string> = {
  home: "dashboard",
  applications: "applications",
  "cv-maker": "cv-maker",
};

export function Header({
  route,
  session,
  onSignOut,
}: {
  route: Route;
  session: Session;
  onSignOut: () => void;
}) {
  return (
    <header className="site-header">
      <a className="brand" href="#/home">
        jobscope
      </a>

      <nav className="site-nav" aria-label="Main">
        {ROUTES.map((r) => (
          <a
            key={r}
            href={`#/${r}`}
            className={`nav-link${r === route ? " active" : ""}`}
            aria-current={r === route ? "page" : undefined}
          >
            {"//"}
            {LABELS[r]}
          </a>
        ))}
      </nav>

      <div className="header-meta">
        <a
          href="https://github.com/Kaleugit/jobscope"
          target="_blank"
          rel="noreferrer"
        >
          github
        </a>
        <span className="session-user">{session.username}</span>
        <button type="button" className="ghost-btn" onClick={onSignOut}>
          [sign out]
        </button>
      </div>
    </header>
  );
}
