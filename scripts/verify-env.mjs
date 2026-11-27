import { spawnSync } from "node:child_process";

const requirements = [
  ["node", ["--version"], /^v24\.22\.0$/],
  ["pnpm", ["--version"], /^12\.11\.2$/],
  ["rustc", ["--version"], /^rustc 1\.99\.1\b/],
  ["cargo", ["--version"], /^cargo 1\.99\.1\b/],
  ["anchor", ["--version"], /^anchor-cli 1\.2\.2$/],
  ["solana", ["--version"], /^solana-cli 4\.1\.2\b/],
  ["solana-test-validator", ["--version"], /^solana-test-validator 4\.1\.2\b/],
  ["avm", ["platform-tools", "resolve"], /platform-tools v1\.57\b/],
];
let failed = false;

for (const [command, args, expected] of requirements) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    console.error(
      `MISSING/FAILED ${command}: ${result.error?.message ?? result.stderr.trim()}`,
    );
    failed = true;
    continue;
  }
  const output =
    `${result.stdout}\n${result.stderr}`
      .trim()
      .split("\n")
      .find((line) => line.trim()) ?? "";
  if (!expected.test(output)) {
    console.error(`VERSION MISMATCH ${command}: ${output}`);
    failed = true;
    continue;
  }
  console.log(`OK ${command}: ${output}`);
}

if (failed) process.exitCode = 1;
