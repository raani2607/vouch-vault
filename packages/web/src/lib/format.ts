import type { PublicKey } from "@solana/web3.js";
import { formatUnits as formatBaseUnits } from "./config";
import type { DecodedActivityEvent, StartupData } from "./chain";
import type {
  StartupOperation,
  StartupTransactionRecord,
} from "./startup-history";

export type TxRow = {
  signature: string;
  slot: number;
  err: unknown;
  timestamp: number | null;
  events: DecodedActivityEvent[];
  source?: "locally recorded" | "RPC discovered" | "local + RPC";
  operation?: StartupOperation;
  recordedStatus?: StartupTransactionRecord["status"];
  resultingAccount?: string;
};

export const BUCKET_METADATA = [
  {
    label: "Market inventory",
    shortLabel: "Market",
    description:
      "Tokens reserved for the startup’s future market activities. This initialization does not create liquidity or enable trading.",
    colorClass: "alloc-market",
  },
  {
    label: "Startup reserve",
    shortLabel: "Startup",
    description: "Tokens reserved for the startup.",
    colorClass: "alloc-startup",
  },
  {
    label: "Community reserve",
    shortLabel: "Community",
    description: "Tokens allocated to the startup’s community.",
    colorClass: "alloc-community",
  },
  {
    label: "Locked reserve",
    shortLabel: "Locked",
    description:
      "Tokens placed in the vesting reserve for scheduled beneficiary distributions.",
    colorClass: "alloc-locked",
  },
] as const;

export const STARTUP_OPERATION_LABELS: Record<StartupOperation, string> = {
  "startup-creation": "Startup creation · identity and mint",
  "market-vault-creation": "Allocation vault · market inventory",
  "startup-vault-creation": "Allocation vault · startup reserve",
  "community-vault-creation": "Allocation vault · community reserve",
  "locked-vault-creation": "Allocation vault · locked reserve",
  "allocation-funding": "Vault funding · four allocations",
  "startup-finalization": "Startup finalization · fixed supply",
  "vesting-create": "Vesting · create escrow schedule",
  "vesting-activate": "Vesting · activate schedule",
  "vesting-claim": "Vesting · beneficiary token claim",
};

export const shorten = (value: string, a = 7, b = 5) =>
  value.length > a + b + 1 ? `${value.slice(0, a)}…${value.slice(-b)}` : value;

export const uint = (
  value: { toString(): string } | bigint | number | null | undefined,
): bigint => BigInt(value != null ? value.toString() : 0);

export const formatUnits = (value: bigint, decimals: number) =>
  Number.isInteger(decimals) && decimals >= 0 && decimals <= 9
    ? formatBaseUnits(value, decimals)
    : "Invalid";

export const formatPercent = (amount: bigint, total: bigint) =>
  total > 0n
    ? `${(Number((amount * 10_000n) / total) / 100).toFixed(2)}%`
    : "—";

export const address = (value: PublicKey | string) =>
  typeof value === "string" ? value : value.toBase58();

export function localStorageName(
  item: StartupData,
  authority?: string,
): string {
  if (typeof window === "undefined") return "";
  const keyAuthority = authority ?? item.config.authority.toBase58();
  return (
    localStorage.getItem(
      `attenza:name:${keyAuthority}:${item.address.toBase58()}`,
    ) ??
    localStorage.getItem(
      `attenza:name:${item.config.authority.toBase58()}:${item.address.toBase58()}`,
    ) ??
    ""
  );
}

export function saveLocalStartupName(
  startupAddress: string,
  authority: string,
  name: string,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `attenza:name:${authority}:${startupAddress}`,
      name.trim(),
    );
  } catch {
    // Ignore browser quota/privacy restrictions.
  }
}
