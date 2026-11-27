import { PublicKey } from "@solana/web3.js";

export type AttenzaCluster = "localnet" | "devnet";

export interface AttenzaChainConfig {
  readonly cluster: AttenzaCluster;
  readonly rpcUrl: URL;
  /** A syntactically valid public key; this does not prove an on-chain mint exists. */
  readonly quoteMint?: string | undefined;
}

export const LOCALNET_RPC = "http://127.0.0.1:8899";
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export const DEFAULT_RPC_URLS: Record<AttenzaCluster, string> = {
  localnet: LOCALNET_RPC,
  devnet: DEVNET_RPC,
};

export function rpcUrlForCluster(cluster: string): string {
  if (cluster === "devnet") return DEVNET_RPC;
  if (cluster === "localnet") return LOCALNET_RPC;
  throw new ConfigError("ATTENZA_CLUSTER must be localnet or devnet.");
}

export function assertGenesisForCluster(cluster: string, hash: string): void {
  if (cluster !== "devnet" && cluster !== "localnet") {
    throw new ConfigError("ATTENZA_CLUSTER must be localnet or devnet.");
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
  cluster: AttenzaCluster,
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
    throw new ConfigError("ATTENZA_RPC_URL must be a valid URL.");
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
      "ATTENZA_QUOTE_MINT must decode to a 32-byte Solana public key.",
    );
  }
}

/** Parse public, non-secret chain settings. This does not verify a quote mint on-chain. */
export function parseChainConfig(
  env: Readonly<Record<string, string | undefined>>,
): AttenzaChainConfig {
  for (const alias of [
    ...UNSUPPORTED_RPC_ALIASES,
    ...UNSUPPORTED_CLUSTER_ALIASES,
  ]) {
    if (env[alias] !== undefined) {
      throw new ConfigError(
        `${alias} is unsupported; use ATTENZA_CLUSTER and ATTENZA_RPC_URL.`,
      );
    }
  }

  const clusterValue = env.ATTENZA_CLUSTER ?? "localnet";
  if (clusterValue !== "localnet" && clusterValue !== "devnet") {
    throw new ConfigError("ATTENZA_CLUSTER must be localnet or devnet.");
  }
  const cluster: AttenzaCluster = clusterValue;
  const rpcUrl = parseRpcUrl(env.ATTENZA_RPC_URL ?? DEFAULT_RPC_URLS[cluster]);
  if (cluster === "localnet") validateLocalnet(rpcUrl);
  else validateDevnet(rpcUrl);

  const rawQuoteMint = env.ATTENZA_QUOTE_MINT?.trim();
  const quoteMint = rawQuoteMint ? validatePublicKey(rawQuoteMint) : undefined;
  return { cluster, rpcUrl, quoteMint };
}
