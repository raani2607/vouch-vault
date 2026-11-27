"use client";

import React, { useMemo, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  allocate,
  CLUSTER,
  EXPLORER,
  PROGRAM_ID,
  sanitizeDecimalInput,
  startupIdFromSlug,
  toBaseUnits,
} from "@/lib/config";
import {
  BUCKET_METADATA,
  formatPercent,
  formatUnits,
  shorten,
} from "@/lib/format";
import { lifecycleStateName, type StartupData } from "@/lib/chain";
import { getStartupLifecycleSteps } from "@/lib/lifecycle";
import {
  transactionPhaseLabel,
  type TransactionPhase,
} from "@/lib/transaction";
import { CopyButton } from "./CopyButton";

export interface CreateStartupSubmitInput {
  name: string;
  startupId: string;
  totalBase: bigint;
  decimals: number;
  allocationBase: bigint[];
}

export function CreateStartupWizard({
  connected,
  publicKey,
  rpcVerified,
  programReady,
  busy,
  step,
  phase,
  signatures,
  startups,
  onCancel,
  onJumpToStartup,
  onReportError,
  onSubmit,
}: {
  connected: boolean;
  publicKey: PublicKey | null;
  rpcVerified: boolean | null;
  programReady: boolean | null;
  busy: boolean;
  step: string;
  phase: TransactionPhase;
  signatures: string[];
  startups: StartupData[];
  onCancel: () => void;
  onJumpToStartup: (startupAddress: string) => void;
  onReportError: (message: string) => void;
  onSubmit: (input: CreateStartupSubmitInput) => Promise<void>;
}) {
  const [createStep, setCreateStep] = useState(1);
  const [name, setName] = useState("");
  const [startupId, setStartupId] = useState("");
  const [allocationMode, setAllocationMode] = useState<"amount" | "percent">(
    "amount",
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [decimalsInput, setDecimalsInput] = useState("6");
  const [totalInput, setTotalInput] = useState("");
  const [allocInputs, setAllocInputs] = useState(["", "", "", ""]);

  const decimals = useMemo(() => {
    if (decimalsInput === "") return -1;
    const parsed = Number(decimalsInput);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 9 ? parsed : -1;
  }, [decimalsInput]);

  const validDecimals = decimals >= 0 && decimals <= 9;

  const totalBase = useMemo(() => {
    if (!validDecimals) return 0n;
    try {
      return totalInput ? toBaseUnits(totalInput, decimals) : 0n;
    } catch {
      return 0n;
    }
  }, [totalInput, decimals, validDecimals]);

  const allocationBase = useMemo(
    () =>
      allocInputs.map((raw) => {
        if (!validDecimals) return -1n;
        try {
          const v = sanitizeDecimalInput(raw);
          if (!v) return 0n;
          if (allocationMode === "amount") return toBaseUnits(v, decimals);
          const bps = toBaseUnits(v, 2);
          const product = totalBase * bps;
          if (product % 10_000n !== 0n) return -1n;
          return product / 10_000n;
        } catch {
          return -1n;
        }
      }),
    [allocInputs, decimals, validDecimals, allocationMode, totalBase],
  );

  const validAllocation =
    totalBase > 0n &&
    validDecimals &&
    allocationBase.every((value) => value >= 0n) &&
    totalBase <= 18_446_744_073_709_551_615n &&
    allocate(totalBase, allocationBase);

  const allocatedSum = allocationBase.every((v) => v >= 0n)
    ? allocationBase.reduce((a, b) => a + b, 0n)
    : -1n;
  const remainingUnits = allocatedSum >= 0n ? totalBase - allocatedSum : 0n;

  const byteCount = new TextEncoder().encode(startupId).length;
  const collidingStartup = startups.find(
    (item) =>
      Array.from(item.config.startupId).join(",") ===
      Array.from(new TextEncoder().encode(startupId)).join(","),
  );
  const idCollision = Boolean(collidingStartup);
  const collidingStage = collidingStartup
    ? lifecycleStateName(collidingStartup.config.state)
    : null;

  const validName = name.trim().length >= 2 && name.trim().length <= 64;
  const walletReady =
    connected && Boolean(programReady) && Boolean(rpcVerified);

  const liveProgressSteps = useMemo(() => {
    const allSteps = getStartupLifecycleSteps("uninitialized", 0);
    return allSteps.map((item, idx) => {
      if (idx < signatures.length) {
        return { ...item, status: "done" as const, sig: signatures[idx] };
      }
      if (idx === signatures.length && busy) {
        return { ...item, status: "next" as const, sig: undefined };
      }
      return { ...item, status: "pending" as const, sig: undefined };
    });
  }, [signatures, busy]);

  return (
    <section className="card create-wizard">
      <div className="wizard-top">
        <div>
          <span className="eyebrow">
            STARTUP ONBOARDING · STEP {createStep} OF 3
          </span>
          <h2>
            {createStep === 1
              ? "Create your startup token"
              : createStep === 2
                ? "Configure fixed supply & allocations"
                : "Review and initialize"}
          </h2>
          <p className="hint">
            {createStep === 1
              ? "Introduce your startup and generate its deterministic 32-byte on-chain identity."
              : createStep === 2
                ? "Set the fixed total supply and distribute 100% across the four controlled allocation buckets."
                : "Verify every parameter before signing the sequential on-chain lifecycle."}
          </p>
        </div>
        <span className="status warn">
          {CLUSTER === "devnet" ? "Solana Devnet" : "Localnet mode"}
        </span>
      </div>

      <div className="wizard-steps" aria-label="Creation progress">
        {["Startup information", "Token configuration", "Review & sign"].map(
          (label, i) => (
            <button
              type="button"
              key={label}
              className={
                createStep === i + 1
                  ? "wizard-step active"
                  : createStep > i + 1
                    ? "wizard-step done"
                    : "wizard-step"
              }
              onClick={() =>
                i + 1 < createStep && !busy && setCreateStep(i + 1)
              }
              aria-current={createStep === i + 1 ? "step" : undefined}
            >
              <span>{createStep > i + 1 ? "✓" : i + 1}</span>
              {label}
            </button>
          ),
        )}
      </div>

      {createStep === 1 && (
        <div className="wizard-panel">
          <div className="field">
            <label htmlFor="startup-name">Startup name</label>
            <input
              id="startup-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setStartupId("");
              }}
              placeholder="e.g. Mavuno Technologies"
              aria-invalid={Boolean(name) && !validName}
            />
            <small>
              {!name
                ? "Choose the display name founders and community will recognize."
                : validName
                  ? "Looks good."
                  : "Use 2–64 characters."}{" "}
              Saved in this browser only; M2 stores no on-chain name metadata.
            </small>
          </div>

          <div className="identity-preview">
            <div>
              <span className="label">Unique startup identity</span>
              <strong>
                {startupId && byteCount === 32 && !idCollision
                  ? "Ready · 32 bytes"
                  : idCollision
                    ? "Already exists onchain"
                    : "Generate an identity"}
              </strong>
              <small>
                {startupId
                  ? `ID: ${startupId}`
                  : "Determines your startup’s unique on-chain PDA seed."}
              </small>
            </div>
            <button
              type="button"
              className="quiet"
              disabled={!validName || busy}
              onClick={() =>
                void startupIdFromSlug(name)
                  .then(setStartupId)
                  .catch((e: unknown) =>
                    onReportError(
                      e instanceof Error ? e.message : "Could not generate ID.",
                    ),
                  )
              }
            >
              {startupId ? "Regenerate" : "Generate identity"}
            </button>
          </div>

          {collidingStartup && (
            <div className="collision-box" role="alert">
              <p className="inline-error" style={{ margin: 0 }}>
                {collidingStage === "finalized"
                  ? "A finalized startup already exists at this identity for your wallet."
                  : `An incomplete startup (${collidingStage}) already exists at this identity for your wallet.`}
              </p>
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  onJumpToStartup(collidingStartup.address.toBase58())
                }
              >
                {collidingStage === "finalized"
                  ? "Inspect existing startup"
                  : "Resume this incomplete startup"}
              </button>
            </div>
          )}

          <details
            className="advanced"
            open={advancedOpen}
            onToggle={(e) =>
              setAdvancedOpen((e.target as HTMLDetailsElement).open)
            }
          >
            <summary>Advanced identity details</summary>
            <div className="field">
              <label htmlFor="startup-id">Generated 32-byte identifier</label>
              <input
                id="startup-id"
                value={startupId}
                onChange={(e) => setStartupId(e.target.value)}
                disabled={busy}
                aria-describedby="id-note"
              />
              <small id="id-note">
                Deterministic 32-byte UTF-8 value passed verbatim to Anchor PDA
                seeds. {byteCount}/32 bytes.
              </small>
            </div>
          </details>
        </div>
      )}

      {createStep === 2 && (
        <div className="wizard-panel">
          <div className="fields">
            <div className="field full">
              <label htmlFor="total-supply">Total token supply</label>
              <input
                id="total-supply"
                inputMode="decimal"
                value={totalInput}
                onChange={(e) =>
                  setTotalInput(sanitizeDecimalInput(e.target.value))
                }
                placeholder="e.g. 1000000"
                aria-describedby="supply-note"
              />
              <small id="supply-note">
                Fixed total supply created during initialization.{" "}
                {totalBase > 0n && validDecimals
                  ? `${formatUnits(totalBase, decimals)} tokens`
                  : "Enter a positive amount."}
              </small>
            </div>
          </div>

          <details className="advanced">
            <summary>
              Advanced token settings (decimals:{" "}
              {validDecimals ? decimals : "invalid"})
            </summary>
            <div className="field">
              <label htmlFor="token-decimals">Token decimals (0–9)</label>
              <input
                id="token-decimals"
                inputMode="numeric"
                value={decimalsInput}
                onChange={(e) => {
                  const clean = e.target.value
                    .replace(/[^0-9]/g, "")
                    .slice(0, 1);
                  setDecimalsInput(clean);
                }}
                aria-invalid={!validDecimals}
              />
              <small>
                {validDecimals
                  ? "Controls token divisibility. Supported SPL range: 0–9."
                  : "Enter an integer between 0 and 9."}
              </small>
            </div>
          </details>

          <div className="allocation">
            <div className="allocation-heading">
              <div>
                <strong>Token allocation</strong>
                <small>
                  Set each bucket explicitly. No default percentages are
                  applied.
                </small>
              </div>
              <div
                className="segmented"
                role="group"
                aria-label="Allocation input mode"
              >
                <button
                  type="button"
                  className={allocationMode === "amount" ? "selected" : ""}
                  onClick={() => {
                    if (allocationMode !== "amount" && validDecimals)
                      setAllocInputs(
                        allocationBase.map((v) =>
                          v >= 0n ? formatUnits(v, decimals) : "",
                        ),
                      );
                    setAllocationMode("amount");
                  }}
                >
                  Amount
                </button>
                <button
                  type="button"
                  className={allocationMode === "percent" ? "selected" : ""}
                  disabled={
                    allocationMode === "amount" &&
                    allocationBase.some(
                      (v) =>
                        v >= 0n &&
                        totalBase > 0n &&
                        (v * 10_000n) % totalBase !== 0n,
                    )
                  }
                  title="Percentage mode needs an exact two-decimal percentage for every current allocation."
                  onClick={() => {
                    if (allocationMode !== "percent")
                      setAllocInputs(
                        allocationBase.map((v) =>
                          v >= 0n && totalBase
                            ? formatUnits((v * 10_000n) / totalBase, 2)
                            : "",
                        ),
                      );
                    setAllocationMode("percent");
                  }}
                >
                  Percentage
                </button>
              </div>
            </div>

            {BUCKET_METADATA.map((meta, index) => (
              <div className="allocation-item" key={meta.label}>
                <div className="allocation-label">
                  <strong>
                    <i className={`alloc-swatch ${meta.colorClass}`} />{" "}
                    {meta.label}
                  </strong>
                  <small>{meta.description}</small>
                </div>
                <div className="allocation-input">
                  <input
                    aria-label={`${meta.label} ${allocationMode}`}
                    inputMode="decimal"
                    value={allocInputs[index]}
                    onChange={(e) => {
                      const clean = sanitizeDecimalInput(e.target.value);
                      setAllocInputs((all) =>
                        all.map((v, i) => (i === index ? clean : v)),
                      );
                    }}
                    placeholder="0"
                  />
                  <span>{allocationMode === "amount" ? "tokens" : "%"}</span>
                  <small className="tabular">
                    {allocationBase[index]! >= 0n && validDecimals
                      ? `${formatUnits(allocationBase[index]!, decimals)} tokens · ${formatPercent(allocationBase[index]!, totalBase)}`
                      : "Must resolve to exact integer token base units."}
                  </small>
                </div>
              </div>
            ))}

            <div className="alloc-stacked-bar" aria-label="Allocated supply">
              {BUCKET_METADATA.map((meta, index) => {
                const amt = allocationBase[index] ?? 0n;
                const widthPct =
                  totalBase > 0n && amt > 0n
                    ? Math.min(100, Number((amt * 10_000n) / totalBase) / 100)
                    : 0;
                if (widthPct <= 0) return null;
                return (
                  <span
                    key={meta.label}
                    className={`alloc-segment ${meta.colorClass}`}
                    style={{ width: `${widthPct}%` }}
                  />
                );
              })}
            </div>

            <div className="allocation-totals tabular">
              <span>
                Supply{" "}
                <b>
                  {totalBase > 0n && validDecimals
                    ? formatUnits(totalBase, decimals)
                    : "—"}
                </b>
              </span>
              <span>
                Allocated{" "}
                <b>
                  {allocatedSum >= 0n && validDecimals
                    ? formatUnits(allocatedSum, decimals)
                    : "Invalid"}
                </b>
              </span>
              <span>
                {remainingUnits < 0n ? "Over by " : "Remaining "}
                <b>
                  {allocatedSum >= 0n && validDecimals
                    ? formatUnits(
                        remainingUnits < 0n ? -remainingUnits : remainingUnits,
                        decimals,
                      )
                    : "—"}
                </b>
              </span>
              <span
                className={
                  validAllocation ? "allocation-valid" : "allocation-invalid"
                }
              >
                {validAllocation
                  ? "Allocation balanced (100%)"
                  : "Must equal total supply"}
              </span>
            </div>
          </div>
        </div>
      )}

      {createStep === 3 && (
        <div className="wizard-panel">
          <div className="review">
            <span>Startup</span>
            <b>{name.trim() || "—"}</b>
            <span>Total supply</span>
            <b className="tabular">
              {totalBase > 0n ? formatUnits(totalBase, decimals) : "—"} tokens
            </b>
            <span>Token decimals</span>
            <b>{decimals}</b>
            {BUCKET_METADATA.map((meta, i) => (
              <React.Fragment key={meta.label}>
                <span>{meta.label}</span>
                <b className="tabular">
                  {formatUnits(allocationBase[i]!, decimals)} ·{" "}
                  {formatPercent(allocationBase[i]!, totalBase)}
                </b>
              </React.Fragment>
            ))}
            <span>Estimated rent &amp; fees</span>
            <b className="tabular">~0.0137 SOL (7 transactions)</b>
            <span>Wallet</span>
            <b className="mono">
              {publicKey
                ? shorten(publicKey.toBase58(), 10, 8)
                : "Connect wallet"}
            </b>
            <span>Program ID</span>
            <b className="mono">{shorten(PROGRAM_ID.toBase58(), 10, 8)}</b>
            <span>Network</span>
            <b>{CLUSTER === "devnet" ? "Solana Devnet" : "Localnet mode"}</b>
          </div>

          <details className="advanced">
            <summary>Technical details</summary>
            <div className="mono-details">
              <span>Startup identifier</span>
              <code>{startupId || "—"}</code>
              <span>Expected lifecycle</span>
              <code>
                1. Initialize identity and mint → 2–5. Create four allocation
                vaults → 6. Fund allocations → 7. Finalize fixed supply and
                revoke mint authority
              </code>
            </div>
          </details>

          <div className="notice">
            <strong>7 SEQUENTIAL SIGNATURES REQUIRED</strong>
            <span>
              Each lifecycle step is signed and confirmed separately so partial
              progress can always be resumed safely without double-minting.
            </span>
          </div>

          {(busy || signatures.length > 0) && (
            <div className="progressbox" style={{ marginTop: 14 }}>
              <b>{step || transactionPhaseLabel(phase)}</b>
              <p>
                {transactionPhaseLabel(phase)} · Completed {signatures.length}{" "}
                of 7 transactions
              </p>
              <ol className="stepper-list">
                {liveProgressSteps.map((item) => (
                  <li
                    key={item.operation}
                    className={`stepper-item ${item.status}`}
                  >
                    <span className="stepper-dot">
                      {item.status === "done"
                        ? "✓"
                        : item.status === "next"
                          ? "…"
                          : item.index + 1}
                    </span>
                    <div className="stepper-row">
                      <div>
                        <strong>{item.title}</strong>
                      </div>
                      {item.sig && (
                        <div className="inline">
                          <CopyButton value={item.sig} label="Copy signature" />
                          <a
                            href={EXPLORER(item.sig, "tx")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shorten(item.sig, 7, 5)} ↗
                          </a>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="wizard-actions">
        {createStep > 1 ? (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() => setCreateStep(createStep - 1)}
          >
            Back
          </button>
        ) : (
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        {createStep < 3 ? (
          <button
            type="button"
            className="primary"
            disabled={
              createStep === 1
                ? !(validName && startupId && byteCount === 32 && !idCollision)
                : !(totalBase > 0n && validAllocation)
            }
            title={
              createStep === 1 && !startupId
                ? "Generate a unique startup identity to continue."
                : undefined
            }
            onClick={() => setCreateStep(createStep + 1)}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={
              !walletReady ||
              !validName ||
              !validAllocation ||
              byteCount !== 32 ||
              idCollision ||
              busy
            }
            title={
              !connected
                ? "Connect your wallet to continue."
                : !rpcVerified
                  ? "Verify the RPC cluster first."
                  : !programReady
                    ? "Program must be deployed at the configured address."
                    : undefined
            }
            onClick={() =>
              void onSubmit({
                name: name.trim(),
                startupId,
                totalBase,
                decimals,
                allocationBase,
              })
            }
          >
            {busy
              ? `${transactionPhaseLabel(phase)} · ${step || "In progress"}`
              : "Initialize startup"}
          </button>
        )}
      </div>
    </section>
  );
}
