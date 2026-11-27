import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, relative, sep, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const ROOT = realpathSync(new URL("..", import.meta.url).pathname);
const PROGRAM = "46UFiREvpUgYEB4hgDzBR6n29Mh1BKBR9yp7VoEAapCo";
const RPC = "https://api.devnet.solana.com";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const errors = [];
const say = (label, value) => console.log(label + ": " + value);
const fail = (message) => {
  errors.push(message);
  console.error("BLOCKED: " + message);
};
const repoPath = (path) => {
  const relativePath = relative(ROOT, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(".." + sep) &&
      relativePath !== ".." &&
      !relativePath.startsWith(sep))
  );
};

function publicKeyFromKeypair(path, requiredOutside = false) {
  let absolute;
  try {
    absolute = realpathSync(path);
  } catch {
    fail(
      "A required keypair file is missing. Supply its filesystem path; never paste key contents.",
    );
    return null;
  }
  if (requiredOutside && repoPath(absolute))
    fail("A Devnet signing keypair must be outside the repository.");
  const mode = statSync(absolute).mode & 0o777;
  if ((mode & 0o077) !== 0)
    fail(
      "A keypair file has group or world permissions; set restrictive permissions (for example chmod 600).",
    );
  const directoryMode = statSync(dirname(absolute)).mode & 0o777;
  if ((directoryMode & 0o077) !== 0)
    fail(
      "A keypair parent directory has group or world permissions; store deployment keys in a private directory (for example chmod 700).",
    );
  const result = spawnSync("solana-keygen", ["pubkey", absolute], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail("Could not derive a public key from a configured keypair path.");
    return null;
  }
  const value = result.stdout.trim();
  try {
    return new PublicKey(value).toBase58();
  } catch {
    fail("A configured keypair did not produce a valid Solana public key.");
    return null;
  }
}

console.log(
  "ATTENZA Devnet preflight — read-only; no transaction will be sent.",
);
say("Cluster", "Solana Devnet");
say("RPC", RPC);
say("Expected program ID", PROGRAM);
say("Toolchain", "Anchor 1.2.2 · Solana/Agave 4.1.2 · platform-tools v1.57");
for (const [command, args, pattern] of [
  ["node", ["--version"], /^v24\.22\.0$/],
  ["pnpm", ["--version"], /^12\.11\.2$/],
  ["anchor", ["--version"], /^anchor-cli 1\.2\.2$/],
  ["solana", ["--version"], /^solana-cli 4\.1\.2\b/],
  ["avm", ["platform-tools", "resolve"], /platform-tools v1\.57\b/],
]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const firstLine =
    output.split("\n").find((line) => line.trim()) ?? "unavailable";
  say("Tool check " + command, firstLine);
  if (result.status !== 0 || !pattern.test(firstLine))
    fail(command + " does not match the pinned Devnet deployment toolchain.");
}

const source = readFileSync(
  resolve(ROOT, "programs/attenza-token/src/lib.rs"),
  "utf8",
);
const anchor = readFileSync(resolve(ROOT, "Anchor.toml"), "utf8");
const deployment = readFileSync(resolve(ROOT, "deploy/devnet.toml"), "utf8");
const idl = JSON.parse(
  readFileSync(resolve(ROOT, "target/idl/attenza_token.json"), "utf8"),
);
const frontend = readFileSync(
  resolve(ROOT, "packages/web/src/lib/config.ts"),
  "utf8",
);
for (const [name, value] of [
  ["declare_id!", source.match(/declare_id!\("([^"]+)"\)/)?.[1]],
  [
    "Anchor.toml localnet program",
    anchor.match(/attenza_token\s*=\s*"([^"]+)"/)?.[1],
  ],
  ["generated IDL address", idl.address],
  [
    "frontend program ID",
    frontend.match(/new PublicKey\(\s*"([^"]+)"\s*,?\s*\)/)?.[1],
  ],
]) {
  say(name, value ?? "missing");
  if (value !== PROGRAM)
    fail(name + " does not match the approved program ID.");
}
for (const [field, expected] of [
  ["cluster", "devnet"],
  ["rpc_url", RPC],
  ["genesis_hash", GENESIS],
  ["program_id", PROGRAM],
  ["anchor_version", "1.2.2"],
  ["solana_version", "4.1.2"],
  ["platform_tools", "v1.57"],
]) {
  const actual = deployment.match(
    new RegExp(`^${field}\\s*=\\s*"([^"]+)"$`, "m"),
  )?.[1];
  say("deploy/devnet.toml " + field, actual ?? "missing");
  if (actual !== expected)
    fail(
      "deploy/devnet.toml " +
        field +
        " does not match the approved Devnet target.",
    );
}
try {
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        resolve(ROOT, "packages/web/src/generated/attenza_token.json"),
        "utf8",
      ),
    ),
    idl,
  );
} catch {
  fail("The frontend IDL copy is stale relative to the generated Anchor IDL.");
}

