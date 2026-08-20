import { useState, type FormEvent } from "react";
import { api, saveSession, type Session } from "../api";
import { Dots } from "../common";

export function Login({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const session = await api.login(
        String(data.get("username") ?? ""),
        String(data.get("password") ?? "")
      );
      saveSession(session);
      // Always land on the dashboard, whatever hash the URL carried in.
      window.location.hash = "#/home";
      onSignedIn(session);
    } catch {
      setError("invalid username or password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login">
      <img
        className="hero-mark"
        src="/mark.jpg"
        alt=""
        width={96}
        height={92}
      />
      <h1>{"<Jobscope>"}</h1>
      <p className="hero-sub">{"//sign in"}</p>

      <form onSubmit={onSubmit} className="form login-form">
        <div className="field">
          <label htmlFor="username">username</label>
          <input
            id="username"
            name="username"
            required
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="password">password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="boxed-btn login-btn" disabled={busy}>
          {busy ? (
            <>
              signing in
              <Dots />
            </>
          ) : (
            "sign in"
          )}
        </button>
        {error && <p className="pipeline-status status-failed">{`> ${error}`}</p>}
      </form>

      <p className="block-note login-note">
        each account has its own workspace. applications, resume and generated
        documents never cross between them.
      </p>
    </section>
  );
}
