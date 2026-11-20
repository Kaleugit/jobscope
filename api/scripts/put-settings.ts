// Writes discovery settings into DynamoDB. Personal content never lives in this
// public repo: the profile comes from a file outside it, the e-mail from an arg.
// The Owner Area edits the same item later.
//
//   TABLE_NAME=<table> npx tsx api/scripts/put-settings.ts --profile <file> [--alert-email <addr>]

import { readFileSync } from "node:fs";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../src/lib/db";
import { getSettings } from "../src/discovery/score";
import { dynamoStore } from "../src/discovery/store";
import type { DiscoverySettings } from "../src/discovery/model";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  if (!TABLE_NAME) throw new Error("TABLE_NAME is required");
  const current = await getSettings(dynamoStore);
  const profilePath = arg("profile");
  const email = arg("alert-email");

  const next: DiscoverySettings = {
    ...current,
    ...(profilePath ? { adherenceProfile: readFileSync(profilePath, "utf-8").trim() } : {}),
    ...(email && email !== current.alertEmail ? { alertEmail: email, alertEmailStatus: "pending" as const } : {}),
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: next }));
  console.log(
    `settings saved: profile ${next.adherenceProfile.length} chars, alert e-mail ${next.alertEmail ? "set" : "unset"} (${next.alertEmailStatus ?? "-"}), threshold ${next.alertThreshold}, owner years ${next.ownerYears}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
