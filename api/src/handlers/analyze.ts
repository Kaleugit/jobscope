import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  ddb,
  masterSk,
  PROFILE_SK,
  TABLE_NAME,
  userPk,
  type Application,
  type Market,
  type MasterProfile,
} from "../lib/db";
import {
  extractJobInfo,
  extractResumeProfile,
  generateDocs,
  type GeneratedDocs,
  type JobInfo,
} from "../lib/llm";
import { buildGenerationPrompt } from "../lib/cv-rules";
import {
  compose,
  estimateHeightPx,
  findEmDashInProse,
  PAGE_USABLE_PX,
  voiceWarnings,
} from "../lib/cv-template";

const s3 = new S3Client({});
const RESUME_BUCKET = process.env.RESUME_BUCKET ?? "";

interface JobMessage {
  kind?: "job";
  workspace: string;
  id: string;
  url?: string;
  jdText?: string;
}

interface ResumeMessage {
  kind: "resume";
  workspace: string;
  key: string;
  contentType?: string;
}

interface DocsMessage {
  kind: "docs";
  workspace: string;
  applicationId: string;
  market: Market;
  lang?: string;
}

type AnalyzeMessage = JobMessage | ResumeMessage | DocsMessage;

async function saveResult(
  pk: string,
  id: string,
  result: { info?: JobInfo; analysisStatus: "done" | "failed" }
) {
  const sets = ["analysisStatus = :st", "updatedAt = :now"];
  const values: Record<string, unknown> = {
    ":st": result.analysisStatus,
    ":now": new Date().toISOString(),
  };

  if (result.info) {
    sets.push("company = :company", "#role = :role", "skills = :skills");
    values[":company"] = result.info.company;
    values[":role"] = result.info.role;
    values[":skills"] = result.info.skills;
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: pk, sk: `APP#${id}` },
        UpdateExpression: `SET ${sets.join(", ")}`,
        // Without this, updating a deleted item would resurrect a ghost row.
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: result.info ? { "#role": "role" } : undefined,
        ExpressionAttributeValues: values,
      })
    );
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      console.log(`Item ${id} no longer exists; discarding analysis result`);
      return;
    }
    throw error;
  }
}

async function saveProfileResult(
  pk: string,
  fields: Record<string, unknown>,
  analysisStatus: "done" | "failed"
) {
  const sets = ["analysisStatus = :st", "updatedAt = :now"];
  const values: Record<string, unknown> = {
    ":st": analysisStatus,
    ":now": new Date().toISOString(),
  };
  const names: Record<string, string> = {};

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: pk, sk: PROFILE_SK },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
      })
    );
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      console.log("Profile no longer exists; discarding resume analysis");
      return;
    }
    throw error;
  }
}

async function analyzeResume(message: ResumeMessage) {
  const pk = userPk(message.workspace);
  const object = await s3.send(
    new GetObjectCommand({ Bucket: RESUME_BUCKET, Key: message.key })
  );
  const bytes = await object.Body!.transformToByteArray();
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType =
    message.contentType ?? object.ContentType ?? "application/pdf";

  const profile = await extractResumeProfile(base64, mimeType);
  await saveProfileResult(
    pk,
    {
      name: profile.name,
      title: profile.title,
      location: profile.location,
      skills: profile.skills,
    },
    "done"
  );
  console.log(
    `Analyzed resume: ${profile.name ?? "unknown"} / ${profile.skills.length} skills`
  );
}

async function saveDocsResult(
  pk: string,
  applicationId: string,
  fields: Record<string, unknown>,
  status: "done" | "failed"
) {
  const sets = ["#status = :st", "updatedAt = :now"];
  const values: Record<string, unknown> = {
    ":st": status,
    ":now": new Date().toISOString(),
  };
  const names: Record<string, string> = { "#status": "status" };

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    sets.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: pk, sk: `DOCS#${applicationId}` },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      console.log("Docs entry no longer exists; discarding result");
      return;
    }
    throw error;
  }
}

const MAX_GENERATION_ATTEMPTS = 3;

/**
 * Runs the generate, check, correct loop. The em dash gate blocks publication
 * outright; page overflow comes back as a measured percentage so the model
 * knows how much to cut instead of guessing.
 */
