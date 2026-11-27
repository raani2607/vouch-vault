export type StartupOperation =
  | "startup-creation"
  | "market-vault-creation"
  | "startup-vault-creation"
  | "community-vault-creation"
  | "locked-vault-creation"
  | "allocation-funding"
  | "startup-finalization"
  | "vesting-create"
  | "vesting-activate"
  | "vesting-claim";

export type RecordedStatus = "submitted" | "confirmed" | "finalized" | "failed";

export type StartupTransactionRecord = {
  signature: string;
  startupAddress: string;
  startupIdentity: string;
  operation: StartupOperation;
  timestamp: number;
  resultingAccount: string;
  status: RecordedStatus;
};

/** Abstraction for transaction history providers (browser storage now;
 * reconcilable M5 indexer API projection in a future milestone). */
export interface HistorySource {
  read(wallet: string, startupAddress: string): StartupTransactionRecord[];
  persist(wallet: string, record: StartupTransactionRecord): void;
}

const STORAGE_PREFIX = "attenza:startup-transactions:v1:";
const VALID_STATUSES = new Set<string>([
  "submitted",
  "confirmed",
  "finalized",
  "failed",
]);

export function historyStorageKey(wallet: string, startupAddress: string) {
  return `${STORAGE_PREFIX}${wallet}:${startupAddress}`;
}

export function readStartupHistory(
  storage: Pick<Storage, "getItem">,
  wallet: string,
  startupAddress: string,
): StartupTransactionRecord[] {
  try {
    const raw = storage.getItem(historyStorageKey(wallet, startupAddress));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

export function persistStartupTransaction(
  storage: Pick<Storage, "getItem" | "setItem">,
  wallet: string,
  record: StartupTransactionRecord,
) {
  const records = readStartupHistory(storage, wallet, record.startupAddress);
  const index = records.findIndex(
    (item) => item.signature === record.signature,
  );
  if (index < 0) records.push(record);
  else records[index] = { ...records[index]!, ...record };
  try {
    storage.setItem(
      historyStorageKey(wallet, record.startupAddress),
      JSON.stringify(records),
    );
  } catch {
    // A storage quota or browser privacy setting must never change the
    // outcome of an already-submitted on-chain transaction.
  }
}

export function createBrowserHistorySource(
  storage: Pick<Storage, "getItem" | "setItem">,
): HistorySource {
  return {
    read: (wallet, startupAddress) =>
      readStartupHistory(storage, wallet, startupAddress),
    persist: (wallet, record) =>
      persistStartupTransaction(storage, wallet, record),
  };
}

export type ActivitySource =
  "locally recorded" | "RPC discovered" | "local + RPC";

export type MergedActivity<T extends { signature: string }> = {
  signature: string;
  source: ActivitySource;
  local?: StartupTransactionRecord;
  rpc?: T;
};

export function mergeStartupActivity<T extends { signature: string }>(
  local: readonly StartupTransactionRecord[],
  rpc: readonly T[],
): MergedActivity<T>[] {
  const bySignature = new Map<string, MergedActivity<T>>();
  for (const row of local) {
    bySignature.set(row.signature, {
      signature: row.signature,
      source: "locally recorded",
      local: row,
    });
  }
  for (const row of rpc) {
    const prior = bySignature.get(row.signature);
    bySignature.set(row.signature, {
      signature: row.signature,
      source: prior ? "local + RPC" : "RPC discovered",
      rpc: row,
      ...(prior?.local ? { local: prior.local } : {}),
    });
  }
  return [...bySignature.values()];
}

function isRecord(value: unknown): value is StartupTransactionRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StartupTransactionRecord>;
  return (
    typeof row.signature === "string" &&
    typeof row.startupAddress === "string" &&
    typeof row.startupIdentity === "string" &&
    typeof row.operation === "string" &&
    typeof row.timestamp === "number" &&
    typeof row.resultingAccount === "string" &&
    VALID_STATUSES.has(String(row.status))
  );
}
