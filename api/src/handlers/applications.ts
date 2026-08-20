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
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import {
  ddb,
  MASTER_SK,
  PROFILE_SK,
  TABLE_NAME,
  USER_PK,
  type Application,
  type MasterProfile,
  type Profile,
} from "../lib/db";

const sqs = new SQSClient({});
const s3 = new S3Client({});
const ANALYZE_QUEUE_URL = process.env.ANALYZE_QUEUE_URL ?? "";
const RESUME_BUCKET = process.env.RESUME_BUCKET ?? "";

const ALLOWED_RESUME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];

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
  const url = String(body.url ?? "").trim();
  const jdText = typeof body.jdText === "string" ? body.jdText.trim() : "";

  // The posting URL is the only required input; the AI pipeline fills in
  // company, role and skills. jdText stays supported as an alternative source.
  if (!/^https?:\/\/.+/.test(url) && !jdText) {
    return json(400, { error: "a valid job posting url is required" });
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  const item: Application = {
    pk: USER_PK,
    sk: `APP#${id}`,
    id,
    company: String(body.company ?? "").trim(),
    role: String(body.role ?? "").trim(),
    url: url || undefined,
    status: STATUSES.includes(String(body.status))
      ? (body.status as Application["status"])
      : "applied",
    jdText: jdText || undefined,
    analysisStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  if (ANALYZE_QUEUE_URL) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: ANALYZE_QUEUE_URL,
        MessageBody: JSON.stringify({
          id,
          url: url || undefined,
          jdText: jdText || undefined,
        }),
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

async function getProfile(): Promise<Profile | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: USER_PK, sk: PROFILE_SK },
    })
  );
  return result.Item as Profile | undefined;
}

// Skills come from two different LLM calls, so compare them loosely.
const normalizeSkill = (s: string) => s.toLowerCase().replace(/[.\-_\s]/g, "");

