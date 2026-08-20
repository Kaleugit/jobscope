import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, USER_PK } from "../lib/db";
import { extractJobInfo, type JobInfo } from "../lib/llm";

interface AnalyzeMessage {
  id: string;
  url?: string;
  jdText?: string;
}

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

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: USER_PK, sk: `APP#${id}` },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: result.info ? { "#role": "role" } : undefined,
      ExpressionAttributeValues: values,
    })
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

    try {
      const info = await extractJobInfo({
        url: message.url,
        jdText: message.jdText,
      });
      await saveResult(message.id, { info, analysisStatus: "done" });
      console.log(
        `Analyzed ${message.id}: ${info.company} / ${info.role} / ${info.skills.length} skills`
      );
    } catch (error) {
      console.error(`Failed to analyze ${message.id}:`, error);
      // Report as batch failure so SQS retries; after maxReceiveCount the
      // message lands in the DLQ and we mark the item as failed.
      if (Number(record.attributes.ApproximateReceiveCount) >= 3) {
        await saveResult(message.id, { analysisStatus: "failed" });
      } else {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
  }

  return { batchItemFailures: failures };
}
