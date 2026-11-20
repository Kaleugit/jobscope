// Job Alert: one e-mail per run with the new jobs worth an interruption.
// SES in sandbox only delivers to verified addresses, which here is the point:
// it can physically only write to the owner.

import {
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  SendEmailCommand,
  SESv2Client,
} from "@aws-sdk/client-sesv2";
import {
  type DiscoveredJob,
  type DiscoverySettings,
} from "./model";
import type { KeyValueStore } from "./store";

/** Older jobs are not worth an interruption, even if they score high. */
export const ALERT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Confirmed LATAM, international (never Local Market), scored above the limit, never alerted. */
export function alertable(job: DiscoveredJob, threshold: number, now: Date): boolean {
  return (
    job.llmStatus === "done" &&
    !job.discardReason &&
    job.latam?.bucket === "confirmed" &&
    !job.localMarket &&
    (job.score ?? 0) >= threshold &&
    !job.alertedAt &&
    job.triage === "new" &&
    now.getTime() - new Date(job.publishedAt).getTime() <= ALERT_MAX_AGE_MS
  );
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderAlert(jobs: DiscoveredJob[], panelUrl?: string): { subject: string; html: string; text: string } {
  const sorted = [...jobs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const subject =
    sorted.length === 1
      ? `Vaga ${sorted[0].score}: ${sorted[0].title} (${sorted[0].company})`
      : `${sorted.length} vagas com nota alta: ${sorted[0].title} (${sorted[0].score}) e mais`;

  const items = sorted.map((job) => {
    const link = job.sources[0]?.url ?? "";
    const sources = [...new Set(job.sources.map((s) => s.source.split(":")[0]))].join(", ");
    return {
      html: `<li style="margin-bottom:16px">
  <strong>${job.score}</strong> · <a href="${escapeHtml(link)}">${escapeHtml(job.title)}</a> · ${escapeHtml(job.company)}<br>
  <span style="color:#555">${escapeHtml((job.scoreReason ?? "").replace(/\n/g, " "))}</span><br>
  <span style="color:#888;font-size:12px">LATAM: ${escapeHtml(job.latam?.evidence ?? "")} · fonte: ${escapeHtml(sources)}${job.agency ? " · agência" : ""}</span>
</li>`,
      text: `${job.score} · ${job.title} · ${job.company}\n${(job.scoreReason ?? "").replace(/\n/g, " ")}\n${link}\n`,
    };
  });

  const footer = panelUrl ? `<p><a href="${escapeHtml(panelUrl)}">Abrir o painel</a></p>` : "";
  return {
    subject,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px"><ul style="padding-left:18px">${items.map((i) => i.html).join("")}</ul>${footer}</div>`,
    text: items.map((i) => i.text).join("\n") + (panelUrl ? `\nPainel: ${panelUrl}\n` : ""),
  };
}

const ses = new SESv2Client({});

/**
 * Keeps the alert address verified. A new address gets an SES identity (AWS
 * mails it a confirmation link); until it is confirmed, alerts keep going to
 * the last verified address. Returns the address to send to, if any.
 */
export async function ensureVerifiedRecipient(store: KeyValueStore, settings: DiscoverySettings): Promise<string | undefined> {
  const email = settings.alertEmail;
  if (!email) return settings.verifiedAlertEmail;
  if (settings.alertEmailStatus === "verified" && settings.verifiedAlertEmail === email) return email;

  let verified = false;
  try {
    const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    verified = identity.VerifiedForSendingStatus === true;
  } catch (error) {
    if ((error as Error).name !== "NotFoundException") throw error;
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
  }

  if (verified) {
    const next: DiscoverySettings = { ...settings, alertEmailStatus: "verified", verifiedAlertEmail: email, updatedAt: new Date().toISOString() };
    await store.put(next);
    return email;
  }
  if (settings.alertEmailStatus !== "pending") {
    await store.put({ ...settings, alertEmailStatus: "pending", updatedAt: new Date().toISOString() } as DiscoverySettings);
  }
  return settings.verifiedAlertEmail;
}

export interface AlertResult {
  sent: number;
  recipient?: string;
  skipped?: string;
}

/** Sends one e-mail with every alertable job, then marks them so none repeats. */
export async function sendAlerts(
  store: KeyValueStore,
  settings: DiscoverySettings,
  now = new Date(),
  panelUrl = process.env.PANEL_URL
): Promise<AlertResult> {
  const since = new Date(now.getTime() - ALERT_MAX_AGE_MS);
  const jobs = (await store.recentJobs(since)).filter((j) => alertable(j, settings.alertThreshold, now));
  if (jobs.length === 0) return { sent: 0, skipped: "nenhuma vaga acima do limite" };

  const recipient = await ensureVerifiedRecipient(store, settings);
  if (!recipient) return { sent: 0, skipped: "e-mail do alerta ainda não verificado" };

  const { subject, html, text } = renderAlert(jobs, panelUrl);
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: recipient,
      Destination: { ToAddresses: [recipient] },
      Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } } } },
    })
  );
  for (const job of jobs) await store.put({ ...job, alertedAt: now.toISOString() });
  return { sent: jobs.length, recipient };
}

