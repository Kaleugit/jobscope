// Seeds the ATS companies table. Idempotent: an existing company is left
// untouched, so re-running never resets its LATAM statistics or its active flag.
//
//   TABLE_NAME=<table> npx tsx api/scripts/seed-companies.ts

import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "../src/lib/db";
import { COMPANIES_SEED } from "../src/discovery/companies-seed";
import { companySk, DISC_COMPANY_PK, type Company } from "../src/discovery/model";

async function main() {
  if (!TABLE_NAME) throw new Error("TABLE_NAME is required");
  const now = new Date().toISOString();

  for (const seed of COMPANIES_SEED) {
    const item: Company = {
      pk: DISC_COMPANY_PK,
      sk: companySk(seed.ats, seed.token),
      ats: seed.ats,
      token: seed.token,
      name: seed.name,
      active: true,
      totalJobsSeen: 0,
      latamJobsSeen: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        })
      );
      console.log(`created  ${item.sk}`);
    } catch (error) {
      if ((error as Error).name !== "ConditionalCheckFailedException") throw error;
      console.log(`exists   ${item.sk}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
