import { useEffect, useState } from "react";

// user1 is the shared demo account: it always gets the tour, since every
// visitor behind it is a first-time user. Everyone else sees it once.
const ALWAYS_ONBOARD = "user1";
const seenKey = (username: string) => `jobscope.onboarded.${username}`;

export function shouldOnboard(username: string): boolean {
  if (username === ALWAYS_ONBOARD) return true;
  try {
    return localStorage.getItem(seenKey(username)) === null;
  } catch {
    return false;
  }
}

export function markOnboarded(username: string) {
  if (username === ALWAYS_ONBOARD) return;
  try {
    localStorage.setItem(seenKey(username), new Date().toISOString());
  } catch {
    // Private mode without storage: the tour simply shows again.
  }
}

interface Step {
  label: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    label: "//applications",
    title: "paste a job link",
    body: "that is the only input. the page is read for you and company, role and required skills are filled in.",
  },
  {
    label: "//dashboard",
    title: "upload your resume",
    body: "your skills are matched against every job you saved, so you see what the market asks for and what you are missing.",
  },
  {
    label: "//cv-maker",
    title: "generate the documents",
    body: "add a master profile and get a resume and a cover letter written for one specific posting, one page each.",
  },
];

export function Onboarding({
  username,
  onClose,
}: {
  username: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  function close() {
    markOnboarded(username);
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="How to use Jobscope">
      <div className="tour">
        <div className="tour-head">
          <span className="block-label">{current.label}</span>
          <span className="tour-count">
            {step + 1}/{STEPS.length}
          </span>
        </div>

        <h2 className="tour-title">{current.title}</h2>
        <p className="tour-body">{current.body}</p>

        <div className="tour-actions">
          <button type="button" className="ghost-btn" onClick={close}>
            [skip]
          </button>
          <button
            type="button"
            className="boxed-btn"
            onClick={() => (last ? close() : setStep(step + 1))}
          >
            {last ? "start" : "next"}
          </button>
        </div>

        <p className="tour-hint">press ? in the header to see this again</p>
      </div>
    </div>
  );
}
