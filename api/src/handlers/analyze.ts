import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME, USER_PK } from "../lib/db";
import { extractSkills } from "../lib/llm";

interface AnalyzeMessage {
  id: string;
  jdText: string;
}

async function saveResult(
  id: string,
  fields: { skills?: string[]; analysisStatus: "done" | "failed" }
) {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: USER_PK, sk: `APP#${id}` },
      UpdateExpression: fields.skills
        ? "SET skills = :skills, analysisStatus = :st, updatedAt = :now"
        : "SET analysisStatus = :st, updatedAt = :now",
      ExpressionAttributeValues: {
        ...(fields.skills ? { ":skills": fields.skills } : {}),
        ":st": fields.analysisStatus,
        ":now": new Date().toISOString(),
      },
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
      const skills = await extractSkills(message.jdText);
      await saveResult(message.id, { skills, analysisStatus: "done" });
      console.log(`Analyzed ${message.id}: ${skills.length} skills`);
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
