import type { StartupOperation } from "./startup-history";
import { parsePublicKey, startupIdBytes, toBaseUnits } from "./config";

export type LifecycleStage =
  "uninitialized" | "created" | "funded" | "finalized";

export type LifecycleStepStatus = "done" | "next" | "pending";

export interface LifecycleStepInfo {
  readonly index: number;
  readonly operation: StartupOperation;
  readonly title: string;
  readonly detail: string;
  readonly status: LifecycleStepStatus;
}

const STEP_DEFINITIONS: readonly {
  operation: StartupOperation;
  title: string;
  detail: string;
}[] = [
  {
    operation: "startup-creation",
    title: "Initialize startup & mint",
    detail:
      "Create StartupConfig, AllocationLedger, and temporary mint authority PDAs.",
  },
  {
    operation: "market-vault-creation",
    title: "Create market inventory vault",
    detail: "PDA-controlled SPL token account for future market inventory.",
  },
  {
    operation: "startup-vault-creation",
    title: "Create startup reserve vault",
    detail: "PDA-controlled SPL token account for startup reserve.",
  },
  {
    operation: "community-vault-creation",
    title: "Create community reserve vault",
    detail: "PDA-controlled SPL token account for community reserve.",
  },
  {
    operation: "locked-vault-creation",
    title: "Create locked reserve vault",
    detail: "PDA-controlled SPL token account backing vesting escrows.",
  },
  {
    operation: "allocation-funding",
    title: "Fund all four allocation vaults",
    detail:
      "Mint exact declared base-unit allocations into each controlled vault.",
  },
  {
    operation: "startup-finalization",
    title: "Finalize fixed supply",
    detail: "Verify balances and permanently revoke mint authority.",
  },
];

export function getStartupLifecycleSteps(
  stage: LifecycleStage,
  vaultMask: number,
): LifecycleStepInfo[] {
  let foundNext = false;
  return STEP_DEFINITIONS.map((def, index) => {
    let isDone = false;
    if (stage === "finalized") {
      isDone = true;
    } else if (stage === "funded") {
      isDone = index <= 5;
    } else if (stage === "created") {
      if (index === 0) isDone = true;
      else if (index >= 1 && index <= 4) {
        isDone = (vaultMask & (1 << (index - 1))) !== 0;
      }
    }

    if (isDone) {
      return { index, ...def, status: "done" };
    }
    if (!foundNext) {
      foundNext = true;
      return { index, ...def, status: "next" };
    }
    return { index, ...def, status: "pending" };
  });
}

export function countCompletedLifecycleSteps(
  stage: LifecycleStage,
  vaultMask: number,
): number {
  return getStartupLifecycleSteps(stage, vaultMask).filter(
    (step) => step.status === "done",
  ).length;
}

export interface VestingFormValidation {
  readonly valid: boolean;
  readonly scheduleIdError: string;
  readonly beneficiaryError: string;
  readonly amountError: string;
  readonly timeError: string;
  readonly durationSeconds: number;
  readonly cliffOffsetSeconds: number;
  readonly parsedAmount: bigint | null;
}

