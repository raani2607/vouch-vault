import { describe, expect, it } from "vitest";
import {
  createBrowserHistorySource,
  mergeStartupActivity,
  persistStartupTransaction,
  readStartupHistory,
  type StartupTransactionRecord,
} from "./startup-history";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const record = (
  overrides: Partial<StartupTransactionRecord> = {},
): StartupTransactionRecord => ({
  signature: "signature-1",
  startupAddress: "startup-pda-1",
  startupIdentity: "a".repeat(64),
  operation: "startup-creation",
  timestamp: 1_800_000_000_000,
  resultingAccount: "startup-pda-1",
  status: "finalized",
  ...overrides,
});

describe("startup transaction history persistence", () => {
  it("persists signatures with operation, time, identity and resulting account", () => {
    const storage = new MemoryStorage();
    const saved = record();
    persistStartupTransaction(storage as unknown as Storage, "wallet-1", saved);
    expect(
      readStartupHistory(
        storage as unknown as Storage,
        "wallet-1",
        "startup-pda-1",
      ),
    ).toEqual([saved]);
  });

  it("recovers records after a reload and scopes them to wallet and startup", () => {
    const storage = new MemoryStorage();
    persistStartupTransaction(
      storage as unknown as Storage,
      "wallet-1",
      record(),
    );
    expect(
      readStartupHistory(
        storage as unknown as Storage,
        "wallet-1",
        "startup-pda-1",
      ),
    ).toHaveLength(1);
    expect(
      readStartupHistory(
        storage as unknown as Storage,
        "wallet-2",
        "startup-pda-1",
      ),
    ).toEqual([]);
    expect(
      readStartupHistory(
        storage as unknown as Storage,
        "wallet-1",
        "startup-pda-2",
      ),
    ).toEqual([]);
  });

  it("shows locally saved signatures when RPC discovery has no result", () => {
    const result = mergeStartupActivity([record()], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("locally recorded");
    expect(result[0]?.local?.signature).toBe("signature-1");
  });

  it("suppresses duplicate signatures and labels overlapping local and RPC evidence", () => {
    const result = mergeStartupActivity<{ signature: string; slot: number }>(
      [record()],
      [{ signature: "signature-1", slot: 9 }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("local + RPC");
    expect(result[0]?.rpc?.slot).toBe(9);
    expect(result[0]?.local?.operation).toBe("startup-creation");
  });

  it("updates retained status for failed, submitted and confirmation-timeout recovery", () => {
    const storage = new MemoryStorage();
    persistStartupTransaction(
      storage as unknown as Storage,
      "wallet-1",
      record({ status: "submitted" }),
    );
    persistStartupTransaction(
      storage as unknown as Storage,
      "wallet-1",
      record({ status: "failed" }),
    );
    expect(
      readStartupHistory(
        storage as unknown as Storage,
        "wallet-1",
        "startup-pda-1",
      )[0]?.status,
    ).toBe("failed");
    persistStartupTransaction(
      storage as unknown as Storage,
      "wallet-1",
      record({ signature: "signature-timeout", status: "confirmed" }),
    );
    expect(
      readStartupHistory(
        storage as unknown as Storage,
        "wallet-1",
        "startup-pda-1",
      ).map((item) => item.status),
    ).toEqual(["failed", "confirmed"]);
  });

  it("returns a real empty state only when local and RPC history are both empty", () => {
    expect(mergeStartupActivity([], [])).toEqual([]);
    expect(
      mergeStartupActivity<{ signature: string; slot: number }>(
        [],
        [{ signature: "rpc-only", slot: 3 }],
      ),
    ).toHaveLength(1);
  });

  it("persists vesting create, activate, and claim via the HistorySource interface", () => {
    const storage = new MemoryStorage();
    const source = createBrowserHistorySource(storage as unknown as Storage);
    source.persist(
      "wallet-1",
      record({ signature: "sig-v-create", operation: "vesting-create" }),
    );
    source.persist(
      "wallet-1",
      record({ signature: "sig-v-activate", operation: "vesting-activate" }),
    );
    source.persist(
      "wallet-1",
      record({ signature: "sig-v-claim", operation: "vesting-claim" }),
    );
    expect(
      source.read("wallet-1", "startup-pda-1").map((item) => item.operation),
    ).toEqual(["vesting-create", "vesting-activate", "vesting-claim"]);
  });
});