const artifact = resolve(ROOT, "target/deploy/attenza_token.so");
let artifactBytes;
try {
  artifactBytes = readFileSync(artifact);
  if (artifactBytes.subarray(0, 4).toString("hex") !== "7f454c46")
    fail("Compiled artifact is not an ELF/SBF binary.");
  say("Compiled artifact bytes", artifactBytes.length);
  say(
    "Compiled artifact SHA-256",
    createHash("sha256").update(artifactBytes).digest("hex"),
  );
} catch {
  fail("Compiled SBF artifact is missing; run the pinned Anchor build first.");
}

const programKeypairPath =
  process.env.ATTENZA_PROGRAM_KEYPAIR ??
  resolve(ROOT, "target/deploy/attenza_token-keypair.json");
const programKey = publicKeyFromKeypair(programKeypairPath, true);
say("Program keypair public key", programKey ?? "unavailable");
if (programKey && programKey !== PROGRAM)
  fail(
    "Program keypair address " +
      programKey +
      " does not match the approved program ID; do not change or regenerate that ID.",
  );

const deploymentKeypairPath = process.env.ANCHOR_WALLET;
let deployerKey;
let balanceLamports;
if (!deploymentKeypairPath)
  fail(
    "ANCHOR_WALLET is not set to the dedicated Devnet deployment authority file path.",
  );
else {
  deployerKey = publicKeyFromKeypair(deploymentKeypairPath, true);
  say("Deployment authority public key", deployerKey ?? "unavailable");
}

const connection = new Connection(RPC, "confirmed");
try {
  const genesis = await connection.getGenesisHash();
  say("RPC genesis hash", genesis);
  if (genesis !== GENESIS)
    fail("RPC endpoint did not return the pinned Devnet genesis hash.");
  const programAddress = new PublicKey(PROGRAM);
  const programAccount = await connection.getAccountInfo(
    programAddress,
    "confirmed",
  );
  if (!programAccount)
    say(
      "Existing program",
      "No account at target address; fresh deployment would be required.",
    );
  else {
    say(
      "Existing program",
      "owner=" +
        programAccount.owner.toBase58() +
        " executable=" +
        programAccount.executable,
    );
    if (
      !programAccount.executable ||
      !programAccount.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)
    ) {
      fail(
        "An unexpected account exists at the program address; inspect it before any deployment action.",
      );
    } else {
      const programDataAddress = new PublicKey(
        programAccount.data.subarray(4, 36),
      );
      const programData = await connection.getAccountInfo(
        programDataAddress,
        "confirmed",
      );
      if (
        !programData ||
        !programData.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID) ||
        programData.data.readUInt32LE(0) !== 3
      ) {
        fail("Could not decode the existing upgradeable program state safely.");
      } else {
        const option = programData.data[12];
        const upgradeAuthority =
          option === 1
            ? new PublicKey(programData.data.subarray(13, 45)).toBase58()
            : "None (immutable)";
        say("Existing upgrade authority", upgradeAuthority);
        if (deployerKey && upgradeAuthority !== deployerKey)
          fail(
            "Existing upgrade authority does not match the dedicated Devnet deployment authority.",
          );
        if (upgradeAuthority === "None (immutable)")
          fail(
            "The existing program is immutable; an upgrade cannot be performed.",
          );
      }
    }
  }
  const dataRent = artifactBytes
    ? await connection.getMinimumBalanceForRentExemption(
        artifactBytes.length + 64,
        "confirmed",
      )
    : 0;
  const programRent = await connection.getMinimumBalanceForRentExemption(
    36,
    "confirmed",
  );
  const estimate = dataRent + programRent + Math.floor(0.03 * LAMPORTS_PER_SOL);
  say(
    "Conservative deployment funding estimate",
    "about " +
      (estimate / LAMPORTS_PER_SOL).toFixed(4) +
      " SOL (artifact rent + program account rent + 0.03 SOL transaction margin)",
  );
  if (deployerKey) {
    balanceLamports = await connection.getBalance(
      new PublicKey(deployerKey),
      "confirmed",
    );
    say(
      "Deployment wallet balance",
      (balanceLamports / LAMPORTS_PER_SOL).toFixed(6) + " SOL",
    );
    say(
      "Conservative funding estimate",
      "about " +
        (estimate / LAMPORTS_PER_SOL).toFixed(4) +
        " SOL (artifact rent + program account rent + 0.03 SOL transaction margin)",
    );
    if (balanceLamports < estimate)
      fail(
        "Deployment authority does not meet the estimated funding threshold.",
      );
  }
} catch (error) {
  fail(
    "Read-only Devnet RPC preflight failed: " +
      (error instanceof Error ? error.message : "unknown RPC error"),
  );
}

if (errors.length) {
  console.error(
    "Preflight blocked by " +
      errors.length +
      " condition(s). No deployment transaction was sent.",
  );
  process.exitCode = 1;
} else {
  console.log(
    "Preflight passed. A separate explicit owner authorization is still required immediately before deployment.",
  );
}
