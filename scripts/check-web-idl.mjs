import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const idl = JSON.parse(readFileSync("target/idl/vouchvault_token.json", "utf8"));
const shipped = JSON.parse(
  readFileSync("packages/web/src/generated/vouchvault_token.json", "utf8"),
);
assert.deepEqual(
  shipped,
  idl,
  "Web IDL copy is stale; run pnpm idl:sync after the pinned Anchor build.",
);
assert.equal(idl.address, "3RV7NRVSTabzrkuKywR3YNXazG8JSJcDo1v6BbD9Nwet");
const instructions = new Set(idl.instructions.map(({ name }) => name));
for (const name of [
  "initialize_startup",
  "create_allocation_vault",
  "fund_allocations",
  "finalize_startup",
  "create_vesting_schedule",
  "activate_vesting_schedule",
  "claim_vested",
])
  assert.ok(instructions.has(name), `Generated IDL is missing ${name}`);
console.log(
  "Generated web IDL matches target/idl and the approved program address.",
);
