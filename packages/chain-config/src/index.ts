import { PublicKey } from "@solana/web3.js";

export type VouchVaultCluster = "localnet" | "devnet";

export interface VouchVaultChainConfig {
  readonly cluster: VouchVaultCluster;
  readonly rpcUrl: URL;
  /** A syntactically valid public key; this does not prove an on-chain mint exists. */
  readonly quoteMint?: string | undefined;
}

export const LOCALNET_RPC = "http://127.0.0.1:8899";
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export const DEFAULT_RPC_URLS: Record<VouchVaultCluster, string> = {
  localnet: LOCALNET_RPC,
  devnet: DEVNET_RPC,
};

export const BPS_DENOMINATOR = 10_000n;
export const TOTAL_FEE_BPS = 50n;
export const LP_FEE_BPS = 30n;
export const PROTOCOL_FEE_BPS = 20n;
export const PCT_DENOMINATOR = 100n;
export const GROWTH_TREASURY_PCT = 50n;
export const PROTOCOL_RESERVE_PCT = 30n;
export const RISK_OPS_PCT = 20n;

export interface TreasuryFeeSplit {
  readonly grossNotional: bigint;
  readonly effectiveNetNotional: bigint;
  readonly totalFee: bigint;
  readonly lpFee: bigint;
  readonly protocolFee: bigint;
  readonly growthTreasury: bigint;
  readonly protocolReserve: bigint;
  readonly riskOpsBuffer: bigint;
}

/**
 * Deterministic integer basis-point fee & Growth Treasury split calculation.
 * Enforces floor rounding and exact remainder conservation:
 * - totalFee = floor(Q * 50 / 10_000)
 * - protocolFee = floor(Q * 20 / 10_000)
 * - lpFee = totalFee - protocolFee
 * - growthTreasury = floor(protocolFee * 50 / 100)
 * - protocolReserve = floor(protocolFee * 30 / 100)
 * - riskOpsBuffer = protocolFee - growthTreasury - protocolReserve
 */
export function calculateTreasuryFeeSplit(
  grossNotional: bigint,
): TreasuryFeeSplit {
  if (grossNotional < 0n) {
    throw new ConfigError("Gross notional must be a non-negative integer.");
  }
  const totalFee = (grossNotional * TOTAL_FEE_BPS) / BPS_DENOMINATOR;
  const protocolFee = (grossNotional * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
  const lpFee = totalFee - protocolFee;
  const effectiveNetNotional = grossNotional - totalFee;

  const growthTreasury = (protocolFee * GROWTH_TREASURY_PCT) / PCT_DENOMINATOR;
  const protocolReserve =
    (protocolFee * PROTOCOL_RESERVE_PCT) / PCT_DENOMINATOR;
  const riskOpsBuffer = protocolFee - growthTreasury - protocolReserve;

  return {
    grossNotional,
    effectiveNetNotional,
    totalFee,
    lpFee,
    protocolFee,
    growthTreasury,
    protocolReserve,
    riskOpsBuffer,
  };
}

export function rpcUrlForCluster(cluster: string): string {
  if (cluster === "devnet") return DEVNET_RPC;
  if (cluster === "localnet") return LOCALNET_RPC;
  throw new ConfigError("VOUCHVAULT_CLUSTER must be localnet or devnet.");
}

export function assertGenesisForCluster(cluster: string, hash: string): void {
  if (cluster !== "devnet" && cluster !== "localnet") {
    throw new ConfigError("VOUCHVAULT_CLUSTER must be localnet or devnet.");
  }
  if (cluster === "devnet" && hash !== DEVNET_GENESIS_HASH) {
    throw new ConfigError("RPC genesis hash does not match Solana Devnet.");
  }
  if (cluster === "localnet" && hash === DEVNET_GENESIS_HASH) {
    throw new ConfigError(
      "Localnet mode received the Solana Devnet genesis hash.",
    );
  }
}

export function explorerUrl(
  key: string,
  cluster: VouchVaultCluster,
  kind: "address" | "tx" = "address",
): string {
  if (cluster === "localnet") {
    return `https://explorer.solana.com/${kind}/${key}?cluster=custom&customUrl=${encodeURIComponent(LOCALNET_RPC)}`;
  }
  return `https://explorer.solana.com/${kind}/${key}?cluster=devnet`;
}

export function parseSolanaPublicKey(value: string): PublicKey {
  const trimmed = value.trim();
  const key = new PublicKey(trimmed);
  if (key.toBytes().length !== 32 || key.toBase58() !== trimmed) {
    throw new ConfigError("Public key must decode to 32 bytes.");
  }
  return key;
}

const UNSUPPORTED_RPC_ALIASES = [
  "SOLANA_RPC_URL",
  "RPC_URL",
  "ANCHOR_PROVIDER_URL",
  "NEXT_PUBLIC_SOLANA_RPC_URL",
  "NEXT_PUBLIC_RPC_URL",
] as const;
const UNSUPPORTED_CLUSTER_ALIASES = [
  "SOLANA_CLUSTER",
  "ANCHOR_CLUSTER",
] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseRpcUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("VOUCHVAULT_RPC_URL must be a valid URL.");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new ConfigError(
      "RPC URL must not include credentials, a path, query, or fragment.",
    );
  }
  const authority = raw.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? "";
  if (authority.endsWith(":443") && url.protocol === "https:") {
    throw new ConfigError("Custom RPC ports are not accepted.");
  }
  return url;
}

function validateLocalnet(url: URL): void {
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.port === "443"
  ) {
    throw new ConfigError("localnet RPC must be HTTP on a loopback host.");
  }
}

function validateDevnet(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.devnet.solana.com" ||
    url.port !== ""
  ) {
    throw new ConfigError(
      "devnet RPC must use the canonical https://api.devnet.solana.com endpoint.",
    );
  }
}

function validatePublicKey(value: string): string {
  try {
    const key = new PublicKey(value);
    if (key.toBytes().length !== 32 || key.toBase58() !== value)
      throw new Error();
    return key.toBase58();
  } catch {
    throw new ConfigError(
      "VOUCHVAULT_QUOTE_MINT must decode to a 32-byte Solana public key.",
    );
  }
}

/** Parse public, non-secret chain settings. This does not verify a quote mint on-chain. */
export function parseChainConfig(
  env: Readonly<Record<string, string | undefined>>,
): VouchVaultChainConfig {
  for (const alias of [
    ...UNSUPPORTED_RPC_ALIASES,
    ...UNSUPPORTED_CLUSTER_ALIASES,
  ]) {
    if (env[alias] !== undefined) {
      throw new ConfigError(
        `${alias} is unsupported; use VOUCHVAULT_CLUSTER and VOUCHVAULT_RPC_URL.`,
      );
    }
  }

  const clusterValue = env.VOUCHVAULT_CLUSTER ?? "localnet";
  if (clusterValue !== "localnet" && clusterValue !== "devnet") {
    throw new ConfigError("VOUCHVAULT_CLUSTER must be localnet or devnet.");
  }
  const cluster: VouchVaultCluster = clusterValue;
  const rpcUrl = parseRpcUrl(
    env.VOUCHVAULT_RPC_URL ?? DEFAULT_RPC_URLS[cluster],
  );
  if (cluster === "localnet") validateLocalnet(rpcUrl);
  else validateDevnet(rpcUrl);

  const rawQuoteMint = env.VOUCHVAULT_QUOTE_MINT?.trim();
  const quoteMint = rawQuoteMint ? validatePublicKey(rawQuoteMint) : undefined;
  return { cluster, rpcUrl, quoteMint };
}
