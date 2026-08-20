import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";
import { ddb, TABLE_NAME, USER_PK, type Application } from "../lib/db";

const sqs = new SQSClient({});
const ANALYZE_QUEUE_URL = process.env.ANALYZE_QUEUE_URL ?? "";

const STATUSES = ["wishlist", "applied", "interview", "offer", "rejected"];

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function listApplications(): Promise<Application[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": USER_PK, ":sk": "APP#" },
    })
  );
  return (result.Items ?? []) as Application[];
}

async function createApplication(body: Record<string, unknown>) {
  const company = String(body.company ?? "").trim();
  const role = String(body.role ?? "").trim();
  if (!company || !role) {
    return json(400, { error: "company and role are required" });
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const jdText = typeof body.jdText === "string" ? body.jdText.trim() : "";

  const item: Application = {
    pk: USER_PK,
    sk: `APP#${id}`,
    id,
    company,
    role,
    url: typeof body.url === "string" ? body.url : undefined,
    status: STATUSES.includes(String(body.status))
      ? (body.status as Application["status"])
      : "wishlist",
    jdText: jdText || undefined,
    analysisStatus: jdText ? "pending" : undefined,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  // Job description present -> queue async AI skill extraction.
  if (jdText && ANALYZE_QUEUE_URL) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: ANALYZE_QUEUE_URL,
        MessageBody: JSON.stringify({ id, jdText }),
      })
    );
  }

  return json(201, item);
}

async function updateApplication(id: string, body: Record<string, unknown>) {
  const allowed = ["company", "role", "url", "status", "notes"] as const;
  const sets: string[] = ["updatedAt = :updatedAt"];
  const values: Record<string, unknown> = {
    ":updatedAt": new Date().toISOString(),
  };
  const names: Record<string, string> = {};

  for (const field of allowed) {
    if (body[field] !== undefined) {
      if (field === "status" && !STATUSES.includes(String(body.status))) {
        return json(400, { error: `status must be one of: ${STATUSES.join(", ")}` });
      }
      sets.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = body[field];
    }
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: USER_PK, sk: `APP#${id}` },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(pk)",
      ReturnValues: "ALL_NEW",
    })
  );

  return json(200, result.Attributes);
}

async function skillsSummary() {
  const apps = await listApplications();
  const counts = new Map<string, number>();
  for (const app of apps) {
    for (const skill of app.skills ?? []) {
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  const skills = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return json(200, {
    totalApplications: apps.length,
    analyzedApplications: apps.filter((a) => a.analysisStatus === "done").length,
    byStatus: Object.fromEntries(
      STATUSES.map((s) => [s, apps.filter((a) => a.status === s).length])
    ),
    skills,
  });
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id ?? "";
  let body: Record<string, unknown> = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body) as Record<string, unknown>;
    } catch {
      return json(400, { error: "invalid JSON body" });
    }
  }

  try {
    switch (event.routeKey) {
      case "GET /applications":
        return json(200, await listApplications());
      case "POST /applications":
        return await createApplication(body);
      case "GET /applications/{id}": {
        const result = await ddb.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { pk: USER_PK, sk: `APP#${id}` },
          })
        );
        return result.Item
          ? json(200, result.Item)
          : json(404, { error: "not found" });
      }
      case "PATCH /applications/{id}":
        return await updateApplication(id, body);
      case "DELETE /applications/{id}":
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk: USER_PK, sk: `APP#${id}` },
          })
        );
        return json(204, {});
      case "GET /analytics/skills":
        return await skillsSummary();
      default:
        return json(404, { error: `unknown route: ${event.routeKey}` });
    }
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return json(404, { error: "not found" });
    }
    console.error(`Error handling ${event.routeKey}:`, error);
    return json(500, { error: "internal server error" });
  }
}