export function validateVestingForm(input: {
  scheduleId: string;
  beneficiary: string;
  amount: string;
  decimals: number;
  remainingLocked: bigint;
  startTime: string;
  cliffTime: string;
  endTime: string;
}): VestingFormValidation {
  let scheduleIdError = "";
  const idBytesLen = new TextEncoder().encode(input.scheduleId).length;
  if (!input.scheduleId) {
    scheduleIdError = "Generate or enter a 32-byte schedule ID.";
  } else if (idBytesLen !== 32) {
    try {
      startupIdBytes(input.scheduleId);
    } catch (err) {
      scheduleIdError =
        err instanceof Error ? err.message : "Schedule ID must be 32 bytes.";
    }
  }

  let beneficiaryError = "";
  if (!input.beneficiary.trim()) {
    beneficiaryError = "Enter the beneficiary wallet public key.";
  } else {
    try {
      parsePublicKey(input.beneficiary);
    } catch (err) {
      beneficiaryError =
        err instanceof Error ? err.message : "Invalid Solana public key.";
    }
  }

  let amountError = "";
  let parsedAmount: bigint | null = null;
  if (!input.amount.trim()) {
    amountError = "Enter the locked token amount.";
  } else {
    try {
      const value = toBaseUnits(input.amount, input.decimals);
      if (value <= 0n) {
        amountError = "Amount must be greater than zero.";
      } else if (value > input.remainingLocked) {
        amountError = "Exceeds the startup's remaining locked reserve.";
      } else {
        parsedAmount = value;
      }
    } catch (err) {
      amountError =
        err instanceof Error ? err.message : "Invalid token amount.";
    }
  }

  let timeError = "";
  let durationSeconds = 0;
  let cliffOffsetSeconds = 0;
  if (!input.startTime || !input.cliffTime || !input.endTime) {
    timeError = "Set start, cliff, and end timestamps.";
  } else {
    const start = Math.floor(new Date(input.startTime).getTime() / 1000);
    const cliff = Math.floor(new Date(input.cliffTime).getTime() / 1000);
    const end = Math.floor(new Date(input.endTime).getTime() / 1000);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(cliff) ||
      !Number.isFinite(end)
    ) {
      timeError = "Enter valid calendar dates and times.";
    } else if (start < 0 || start >= end) {
      timeError = "End time must be strictly after start time.";
    } else if (cliff < start || cliff > end) {
      timeError = "Cliff time must fall between start and end times.";
    } else {
      durationSeconds = end - start;
      cliffOffsetSeconds = cliff - start;
    }
  }

  return {
    valid: !scheduleIdError && !beneficiaryError && !amountError && !timeError,
    scheduleIdError,
    beneficiaryError,
    amountError,
    timeError,
    durationSeconds,
    cliffOffsetSeconds,
    parsedAmount,
  };
}

export interface VestingTimelineMetrics {
  readonly statusLabel:
    "Inactive" | "Before start" | "Pre-cliff" | "Vesting" | "Fully vested";
  readonly claimedPct: number;
  readonly claimablePct: number;
  readonly unvestedPct: number;
  readonly cliffPct: number;
  readonly elapsedPct: number;
  readonly secondsToCliff: number;
  readonly secondsToEnd: number;
}

export function computeVestingTimeline(input: {
  active: boolean;
  total: bigint;
  claimed: bigint;
  claimable: bigint;
  startTs: bigint;
  cliffTs: bigint;
  endTs: bigint;
  nowTs: bigint;
}): VestingTimelineMetrics {
  const { active, total, claimed, claimable, startTs, cliffTs, endTs, nowTs } =
    input;
  const duration = endTs > startTs ? endTs - startTs : 1n;
  const pct = (part: bigint, whole: bigint) =>
    whole > 0n
      ? Math.min(100, Math.max(0, Number((part * 10_000n) / whole) / 100))
      : 0;

  const claimedPct = pct(claimed, total);
  const claimablePct = Math.min(100 - claimedPct, pct(claimable, total));
  const unvestedPct = Math.max(0, 100 - claimedPct - claimablePct);

  const cliffPct = pct(cliffTs > startTs ? cliffTs - startTs : 0n, duration);
  const elapsedPct =
    nowTs <= startTs
      ? 0
      : nowTs >= endTs
        ? 100
        : pct(nowTs - startTs, duration);

  const secondsToCliff = nowTs < cliffTs ? Number(cliffTs - nowTs) : 0;
  const secondsToEnd = nowTs < endTs ? Number(endTs - nowTs) : 0;

  let statusLabel: VestingTimelineMetrics["statusLabel"] = "Vesting";
  if (!active) statusLabel = "Inactive";
  else if (nowTs < startTs) statusLabel = "Before start";
  else if (nowTs < cliffTs) statusLabel = "Pre-cliff";
  else if (nowTs >= endTs) statusLabel = "Fully vested";

  return {
    statusLabel,
    claimedPct,
    claimablePct,
    unvestedPct,
    cliffPct,
    elapsedPct,
    secondsToCliff,
    secondsToEnd,
  };
}
