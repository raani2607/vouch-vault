import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import idl from "../generated/vouchvault_token.json";
import {
  assertGenesisForCluster,
  allocate,
  calculateTreasuryFeeSplit,
  calcVesting,
  CLUSTER,
  EXPLORER,
  formatDuration,
  formatUnits,
  parsePublicKey,
  rpcUrlForCluster,
  sanitizeDecimalInput,
  serializeU64,
  startupIdBytes,
  startupIdFromSlug,
  toBaseUnits,
  PROGRAM_ID,
} from "./config";
import {
  confirmSubmittedTransaction,
  deriveSchedule,
  deriveStartup,
  STARTUP_AUTHORITY_OFFSET,
  STARTUP_MINT_OFFSET,
  VESTING_BENEFICIARY_OFFSET,
  VESTING_STARTUP_OFFSET,
  type SubmittedTransactionError,
} from "./chain";
import {
  computeVestingTimeline,
  countCompletedLifecycleSteps,
  getStartupLifecycleSteps,
  validateVestingForm,
} from "./lifecycle";
import { transactionPhaseLabel, transitionTransaction } from "./transaction";
import {
  requireBeneficiaryWallet,
  requireConnectedWallet,
} from "./wallet-guard";

describe("Devnet and wallet guards", () => {
  it("accepts only the selected cluster fingerprint", () => {
    expect(rpcUrlForCluster("devnet")).toBe("https://api.devnet.solana.com");
    expect(rpcUrlForCluster("localnet")).toBe("http://127.0.0.1:8899");
    expect(() => rpcUrlForCluster("mainnet-beta")).toThrow(/VOUCHVAULT_CLUSTER/);
    expect(() =>
      assertGenesisForCluster(
        "devnet",
        "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      ),
    ).not.toThrow();
    expect(() => assertGenesisForCluster("devnet", "wrong")).toThrow(
      /genesis hash/,
    );
    expect(() => assertGenesisForCluster("mainnet-beta", "anything")).toThrow(
      /VOUCHVAULT_CLUSTER/,
    );
    expect(CLUSTER).toBe("devnet");
    expect(EXPLORER("sig123", "tx")).toBe(
      "https://explorer.solana.com/tx/sig123?cluster=devnet",
    );
  });
  it("requires a connected wallet and the recorded beneficiary", () => {
    const beneficiary = new PublicKey("11111111111111111111111111111111");
    expect(() => requireConnectedWallet(null)).toThrow(
      /Connect a Solana wallet/,
    );
    expect(requireBeneficiaryWallet(beneficiary, beneficiary)).toBe(
      beneficiary,
    );
    expect(() =>
      requireBeneficiaryWallet(
        new PublicKey("ComputeBudget111111111111111111111111111111"),
        beneficiary,
      ),
    ).toThrow(/recorded beneficiary/);
  });
  it("rejects malformed public keys", () => {
    expect(
      parsePublicKey("11111111111111111111111111111111").equals(
        PublicKey.default,
      ),
    ).toBe(true);
    expect(() => parsePublicKey("not-a-key")).toThrow(
      /valid Solana public key/,
    );
  });
});

describe("Amounts, allocations, and vesting", () => {
  it("generates stable exactly 32-byte identities from friendly names", async () => {
    const id = await startupIdFromSlug("Café Labs, Inc.");
    expect(id).toBe(await startupIdFromSlug("Cafe Labs Inc"));
    expect(new TextEncoder().encode(id)).toHaveLength(32);
    expect(startupIdBytes(id)).toHaveLength(32);
    expect(() => startupIdBytes("short-id")).toThrow(/exactly 32 UTF-8 bytes/);
  });
  it("converts decimal display values and comma-formatted inputs to base units", () => {
    expect(sanitizeDecimalInput(" 1,000,000.5 ")).toBe("1000000.5");
    expect(toBaseUnits("1,000.000007", 6)).toBe(1000000007n);
    expect(toBaseUnits("125.000007", 6)).toBe(125000007n);
    expect(formatUnits(125000007n, 6)).toBe("125.000007");
    expect(() => toBaseUnits("0.0000001", 6)).toThrow(/decimal places/);
    expect(() => toBaseUnits("-1", 6)).toThrow();
  });
  it("enforces exact allocation conservation and u64 serialization", () => {
    expect(allocate(1000n, [500n, 100n, 100n, 300n])).toBe(true);
    expect(allocate(1000n, [500n, 100n, 100n, 299n])).toBe(false);
    expect(serializeU64(18_446_744_073_709_551_615n).toString()).toBe(
      "18446744073709551615",
    );
    expect(() => serializeU64(18_446_744_073_709_551_616n)).toThrow(/u64/);
  });
  it("reports vested, claimed, claimable, and remaining amounts", () => {
    expect(calcVesting(11n, 2n, 100n, 200n, 300n, 250n)).toEqual({
      vested: 8n,
      claimed: 2n,
      claimable: 6n,
      remaining: 9n,
    });
    expect(calcVesting(11n, 0n, 100n, 200n, 300n, 199n).claimable).toBe(0n);
    expect(calcVesting(11n, 0n, 100n, 200n, 300n, 300n).claimable).toBe(11n);
  });
  it("computes the exact 1,000.000000 USDC fee & growth treasury split", () => {
    expect(calculateTreasuryFeeSplit(1_000_000_000n)).toEqual({
      grossNotional: 1_000_000_000n,
      effectiveNetNotional: 995_000_000n,
      totalFee: 5_000_000n,
      lpFee: 3_000_000n,
      protocolFee: 2_000_000n,
      growthTreasury: 1_000_000n,
      protocolReserve: 600_000n,
      riskOpsBuffer: 400_000n,
    });
  });
});

describe("Lifecycle progress, validation, and timeline metrics", () => {
  it("tracks exact missing steps for incomplete startups", () => {
    expect(countCompletedLifecycleSteps("uninitialized", 0)).toBe(0);
    const partial = getStartupLifecycleSteps("created", 0b0101);
    expect(partial.map((s) => s.status)).toEqual([
      "done",
      "done",
      "next",
      "done",
      "pending",
      "pending",
      "pending",
    ]);
    const funded = getStartupLifecycleSteps("funded", 0b1111);
    expect(funded[6]?.status).toBe("next");
    expect(countCompletedLifecycleSteps("finalized", 0b1111)).toBe(7);
  });

  it("validates vesting form inputs inline before submission", () => {
    const validId = "0123456789abcdef0123456789abcdef";
    const validKey = "11111111111111111111111111111111";
    const bad = validateVestingForm({
      scheduleId: "short",
      beneficiary: "bad-key",
      amount: "500",
      decimals: 6,
      remainingLocked: 100_000_000n,
      startTime: "2026-12-01T10:00",
      cliffTime: "2026-12-01T09:00",
      endTime: "2026-12-01T12:00",
    });
    expect(bad.valid).toBe(false);
    expect(bad.scheduleIdError).toContain("32 UTF-8 bytes");
    expect(bad.beneficiaryError).toContain("valid Solana public key");
    expect(bad.amountError).toContain("remaining locked reserve");
    expect(bad.timeError).toContain("between start and end");

    const ok = validateVestingForm({
      scheduleId: validId,
      beneficiary: validKey,
      amount: "50",
      decimals: 6,
      remainingLocked: 100_000_000n,
      startTime: "2026-12-01T10:00",
      cliffTime: "2026-12-01T11:00",
      endTime: "2026-12-01T14:00",
    });
    expect(ok.valid).toBe(true);
    expect(ok.parsedAmount).toBe(50_000_000n);
    expect(formatDuration(ok.durationSeconds)).toBe("4h");
  });

  it("computes vesting timeline percentages and cliff countdowns", () => {
    const preCliff = computeVestingTimeline({
      active: true,
      total: 1000n,
      claimed: 0n,
      claimable: 0n,
      startTs: 100n,
      cliffTs: 200n,
      endTs: 500n,
      nowTs: 150n,
    });
    expect(preCliff.statusLabel).toBe("Pre-cliff");
    expect(preCliff.secondsToCliff).toBe(50);
    expect(preCliff.cliffPct).toBe(25);

    const active = computeVestingTimeline({
      active: true,
      total: 1000n,
      claimed: 250n,
      claimable: 250n,
      startTs: 100n,
      cliffTs: 200n,
      endTs: 500n,
      nowTs: 300n,
    });
    expect(active.statusLabel).toBe("Vesting");
    expect(active.claimedPct).toBe(25);
    expect(active.claimablePct).toBe(25);
    expect(active.unvestedPct).toBe(50);
  });
});

describe("Generated client and transaction state", () => {
  it("keeps frontend program address, memcmp offsets, and IDL consistent", () => {
    expect(idl.address).toBe(PROGRAM_ID.toBase58());
    expect(STARTUP_AUTHORITY_OFFSET).toBe(8 + 32);
    expect(STARTUP_MINT_OFFSET).toBe(8 + 32 + 32);
    expect(VESTING_STARTUP_OFFSET).toBe(8);
    expect(VESTING_BENEFICIARY_OFFSET).toBe(8 + 32 + 32 + 32);
    expect(idl.instructions.map((item) => item.name).sort()).toEqual(
      [
        "activate_vesting_schedule",
        "claim_vested",
        "create_allocation_vault",
        "create_vesting_schedule",
        "finalize_startup",
        "fund_allocations",
        "initialize_startup",
      ].sort(),
    );
    const init = idl.instructions.find(
      (item) => item.name === "initialize_startup",
    )!;
    expect(init.accounts.map((account) => account.name)).toContain(
      "startup_authority",
    );
    expect(init.args[0]?.type).toEqual({ array: ["u8", 32] });
    expect(
      idl.accounts?.find((account) => account.name === "StartupConfig")
        ?.discriminator,
    ).toHaveLength(8);
    const fields = Object.fromEntries(
      (idl.types as { name: string; type: { fields?: { name: string }[] } }[])
        .filter((item) =>
          ["StartupConfig", "AllocationLedger", "VestingSchedule"].includes(
            item.name,
          ),
        )
        .map((item) => [
          item.name,
          item.type.fields?.map((field) => field.name),
        ]),
    );
    expect(fields).toEqual({
      StartupConfig: [
        "startup_id",
        "authority",
        "mint",
        "state",
        "bump",
        "authority_bump",
      ],
      AllocationLedger: [
        "startup",
        "created_by",
        "total_supply",
        "decimals",
        "allocations",
        "vaults",
        "vault_mask",
        "locked_amount_assigned",
        "finalized_at",
        "bump",
      ],
      VestingSchedule: [
        "startup",
        "startup_id",
        "schedule_id",
        "beneficiary",
        "mint",
        "escrow",
        "total_locked",
        "start_ts",
        "cliff_ts",
        "end_ts",
        "claimed",
        "active",
        "bump",
      ],
    });
  });
  it("derives stable but distinct vault and vesting PDAs", () => {
    const authority = new PublicKey("11111111111111111111111111111111");
    const startup = deriveStartup(
      authority,
      startupIdBytes("0123456789abcdef0123456789abcdef"),
    );
    expect(startup.mint.toBase58()).toBe(
      deriveStartup(
        authority,
        startupIdBytes("0123456789abcdef0123456789abcdef"),
      ).mint.toBase58(),
    );
    expect({
      startup: startup.startup.toBase58(),
      ledger: startup.ledger.toBase58(),
      mintAuthority: startup.mintAuthority.toBase58(),
      mint: startup.mint.toBase58(),
      vaults: startup.vaults.map((vault) => vault.toBase58()),
    }).toEqual({
      startup: "6MWQg2kjGbbcg6bMDs6Hgmwmb7Z8ziansCM4JmwkkYYX",
      ledger: "GCRv88sJyfhKfgERZnyXHycTZhXUXs2xWk9iRYAdZznq",
      mintAuthority: "6sotdVYYR3QT5jfvQD9Vvt4epCRboWAxKC3oACCBvUUs",
      mint: "4zzWDG89ZZ9jZ1SpBUEFYNDyK7HVxL2fuZNxC7eDfDrE",
      vaults: [
        "2qzQpaoCZD5soB4DDhU16x1VseW7xg99XBKohh8MUh8T",
        "9TFTpz5qmSiZL1p5RHraULxg9jf1UtCyWRmmmKRhfSRY",
        "9iRxj4N7XFgp4BY9nKkMNrvmfdVzsmq98yQkdMxnjwKi",
        "G6citcN9KrB5nsYNZaDiZZ3eiMGMr92j5UZuFPWigJ5t",
      ],
    });
    expect(new Set(startup.vaults.map((vault) => vault.toBase58())).size).toBe(
      4,
    );
    const schedule = deriveSchedule(
      startup.startup,
      startupIdBytes("schedule-00000000000000000000000"),
    );
    expect(schedule.schedule.toBase58()).toBe(
      "6DJQ4tYQWtStkECmVeCsypPbcj4bBZQmnvcbpEx1Ze5e",
    );
    expect(schedule.escrow.toBase58()).toBe(
      "BXcXWWioiCRwqujJ7fwmMeAMLU77BSykEWp2Ht6wyUxk",
    );
    expect(schedule.schedule).not.toEqual(startup.startup);
  });
  it("enforces transaction lifecycle and presents clear state labels", () => {
    let phase = transitionTransaction("idle", "preparing");
    phase = transitionTransaction(phase, "awaiting-wallet");
    phase = transitionTransaction(phase, "submitted");
    phase = transitionTransaction(phase, "confirming");
    phase = transitionTransaction(phase, "confirmed");
    expect(transactionPhaseLabel(phase)).toBe("Confirmed");
    expect(() => transitionTransaction("idle", "confirmed")).toThrow(
      /Invalid transaction transition/,
    );
    expect(transitionTransaction("awaiting-wallet", "failed")).toBe("failed");
  });
  it("confirms a submitted signature and preserves it if confirmation fails", async () => {
    const phases: string[] = [];
    const commitments: string[] = [];
    const rpc = {
      confirmTransaction: async (_strategy: unknown, commitment: string) => {
        void _strategy;
        commitments.push(commitment);
        return { context: { slot: 42 }, value: { err: null } };
      },
    } as unknown as Parameters<typeof confirmSubmittedTransaction>[0];
    await expect(
      confirmSubmittedTransaction(
        rpc,
        "signature-confirmed",
        { blockhash: "recent-blockhash", lastValidBlockHeight: 100 },
        (phase) => phases.push(phase),
      ),
    ).resolves.toBe("signature-confirmed");
    expect(phases).toEqual(["confirming", "confirmed", "finalized"]);
    expect(commitments).toEqual(["confirmed", "finalized"]);

    const timeoutRpc = {
      confirmTransaction: async () => {
        throw new Error("block height exceeded");
      },
    } as unknown as Parameters<typeof confirmSubmittedTransaction>[0];
    const timeoutPhases: string[] = [];
    await expect(
      confirmSubmittedTransaction(
        timeoutRpc,
        "signature-timeout",
        { blockhash: "recent-blockhash", lastValidBlockHeight: 100 },
        (phase) => timeoutPhases.push(phase),
      ),
    ).rejects.toMatchObject({
      name: "TransactionConfirmationTimeoutError",
      signature: "signature-timeout",
    } satisfies { name: string; signature: string });
    expect(timeoutPhases).toEqual(["confirming", "timed-out"]);

    const failedRpc = {
      confirmTransaction: async () => ({
        context: { slot: 43 },
        value: { err: { InstructionError: [0, "Custom"] } },
      }),
    } as unknown as Parameters<typeof confirmSubmittedTransaction>[0];
    await expect(
      confirmSubmittedTransaction(failedRpc, "signature-failed", {
        blockhash: "recent-blockhash",
        lastValidBlockHeight: 100,
      }),
    ).rejects.toMatchObject({
      name: "SubmittedTransactionError",
      signature: "signature-failed",
    } satisfies Partial<SubmittedTransactionError>);
  });
});
