import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const TABLE_NAME = process.env.TABLE_NAME ?? "";

// Single-table design: pk = USER#<workspace>, sk = APP#<applicationId>.
//
// Every visitor gets their own workspace id, generated in the browser and sent
// on each request, so anyone can try the app with a blank slate without seeing
// (or touching) someone else's data. The id is a capability: whoever holds it
// reaches that workspace, which is the trade this project accepts in exchange
// for having no sign-up wall in front of a portfolio piece.
export const userPk = (workspace: string) => `USER#${workspace}`;

const WORKSPACE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidWorkspace(value: unknown): value is string {
  return typeof value === "string" && WORKSPACE_PATTERN.test(value);
}

const client = new DynamoDBClient({});

export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export type ApplicationStatus =
  | "wishlist"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export const PROFILE_SK = "PROFILE";

export interface Profile {
  pk: string;
  sk: string;
  fileName: string;
  s3Key: string;
  name?: string;
  title?: string;
  location?: string;
  skills?: string[];
  analysisStatus: "pending" | "done" | "failed";
  uploadedAt: string;
  updatedAt: string;
}

/** Each market keeps its own master profile: the LATAM one is contractor and
 *  timezone oriented, the Finnish one carries the visa, language and location
 *  disclosures that market expects. */
export const MARKETS = ["latam", "fin"] as const;
export type Market = (typeof MARKETS)[number];

export const masterSk = (market: Market) => `MASTER#${market}`;

/** The single source of truth for generated documents. Nothing outside it may
 *  appear in a resume or a cover letter. */
export interface MasterProfile {
  pk: string;
  sk: string;
  market: Market;
  fileName: string;
  content: string;
  uploadedAt: string;
}

export interface GeneratedDocsItem {
  pk: string;
  sk: string;
  applicationId: string;
  company: string;
  role: string;
  market?: Market;
  lang?: string;
  recipient?: string;
  resumeHtml?: string;
  coverLetterHtml?: string;
  coverLetterText?: string;
  angle?: string;
  cut?: string[];
  keywordsCovered?: string[];
  gapsHeLacks?: string[];
  gapsNoRoom?: string[];
  warnings?: string[];
  estimatedFill?: number;
  status: "pending" | "done" | "failed";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  pk: string;
  sk: string;
  id: string;
  company: string;
  role: string;
  url?: string;
  status: ApplicationStatus;
  jdText?: string;
  skills?: string[];
  analysisStatus?: "pending" | "done" | "failed";
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
