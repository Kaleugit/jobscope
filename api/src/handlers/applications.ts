import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import {
  ddb,
  MARKETS,
  masterSk,
  PROFILE_SK,
  TABLE_NAME,
  userPk,
  type Application,
  type Market,
  type MasterProfile,
  type Profile,
} from "../lib/db";
import {
  ACCOUNT_SK,
  accountPk,
  bearerFrom,
  hashPassword,
  isMaster,
  isValidUsername,
  issueToken,
  newWorkspaceId,
  normalizeUsername,
  verifyPassword,
  verifyToken,
  type Account,
} from "../lib/auth";

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

async function listApplications(pk: string): Promise<Application[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": pk, ":sk": "APP#" },
    })
  );
  return (result.Items ?? []) as Application[];
}

async function createApplication(pk: string, workspace: string, body: Record<string, unknown>) {
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
    pk,
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
          workspace,
          id,
          url: url || undefined,
          jdText: jdText || undefined,
        }),
      })
    );
  }

  return json(201, item);
}

async function updateApplication(pk: string, id: string, body: Record<string, unknown>) {
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
      Key: { pk, sk: `APP#${id}` },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ConditionExpression: "attribute_exists(pk)",
      ReturnValues: "ALL_NEW",
    })
  );

  return json(200, result.Attributes);
}

async function getProfile(pk: string): Promise<Profile | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk: PROFILE_SK },
    })
  );
  return result.Item as Profile | undefined;
}

// Skills come from two different LLM calls, so compare them loosely.
const normalizeSkill = (s: string) => s.toLowerCase().replace(/[.\-_\s]/g, "");

async function skillsSummary(pk: string) {
  const [apps, profile] = await Promise.all([listApplications(pk), getProfile(pk)]);

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

async function startResumeAnalysis(pk: string, workspace: string, body: Record<string, unknown>) {
  const key = String(body.key ?? "").trim();
  const fileName = String(body.fileName ?? "").trim();
  const contentType = String(body.contentType ?? "").trim();

  if (!key.startsWith("resumes/") || !fileName) {
    return json(400, { error: "key and fileName are required" });
  }

  const now = new Date().toISOString();
  const previous = await getProfile(pk);

  const profile: Profile = {
    pk,
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
        MessageBody: JSON.stringify({ kind: "resume", workspace, key, contentType }),
      })
    );
  }

  return json(202, profile);
}

function parseMarket(value: unknown): Market | undefined {
  const market = String(value ?? "").trim();
  return (MARKETS as readonly string[]).includes(market)
    ? (market as Market)
    : undefined;
}

async function getMasterProfile(
  pk: string,
  market: Market
): Promise<MasterProfile | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk: masterSk(market) },
    })
  );
  return result.Item as MasterProfile | undefined;
}

async function listMasterProfiles(pk: string) {
  const found = await Promise.all(MARKETS.map((m) => getMasterProfile(pk, m)));
  return json(
    200,
    Object.fromEntries(
      MARKETS.map((market, i) => {
        const item = found[i];
        return [
          market,
          item
            ? {
                market,
                fileName: item.fileName,
                uploadedAt: item.uploadedAt,
                size: item.content.length,
              }
            : null,
        ];
      })
    )
  );
}

// The master profile is markdown, small enough to live in the item itself.
async function putMasterProfile(pk: string, body: Record<string, unknown>) {
  const market = parseMarket(body.market);
  const fileName = String(body.fileName ?? "").trim();
  const content = typeof body.content === "string" ? body.content : "";

  if (!market) return json(400, { error: `market must be one of: ${MARKETS.join(", ")}` });
  if (!fileName || content.trim().length < 200) {
    return json(400, { error: "fileName and a non-trivial content are required" });
  }
  if (content.length > 200_000) {
    return json(413, { error: "master profile is too large" });
  }

  const item: MasterProfile = {
    pk,
    sk: masterSk(market),
    market,
    fileName,
    content,
    uploadedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  return json(200, {
    market,
    fileName,
    uploadedAt: item.uploadedAt,
    size: content.length,
  });
}

async function generateDocuments(pk: string, workspace: string, body: Record<string, unknown>) {
  const applicationId = String(body.applicationId ?? "").trim();
  const market = parseMarket(body.market);
  if (!applicationId) return json(400, { error: "applicationId is required" });
  if (!market) return json(400, { error: `market must be one of: ${MARKETS.join(", ")}` });

  const [appResult, master] = await Promise.all([
    ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk: `APP#${applicationId}` },
      })
    ),
    getMasterProfile(pk, market),
  ]);

  const app = appResult.Item as Application | undefined;
  if (!app) return json(404, { error: "application not found" });
  if (!app.skills?.length) {
    return json(409, { error: "this application has not been analyzed yet" });
  }
  if (!master) {
    return json(409, { error: `upload the ${market} master profile first` });
  }

  const now = new Date().toISOString();
  const item = {
    pk,
    sk: `DOCS#${applicationId}`,
    applicationId,
    company: app.company,
    role: app.role,
    market,
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
          workspace,
          applicationId,
          market,
          lang: typeof body.lang === "string" ? body.lang : undefined,
        }),
      })
    );
  }

  return json(202, item);
}