async function buildDocuments(message: DocsMessage) {
  const pk = userPk(message.workspace);
  const [appResult, masterResult] = await Promise.all([
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: pk, sk: `APP#${message.applicationId}` },
      })
    ),
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: pk, sk: masterSk(message.market) },
      })
    ),
  ]);

  const app = appResult.Item as Application | undefined;
  const master = masterResult.Item as MasterProfile | undefined;
  if (!app?.skills?.length || !master?.content) {
    throw new Error("application or master profile is no longer available");
  }

  const prompt = buildGenerationPrompt({
    masterProfile: master.content,
    market: message.market,
    jobUrl: app.url,
    company: app.company,
    role: app.role,
    requiredSkills: app.skills,
    today: new Date().toISOString().slice(0, 10),
    langOverride: message.lang,
  });

  let docs: GeneratedDocs | undefined;
  let feedback: string | undefined;
  let fill = 0;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = await generateDocs(prompt, feedback);
    const problems: string[] = [];

    if (
      findEmDashInProse(candidate.resumeBodyHtml) ||
      findEmDashInProse(candidate.coverLetterBodyHtml) ||
      candidate.coverLetterText.includes("—")
    ) {
      problems.push(
        "REJECTED: an em dash appeared in prose. Rewrite without it, using a comma, a colon or a full stop."
      );
    }

    const resumeFill = Math.round(
      (estimateHeightPx(candidate.resumeBodyHtml) / PAGE_USABLE_PX) * 100
    );
    const letterFill = Math.round(
      (estimateHeightPx(candidate.coverLetterBodyHtml) / PAGE_USABLE_PX) * 100
    );
    fill = Math.max(resumeFill, letterFill);

    if (resumeFill > 100) {
      problems.push(
        `REJECTED: the resume fills about ${resumeFill}% of one page. Cut roughly ${resumeFill - 95}% of the content, shortening bullets that overflow by a few characters before removing whole entries.`
      );
    }
    if (letterFill > 100) {
      problems.push(
        `REJECTED: the cover letter fills about ${letterFill}% of one page. Tighten it toward 200 to 250 words.`
      );
    }

    if (problems.length === 0) {
      docs = candidate;
      break;
    }

    console.log(`Attempt ${attempt} rejected: ${problems.join(" | ")}`);
    feedback = `${problems.join("\n")}\n\nReturn the corrected JSON, same shape.`;
    docs = candidate; // keep the last one in case attempts run out
  }

  if (!docs) throw new Error("generation produced nothing");
  if (feedback && fill > 100) {
    console.log("Publishing the last attempt despite the size warning");
  }

  const name = docs.lang.startsWith("pt") ? "Currículo" : "Resume";
  const letterName = docs.lang.startsWith("pt")
    ? "Carta de Apresentação"
    : "Cover Letter";

  await saveDocsResult(
    pk,
    message.applicationId,
    {
      market: message.market,
      lang: docs.lang,
      recipient: docs.recipient,
      resumeHtml: compose({
        lang: docs.lang,
        title: `${name} · ${app.company}`,
        body: docs.resumeBodyHtml,
      }),
      coverLetterHtml: compose({
        lang: docs.lang,
        title: `${letterName} · ${app.company}`,
        body: docs.coverLetterBodyHtml,
      }),
      coverLetterText: docs.coverLetterText,
      angle: docs.angle,
      cut: docs.cut,
      keywordsCovered: docs.keywordsCovered,
      gapsHeLacks: docs.gapsHeLacks,
      gapsNoRoom: docs.gapsNoRoom,
      warnings: voiceWarnings(docs.coverLetterBodyHtml),
      estimatedFill: fill,
    },
    "done"
  );

  console.log(`Generated documents for ${app.role} at ${app.company}`);
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    let message: AnalyzeMessage;
    try {
      message = JSON.parse(record.body) as AnalyzeMessage;
    } catch {
      console.error("Skipping malformed message:", record.body.slice(0, 200));
      continue;
    }

    const lastAttempt = Number(record.attributes.ApproximateReceiveCount) >= 3;

    try {
      if (message.kind === "resume") {
        await analyzeResume(message);
      } else if (message.kind === "docs") {
        await buildDocuments(message);
      } else {
        const info = await extractJobInfo({
          url: message.url,
          jdText: message.jdText,
        });
        await saveResult(userPk(message.workspace), message.id, { info, analysisStatus: "done" });
        console.log(
          `Analyzed ${message.id}: ${info.company} / ${info.role} / ${info.skills.length} skills`
        );
      }
    } catch (error) {
      console.error("Analysis failed:", error);
      // Report as batch failure so SQS retries; after maxReceiveCount the
      // message lands in the DLQ and we mark the item as failed.
      if (lastAttempt) {
        if (message.kind === "resume") {
          await saveProfileResult(userPk(message.workspace), {}, "failed");
        } else if (message.kind === "docs") {
          await saveDocsResult(
            userPk(message.workspace),
            message.applicationId,
            { error: (error as Error).message.slice(0, 300) },
            "failed"
          );
        } else {
          await saveResult(userPk(message.workspace), message.id, { analysisStatus: "failed" });
        }
      } else {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
  }

  return { batchItemFailures: failures };
}
