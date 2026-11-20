import type { AtsKind } from "./model";

/** Initial companies known to hire in LATAM. Each token was checked against
 *  the live board on 2026-11-20. Adding a company later is done in the Owner
 *  Area, not here: this list only seeds an empty table.
 *
 *  Connectly was listed as Lever, but its board lives on Ashby. */
export const COMPANIES_SEED: { ats: AtsKind; token: string; name: string }[] = [
  { ats: "lever", token: "JetBridge", name: "JetBridge" },
  { ats: "lever", token: "tesorio", name: "Tesorio" },
  { ats: "ashby", token: "connectly", name: "Connectly" },
  { ats: "greenhouse", token: "enumerate", name: "Enumerate" },
  { ats: "greenhouse", token: "coderoad", name: "Coderoad" },
  { ats: "greenhouse", token: "arenaim", name: "Arena" },
];
