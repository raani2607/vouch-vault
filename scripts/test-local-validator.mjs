import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const rpcUrl = "http://127.0.0.1:8899";
const tempRoot = await mkdtemp(join(tmpdir(), "vouchvault-local-validator-"));
const ledger = join(tempRoot, "ledger");
const payerPath = join(tempRoot, "localnet-payer.json");
let validator;

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with ${result.status ?? "signal"}`);
}

try {
  const { Connection, Keypair } = await import("@solana/web3.js");
  const generatedPayer = Keypair.generate();
  await writeFile(
    payerPath,
    JSON.stringify(Array.from(generatedPayer.secretKey)),
    { mode: 0o600 },
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = Keypair.fromSecretKey(generatedPayer.secretKey);
  const programSource = await readFile(
    join(root, "programs/vouchvault-token/src/lib.rs"),
    "utf8",
  );
  const programId = programSource.match(/declare_id!\("([^"]+)"\)/)?.[1];
  if (!programId) throw new Error("could not read the declared program ID");
  const idlPath = join(root, "target/idl/vouchvault_token.json");
  const idl = JSON.parse(await readFile(idlPath, "utf8"));
  idl.address = programId;
  await writeFile(idlPath, `${JSON.stringify(idl, null, 2)}\n`);
  validator = spawn(
    "solana-test-validator",
    [
      "--ledger",
      ledger,
      "--rpc-port",
      "8899",
      "--faucet-port",
      "9900",
      "--bind-address",
      "127.0.0.1",
      "--reset",
      "--quiet",
      "--upgradeable-program",
      programId,
      join(root, "target/deploy/vouchvault_token.so"),
      payerPath,
    ],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    },
  );
  let healthy = false;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (validator.exitCode !== null) {
      const log = await readFile(join(ledger, "validator.log"), "utf8").catch(
        () => "",
      );
      throw new Error(
        `local validator exited early (${validator.exitCode})\n${log}`,
      );
    }
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      const body = await response.json();
      if (body.result === "ok") {
        healthy = true;
        break;
      }
    } catch {
      /* validator is still starting */
    }
    await delay(1000);
  }
  if (!healthy)
    throw new Error("local validator did not become healthy within 90 seconds");

  const airdrop = await connection.requestAirdrop(
    payer.publicKey,
    10_000_000_000,
  );
  await connection.confirmTransaction(airdrop, "confirmed");
  connection._rpcWebSocket.close();
  const localEnv = {
    ANCHOR_PROVIDER_URL: rpcUrl,
    ANCHOR_WALLET: payerPath,
    VOUCHVAULT_CLUSTER: "localnet",
    VOUCHVAULT_RPC_URL: rpcUrl,
  };
  run(
    "pnpm",
    [
      "exec",
      "ts-mocha",
      "-p",
      "./tsconfig.json",
      "-t",
      "1000000",
      "--exit",
      "tests/**/*.ts",
    ],
    localEnv,
  );
} finally {
  if (validator && validator.exitCode === null) {
    validator.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => validator.once("exit", resolveExit)),
      delay(10000),
    ]);
    if (validator.exitCode === null) validator.kill("SIGKILL");
  }
  await rm(tempRoot, { recursive: true, force: true });
}
