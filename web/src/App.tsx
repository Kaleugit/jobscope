import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api,
  type Application,
  type ApplicationStatus,
  type SkillsSummary,
} from "./api";

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  wishlist: "Interesse",
  applied: "Aplicada",
  interview: "Entrevista",
  offer: "Oferta",
  rejected: "Recusada",
};

export default function App() {
  const [apps, setApps] = useState<Application[]>([]);
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
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    try {
      await api.create({
        company: String(data.get("company") ?? ""),
        role: String(data.get("role") ?? ""),
        url: String(data.get("url") ?? "") || undefined,
        status: (data.get("status") as ApplicationStatus) ?? "applied",
        jdText: String(data.get("jdText") ?? "") || undefined,
      });
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
    if (!confirm("Remover esta candidatura?")) return;
    await api.remove(id);
    await refresh();
  }

  const maxCount = summary?.skills[0]?.count ?? 1;

  return (
    <main className="container">
      <header>
        <h1>Jobscope</h1>
        <p>Rastreie candidaturas e descubra as skills mais pedidas nas suas vagas.</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="card">
        <h2>Nova candidatura</h2>
        <form onSubmit={onSubmit} className="form">
          <div className="row">
            <input name="company" placeholder="Empresa" required />
            <input name="role" placeholder="Cargo" required />
          </div>
          <div className="row">
            <input name="url" placeholder="Link da vaga (opcional)" type="url" />
            <select name="status" defaultValue="applied">
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <textarea
            name="jdText"
            rows={5}
            placeholder="Cole a descrição da vaga aqui — a IA extrai as skills automaticamente"
          />
          <button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Adicionar"}
          </button>
        </form>
      </section>

      {summary && summary.skills.length > 0 && (
        <section className="card">
          <h2>Skills mais pedidas</h2>
          <p className="muted">
            {summary.analyzedApplications} de {summary.totalApplications} vagas analisadas pela IA
          </p>
          <ul className="skills">
            {summary.skills.slice(0, 15).map((skill) => (
              <li key={skill.name}>
                <span className="skill-name">{skill.name}</span>
                <span
                  className="bar"
                  style={{ width: `${(skill.count / maxCount) * 100}%` }}
                />
                <span className="count">{skill.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Candidaturas ({apps.length})</h2>
        {apps.length === 0 && <p className="muted">Nenhuma candidatura ainda.</p>}
        <ul className="apps">
          {apps.map((app) => (
            <li key={app.id}>
              <div className="app-main">
                <strong>{app.role}</strong>
                <span className="muted"> · {app.company}</span>
                {app.url && (
                  <a href={app.url} target="_blank" rel="noreferrer"> ↗</a>
                )}
                <div className="tags">
                  {app.analysisStatus === "pending" && (
                    <em className="muted">analisando skills…</em>
                  )}
                  {app.skills?.map((s) => (
                    <span key={s} className="tag">{s}</span>
                  ))}
                </div>
              </div>
              <div className="app-actions">
                <select
                  value={app.status}
                  onChange={(e) =>
                    onStatusChange(app.id, e.target.value as ApplicationStatus)
                  }
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button className="danger" onClick={() => onDelete(app.id)}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
