export type TransactionPhase =
  | "idle"
  | "preparing"
  | "awaiting-wallet"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "finalized"
  | "timed-out"
  | "failed";

const transitions: Record<TransactionPhase, readonly TransactionPhase[]> = {
  idle: ["preparing"],
  preparing: ["awaiting-wallet", "failed"],
  "awaiting-wallet": ["submitted", "failed"],
  submitted: ["confirming", "failed"],
  confirming: ["confirmed", "timed-out", "failed"],
  confirmed: ["finalized", "timed-out", "failed", "preparing", "idle"],
  finalized: ["preparing", "idle"],
  "timed-out": ["preparing", "idle"],
  failed: ["preparing", "idle"],
};

export function transitionTransaction(
  from: TransactionPhase,
  to: TransactionPhase,
): TransactionPhase {
  if (!transitions[from].includes(to))
    throw new Error(`Invalid transaction transition: ${from} → ${to}`);
  return to;
}

export function transactionPhaseLabel(phase: TransactionPhase) {
  return {
    idle: "Idle",
    preparing: "Preparing",
    "awaiting-wallet": "Awaiting wallet approval",
    submitted: "Submitted",
    confirming: "Confirming",
    confirmed: "Confirmed",
    finalized: "Finalized",
    "timed-out": "Confirmation timed out · inspect original signature",
    failed: "Failed",
  }[phase];
}
