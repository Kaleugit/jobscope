import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ddb, PROFILE_SK, TABLE_NAME, USER_PK } from "../lib/db";
import { extractJobInfo, extractResumeProfile, type JobInfo } from "../lib/llm";

const s3 = new S3Client({});
const RESUME_BUCKET = process.env.RESUME_BUCKET ?? "";

interface JobMessage {
  kind?: "job";
  id: string;
  url?: string;
  jdText?: string;
}

interface ResumeMessage {
  kind: "resume";
  key: string;
  contentType?: string;
}

type AnalyzeMessage = JobMessage | ResumeMessage;

async function saveResult(
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
        Key: { pk: USER_PK, sk: `APP#${id}` },
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
        Key: { pk: USER_PK, sk: PROFILE_SK },
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
  const object = await s3.send(
    new GetObjectCommand({ Bucket: RESUME_BUCKET, Key: message.key })
  );
  const bytes = await object.Body!.transformToByteArray();
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType =
    message.contentType ?? object.ContentType ?? "application/pdf";

  const profile = await extractResumeProfile(base64, mimeType);
  await saveProfileResult(
    {
      name: profile.name,
      title: profile.title,
      yearsExperience: profile.yearsExperience,
      skills: profile.skills,
    },
    "done"
  );
  console.log(
    `Analyzed resume: ${profile.name ?? "unknown"} / ${profile.skills.length} skills`
  );
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
      } else {
        const info = await extractJobInfo({
          url: message.url,
          jdText: message.jdText,
        });
        await saveResult(message.id, { info, analysisStatus: "done" });
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
          await saveProfileResult({}, "failed");
        } else {
          await saveResult(message.id, { analysisStatus: "failed" });
        }
      } else {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
  }

  return { batchItemFailures: failures };
}
