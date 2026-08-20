import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type AccountSummary, type Session } from "../api";
import { Dots } from "../common";

export function Dev({ session }: { session: Session }) {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await api.accounts());
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setCreating(true);
    setError("");
    try {
      await api.createAccount({
        username: String(data.get("username") ?? ""),
        password: String(data.get("password") ?? ""),
        role: data.get("role") === "dev" ? "dev" : "user",
        note: String(data.get("note") ?? "") || undefined,
      });
      form.reset();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(username: string) {
    if (!confirm(`Delete the account "${username}"? Its workspace data stays in the table.`))
      return;
    await api.deleteAccount(username);
    await refresh();
  }

  return (
    <>
      <section className="block">
        <h2 className="block-label">{"//new account"}</h2>
        <form onSubmit={onCreate} className="form">
          <div className="form-row">
            <div className="field">
              <label htmlFor="acc-username">username</label>
              <input
                id="acc-username"
                name="username"
                required
                minLength={5}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="acc-password">password</label>
              <input
                id="acc-password"
                name="password"
                type="text"
                required
                minLength={5}
                autoComplete="off"
              />
            </div>
            <div className="field status-field">
              <label htmlFor="acc-role">role</label>
              <select id="acc-role" name="role" defaultValue="user">
                <option value="user">user</option>
                <option value="dev">dev</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="acc-note">note (optional)</label>
            <input id="acc-note" name="note" autoComplete="off" />
          </div>
          <button type="submit" className="boxed-btn" disabled={creating}>
            {creating ? (
              <>
                creating
                <Dots />
              </>
            ) : (
              "create account"
            )}
          </button>
          {error && (
            <p className="pipeline-status status-failed">{`> ${error}`}</p>
          )}
        </form>
      </section>

      <section className="block">
        <h2 className="block-label">
          {"//accounts"}
          {accounts && (
            <span className="block-count"> ({accounts.length})</span>
          )}
        </h2>

        {accounts === null && <p className="empty">loading...</p>}

        {accounts && accounts.length > 0 && (
          <ul className="apps">
            {accounts
              .slice()
              .sort((a, b) => a.username.localeCompare(b.username))
              .map((account) => (
                <li key={account.username} className="app-row">
                  <div className="app-main">
                    <span className="app-title">
                      <span className="app-role">{account.username}</span>
                      <span className="app-company">
                        {" //"}
                        {account.role}
                      </span>
                    </span>
                    <span className="tags">
                      {account.note && <span>{account.note}</span>}
                      <span className="match-detail">
                        created {account.createdAt.slice(0, 10)}
                        {account.lastLoginAt
                          ? ` · last login ${account.lastLoginAt.slice(0, 10)}`
                          : " · never signed in"}
                      </span>
                    </span>
                  </div>
                  <div className="app-actions">
                    {account.username !== session.username && (
                      <button
                        className="ghost-btn"
                        onClick={() => onDelete(account.username)}
                      >
                        [x]
                      </button>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </>
  );
}