async function listDocuments(pk: string) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": pk, ":sk": "DOCS#" },
    })
  );
  return json(200, result.Items ?? []);
}

async function deleteProfile(pk: string) {
  const profile = await getProfile(pk);
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
      Key: { pk, sk: PROFILE_SK },
    })
  );
  return json(204, {});
}

async function login(body: Record<string, unknown>) {
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  if (!username || !password) {
    return json(400, { error: "username and password are required" });
  }

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: accountPk(username), sk: ACCOUNT_SK },
    })
  );
  const account = result.Item as Account | undefined;

  // Same answer either way, so the response does not reveal which usernames exist.
  if (!account || !verifyPassword(password, account.passwordHash)) {
    return json(401, { error: "invalid username or password" });
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: accountPk(username), sk: ACCOUNT_SK },
      UpdateExpression: "SET lastLoginAt = :now",
      ExpressionAttributeValues: { ":now": new Date().toISOString() },
    })
  );

  return json(200, {
    token: issueToken(account),
    username: account.username,
    role: account.role,
    isMaster: isMaster(account.username),
  });
}

async function createAccount(body: Record<string, unknown>) {
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const role = body.role === "dev" ? "dev" : "user";

  if (!isValidUsername(username)) {
    return json(400, {
      error: "username must be 3 to 32 characters: letters, digits, dot, dash or underscore",
    });
  }
  if (password.length < 8) {
    return json(400, { error: "password must be at least 8 characters" });
  }

  const account: Account = {
    pk: accountPk(username),
    sk: ACCOUNT_SK,
    username,
    passwordHash: hashPassword(password),
    workspace: newWorkspaceId(),
    role,
    note: typeof body.note === "string" ? body.note.trim() : undefined,
    createdAt: new Date().toISOString(),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: account,
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  } catch (error) {
    if ((error as Error).name === "ConditionalCheckFailedException") {
      return json(409, { error: "that username is taken" });
    }
    throw error;
  }

  return json(201, {
    username: account.username,
    role: account.role,
    note: account.note,
    createdAt: account.createdAt,
  });
}

async function listAccounts() {
  const result = await ddb.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "sk = :sk",
      ExpressionAttributeValues: { ":sk": ACCOUNT_SK },
      ProjectionExpression: "username, #role, note, createdAt, lastLoginAt",
      ExpressionAttributeNames: { "#role": "role" },
    })
  );
  return json(200, result.Items ?? []);
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
    if (event.routeKey === "POST /auth/login") {
      return await login(body);
    }

    // Everything past this point belongs to one account's workspace.
    const session = verifyToken(bearerFrom(event.headers ?? {}));
    if (!session) {
      return json(401, { error: "sign in to continue" });
    }
    const pk = userPk(session.workspace);

    if (event.routeKey.includes("/auth/accounts")) {
      if (!isMaster(session.username)) {
        return json(403, { error: "master account only" });
      }
    }

    switch (event.routeKey) {
      case "GET /auth/me":
        return json(200, {
          username: session.username,
          role: session.role,
          isMaster: isMaster(session.username),
        });
      case "GET /auth/accounts":
        return await listAccounts();
      case "POST /auth/accounts":
        return await createAccount(body);
      case "DELETE /auth/accounts/{username}": {
        const username = normalizeUsername(event.pathParameters?.username);
        if (username === session.username) {
          return json(400, { error: "you cannot delete your own account" });
        }
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk: accountPk(username), sk: ACCOUNT_SK },
          })
        );
        return json(204, {});
      }
    }

    switch (event.routeKey) {
      case "GET /applications":
        return json(200, await listApplications(pk));
      case "POST /applications":
        return await createApplication(pk, session.workspace, body);
      case "GET /applications/{id}": {
        const result = await ddb.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { pk, sk: `APP#${id}` },
          })
        );
        return result.Item
          ? json(200, result.Item)
          : json(404, { error: "not found" });
      }
      case "PATCH /applications/{id}":
        return await updateApplication(pk, id, body);
      case "DELETE /applications/{id}":
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk, sk: `APP#${id}` },
          })
        );
        return json(204, {});
      case "GET /skills/summary":
        return await skillsSummary(pk);
      case "GET /profile": {
        const profile = await getProfile(pk);
        return json(200, profile ?? null);
      }
      case "POST /profile/upload-url":
        return await createUploadUrl(body);
      case "POST /profile/analyze":
        return await startResumeAnalysis(pk, session.workspace, body);
      case "DELETE /profile":
        return await deleteProfile(pk);
      case "GET /master":
        return await listMasterProfiles(pk);
      case "PUT /master":
        return await putMasterProfile(pk, body);
      case "DELETE /master/{market}": {
        const market = parseMarket(event.pathParameters?.market);
        if (!market) return json(400, { error: "unknown market" });
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk, sk: masterSk(market) },
          })
        );
        return json(204, {});
      }
      case "GET /docs":
        return await listDocuments(pk);
      case "POST /docs":
        return await generateDocuments(pk, session.workspace, body);
      case "DELETE /docs/{id}":
        await ddb.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { pk, sk: `DOCS#${id}` },
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
