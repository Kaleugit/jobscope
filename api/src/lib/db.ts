import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const TABLE_NAME = process.env.TABLE_NAME ?? "";

// Single-table design: pk = USER#<userId>, sk = APP#<applicationId>.
// userId is fixed until Cognito auth is added (phase 5).
export const USER_PK = "USER#default";

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

export const MASTER_SK = "MASTER";

/** The single source of truth for generated documents. Nothing outside it may
 *  appear in a resume or a cover letter. */
export interface MasterProfile {
  pk: string;
  sk: string;
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