async function skillsSummary() {
  const [apps, profile] = await Promise.all([listApplications(), getProfile()]);

  const counts = new Map<string, number>();
  for (const app of apps) {
    for (const skill of app.skills ?? []) {
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }

  const mySkills = profile?.skills ?? [];
  const mySet = new Set(mySkills.map(normalizeSkill));
  const hasSkill = (name: string) => mySet.has(normalizeSkill(name));

  const skills = [...counts.entries()]
    .map(([name, count]) => ({ name, count, owned: hasSkill(name) }))
    .sort((a, b) => b.count - a.count);

  const requestedSet = new Set([...counts.keys()].map(normalizeSkill));

  // Per-application coverage: how much of what they ask for you already have.
  const analyzed = apps.filter(
    (a) => a.analysisStatus === "done" && (a.skills?.length ?? 0) > 0
  );
  const matches = analyzed
    .map((a) => {
      const required = a.skills ?? [];
      const owned = required.filter(hasSkill).length;
      return {
        id: a.id,
        company: a.company,
        role: a.role,
        required: required.length,
        owned,
        score: Math.round((owned / required.length) * 100),
      };
    })
    .sort((a, b) => b.score - a.score);

  return json(200, {
    totalApplications: apps.length,
    analyzedApplications: apps.filter((a) => a.analysisStatus === "done").length,
    byStatus: Object.fromEntries(
      STATUSES.map((s) => [s, apps.filter((a) => a.status === s).length])
    ),
    skills,
    hasProfile: Boolean(profile && profile.analysisStatus === "done"),
    missingSkills: skills.filter((s) => !s.owned),
    unusedSkills: mySkills.filter((s) => !requestedSet.has(normalizeSkill(s))),
    matches,
    averageMatch: matches.length
      ? Math.round(matches.reduce((sum, m) => sum + m.score, 0) / matches.length)
      : 0,
  });
}

async function createUploadUrl(body: Record<string, unknown>) {
  const fileName = String(body.fileName ?? "").trim();
  const contentType = String(body.contentType ?? "").trim();

  if (!fileName) return json(400, { error: "fileName is required" });
  if (!ALLOWED_RESUME_TYPES.includes(contentType)) {
    return json(400, { error: "resume must be a PDF, DOCX or TXT file" });
  }

  const key = `resumes/${randomUUID()}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: RESUME_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 }
  );

  return json(200, { uploadUrl, key });
}

async function startResumeAnalysis(body: Record<string, unknown>) {
  const key = String(body.key ?? "").trim();
  const fileName = String(body.fileName ?? "").trim();
  const contentType = String(body.contentType ?? "").trim();

  if (!key.startsWith("resumes/") || !fileName) {
    return json(400, { error: "key and fileName are required" });
  }

  const now = new Date().toISOString();
  const previous = await getProfile();

  const profile: Profile = {
    pk: USER_PK,
    sk: PROFILE_SK,
    fileName,
    s3Key: key,
    analysisStatus: "pending",
    uploadedAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: profile }));

  // Replacing a resume: drop the old object so the bucket does not pile up.
  if (previous?.s3Key && previous.s3Key !== key) {
    await s3
      .send(
        new DeleteObjectCommand({ Bucket: RESUME_BUCKET, Key: previous.s3Key })
      )
      .catch((e) => console.error("Failed to delete previous resume:", e));
  }

  if (ANALYZE_QUEUE_URL) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: ANALYZE_QUEUE_URL,
        MessageBody: JSON.stringify({ kind: "resume", key, contentType }),
      })
    );
  }

  return json(202, profile);
}

async function getMasterProfile(): Promise<MasterProfile | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: USER_PK, sk: MASTER_SK },
    })
  );
  return result.Item as MasterProfile | undefined;
}

// The master profile is markdown, small enough to live in the item itself.
async function putMasterProfile(body: Record<string, unknown>) {
  const fileName = String(body.fileName ?? "").trim();
  const content = typeof body.content === "string" ? body.content : "";

  if (!fileName || content.trim().length < 200) {
    return json(400, { error: "fileName and a non-trivial content are required" });
  }
  if (content.length > 200_000) {
    return json(413, { error: "master profile is too large" });
  }

  const item: MasterProfile = {
    pk: USER_PK,
    sk: MASTER_SK,
    fileName,
    content,
    uploadedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return json(200, { fileName, uploadedAt: item.uploadedAt, size: content.length });
}

async function generateDocuments(body: Record<string, unknown>) {
  const applicationId = String(body.applicationId ?? "").trim();
  if (!applicationId) return json(400, { error: "applicationId is required" });

  const [appResult, master] = await Promise.all([
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: USER_PK, sk: `APP#${applicationId}` },
      })
    ),
    getMasterProfile(),
  ]);

  const app = appResult.Item as Application | undefined;
  if (!app) return json(404, { error: "application not found" });
  if (!app.skills?.length) {
    return json(409, { error: "this application has not been analyzed yet" });
  }
  if (!master) {
    return json(409, { error: "upload your master profile first" });
  }

  const now = new Date().toISOString();
  const item = {
    pk: USER_PK,
    sk: `DOCS#${applicationId}`,
    applicationId,
    company: app.company,
    role: app.role,
    status: "pending" as const,
    createdAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  if (ANALYZE_QUEUE_URL) {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: ANALYZE_QUEUE_URL,
        MessageBody: JSON.stringify({
          kind: "docs",
          applicationId,
          lang: typeof body.lang === "string" ? body.lang : undefined,
        }),
      })
    );
  }

  return json(202, item);
}

async function listDocuments() {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": USER_PK, ":sk": "DOCS#" },
    })
  );
  return json(200, result.Items ?? []);
}

async function deleteProfile() {
  const profile = await getProfile();
  if (profile?.s3Key) {
    await s3
      .send(
        new DeleteObjectCommand({ Bucket: RESUME_BUCKET, Key: profile.s3Key })
      )
      .catch((e) => console.error("Failed to delete resume object:", e));
  }
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: USER_PK, sk: PROFILE_SK },
    })
  );
  return json(204, {});
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
      case "GET /skills/summary":
        return await skillsSummary();
      case "GET /profile": {
        const profile = await getProfile();
        return json(200, profile ?? null);
      }
      case "POST /profile/upload-url":
        return await createUploadUrl(body);
      case "POST /profile/analyze":
        return await startResumeAnalysis(body);
      case "DELETE /profile":
        return await deleteProfile();
      case "GET /master": {
        const master = await getMasterProfile();
        return json(
          200,
          master
            ? {
                fileName: master.fileName,
                uploadedAt: master.uploadedAt,
                size: master.content.length,
              }
            : null
        );
      }
      case "PUT /master":
        return await putMasterProfile(body);
      case "DELETE /master":
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk: USER_PK, sk: MASTER_SK },
          })
        );
        return json(204, {});
      case "GET /docs":
        return await listDocuments();
      case "POST /docs":
        return await generateDocuments(body);
      case "DELETE /docs/{id}":
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk: USER_PK, sk: `DOCS#${id}` },
          })
        );
        return json(204, {});
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
