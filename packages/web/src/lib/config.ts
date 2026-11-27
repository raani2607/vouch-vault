import { PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import {
  assertGenesisForCluster as assertClusterGenesis,
  calculateTreasuryFeeSplit,
  DEVNET_GENESIS_HASH,
  DEVNET_RPC,
  explorerUrl,
  LOCALNET_RPC,
  parseSolanaPublicKey,
  rpcUrlForCluster as clusterRpcUrl,
  type TreasuryFeeSplit,
  type VouchVaultCluster,
} from "@vouchvault/chain-config";

export const PROGRAM_ID = new PublicKey(
  "3RV7NRVSTabzrkuKywR3YNXazG8JSJcDo1v6BbD9Nwet",
);
export {
  calculateTreasuryFeeSplit,
  DEVNET_GENESIS_HASH,
  DEVNET_RPC,
  LOCALNET_RPC,
  type TreasuryFeeSplit,
};
export const CLUSTER = process.env.NEXT_PUBLIC_VOUCHVAULT_CLUSTER ?? "devnet";

export function rpcUrlForCluster(cluster: string): string {
  try {
    return clusterRpcUrl(cluster);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_VOUCHVAULT_CLUSTER must be explicitly set to devnet or localnet.",
    );
  }
}

export const RPC_URL = rpcUrlForCluster(CLUSTER);

export const EXPLORER = (key: string, kind: "address" | "tx" = "address") => {
  requireSupportedCluster();
  return explorerUrl(key, CLUSTER as VouchVaultCluster, kind);
};

export function requireSupportedCluster() {
  if (CLUSTER !== "devnet" && CLUSTER !== "localnet") {
    throw new Error(
      "NEXT_PUBLIC_VOUCHVAULT_CLUSTER must be explicitly set to devnet or localnet.",
    );
  }
}

export async function verifyConfiguredCluster(connection: {
  getGenesisHash(): Promise<string>;
}) {
  requireSupportedCluster();
  const hash = await connection.getGenesisHash();
  assertGenesisForCluster(CLUSTER, hash);
  return hash;
}

export function assertGenesisForCluster(cluster: string, hash: string) {
  try {
    assertClusterGenesis(cluster, hash);
  } catch (error) {
    if (cluster !== "devnet" && cluster !== "localnet") {
      throw new Error(
        "NEXT_PUBLIC_VOUCHVAULT_CLUSTER must be explicitly set to devnet or localnet.",
      );
    }
    throw error;
  }
}

export function parsePublicKey(value: string): PublicKey {
  try {
    return parseSolanaPublicKey(value);
  } catch {
    throw new Error("Enter a valid Solana public key.");
  }
}

export function serializeU64(value: bigint): BN {
  if (value < 0n || value > 18_446_744_073_709_551_615n) {
    throw new Error("Amount is outside the u64 range.");
  }
  return new BN(value.toString());
}

export function startupIdBytes(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length !== 32) {
    throw new Error(
      `Startup identifier must encode to exactly 32 UTF-8 bytes (received ${bytes.length}).`,
    );
  }
  return bytes;
}

/** Stable, printable identity derived from a founder-friendly slug. The
 * resulting 32 ASCII bytes are passed verbatim to Anchor and the PDA seeds. */
export async function startupIdFromSlug(slug: string): Promise<string> {
  const normalized = slug
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) {
    throw new Error("Enter a startup name to generate its identity.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  // Use the complete normalized slug as input, then encode 128 digest bits as
  // 32 printable hex characters. No slug truncation or byte-dependent locale.
  const id = Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  startupIdBytes(id);
  return id;
}

export function sanitizeDecimalInput(value: string): string {
  return value.replaceAll(",", "").trim();
}

export function decodeStartupId(bytes: readonly number[] | Uint8Array): string {
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/\0+$/g, "");
}

export function toBaseUnits(input: string, decimals: number): bigint {
  const normalized = sanitizeDecimalInput(input);
  if (!/^\d+(\.\d*)?$/.test(normalized)) {
    throw new Error("Enter a non-negative decimal amount.");
  }
  const [whole = "", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places.`);
  }
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

export function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fractional = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}

export function allocate(total: bigint, values: readonly bigint[]): boolean {
  return values.reduce((sum, value) => sum + value, 0n) === total;
}

export function calcVesting(
  total: bigint,
  claimed: bigint,
  start: bigint,
  cliff: bigint,
  end: bigint,
  now: bigint,
) {
  const vested =
    now < cliff
      ? 0n
      : now >= end
        ? total
        : now < start
          ? 0n
          : (total * (now - start)) / (end - start);
  return {
    vested,
    claimed,
    claimable: vested > claimed ? vested - claimed : 0n,
    remaining: total - claimed,
  };
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs}s`);
  return parts.join(" ") || "0s";
}
