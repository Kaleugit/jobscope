import { useEffect, useState } from "react";
import type { ApplicationStatus } from "./api";

export const STATUSES: ApplicationStatus[] = [
  "wishlist",
  "applied",
  "interview",
  "offer",
  "rejected",
];

export function hostOf(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

// Dots light up in sequence so a running action never looks frozen.
export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

export function Clock() {
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

export function SkeletonList() {
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
