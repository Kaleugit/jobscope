// Account authentication. No Cognito: a user pool plus a hosted UI is a lot of
// moving parts for an app whose whole point is that a visitor can try it in
// thirty seconds. Passwords are scrypt hashed, sessions are HMAC signed tokens,
// and both primitives come from node:crypto.

import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const TOKEN_SECRET = process.env.TOKEN_SECRET ?? "";
const SESSION_DAYS = 30;

/** Account management is reserved to one account, not to a role, so granting
 *  someone a dev login never hands over the account list. */
export const MASTER_USERNAME = (process.env.MASTER_USERNAME ?? "kaleu").toLowerCase();

export const isMaster = (username: string) => username === MASTER_USERNAME;

export interface Account {
  pk: string;
  sk: string;
  username: string;
  passwordHash: string;
  workspace: string;
  role: "dev" | "user";
  note?: string;
  createdAt: string;
  lastLoginAt?: string;
}

export const accountPk = (username: string) => `ACCOUNT#${username}`;
export const ACCOUNT_SK = "ACCOUNT";

export function normalizeUsername(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;

  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    derived.length === expectedBuffer.length &&
    timingSafeEqual(derived, expectedBuffer)
  );
}

export function newWorkspaceId(): string {
  return randomUUID().replace(/-/g, "");
}

interface TokenPayload {
  workspace: string;
  username: string;
  role: "dev" | "user";
  exp: number;
}

const b64 = (value: string) => Buffer.from(value).toString("base64url");

function sign(data: string): string {
  return createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
}

export function issueToken(account: Account): string {
  const payload: TokenPayload = {
    workspace: account.workspace,
    username: account.username,
    role: account.role,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined): TokenPayload | null {
  if (!token || !TOKEN_SECRET) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString()
    ) as TokenPayload;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function bearerFrom(headers: Record<string, string | undefined>): string | undefined {
  const raw = headers.authorization ?? headers.Authorization;
  return raw?.startsWith("Bearer ") ? raw.slice(7) : undefined;
}
