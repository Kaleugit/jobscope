import { useEffect, useState } from "react";

export const ROUTES = ["home", "applications", "cv-maker"] as const;
/** Not in the nav on purpose: account management lives behind a known path. */
export const DEV_ROUTE = "dev99";
export type Route = (typeof ROUTES)[number] | typeof DEV_ROUTE;

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === DEV_ROUTE) return DEV_ROUTE;
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : "home";
}

// Hash routing keeps the SPA a single static file on S3, no server rules.
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(currentRoute);

  useEffect(() => {
    const onChange = () => {
      setRoute(currentRoute());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
