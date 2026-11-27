"use client";

import { useMemo, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  calcVesting,
  decodeStartupId,
  EXPLORER,
  formatDuration,
  sanitizeDecimalInput,
  startupIdFromSlug,
} from "@/lib/config";
import { formatUnits, localStorageName, shorten, uint } from "@/lib/format";
import {
  lifecycleStateName,
  type ScheduleData,
  type StartupData,
} from "@/lib/chain";
import { computeVestingTimeline, validateVestingForm } from "@/lib/lifecycle";
import { CopyButton } from "./CopyButton";

function toLocalDateTimeInput(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface VestingSubmitInput {
  startup: StartupData;
  scheduleId: string;
  beneficiary: string;
  amount: string;
  startTime: string;
  cliffTime: string;
  endTime: string;
}

export function VestingManager({
  connected,
  publicKey,
  programReady,
  rpcVerified,
  busy,
  isRefreshing,
  startups,
  discoveredStartups,
  current,
  onSelectStartup,
  schedules,
  now,
  onRefresh,
  onCreateSchedule,
  onActivateSchedule,
  onClaimSchedule,
  onReportError,
}: {
  connected: boolean;
  publicKey: PublicKey | null;
  programReady: boolean | null;
  rpcVerified: boolean | null;
  busy: boolean;
  isRefreshing: boolean;
  startups: StartupData[];
  discoveredStartups: StartupData[];
  current: StartupData | undefined;
  onSelectStartup: (startupAddress: string) => void;
  schedules: ScheduleData[];
  now: bigint;
  onRefresh: () => void;
  onCreateSchedule: (input: VestingSubmitInput) => Promise<void>;
  onActivateSchedule: (schedule: ScheduleData) => Promise<void>;
  onClaimSchedule: (schedule: ScheduleData) => Promise<void>;
  onReportError: (message: string) => void;
}) {
  const [scheduleLabel, setScheduleLabel] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [vestAmount, setVestAmount] = useState("");
  const [startTime, setStartTime] = useState("");
  const [cliffTime, setCliffTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "beneficiary" | "authority"
  >("all");
  const [touched, setTouched] = useState(false);

  const managedCurrent = useMemo(
    () =>
      (current && startups.find((s) => s.address.equals(current.address))) ??
      startups[0],
    [current, startups],
  );

  const remainingLocked = managedCurrent
    ? uint(managedCurrent.ledger.allocations.lockedReserve) -
      uint(managedCurrent.ledger.lockedAmountAssigned)
    : 0n;

  const validation = useMemo(
    () =>
      validateVestingForm({
        scheduleId,
        beneficiary,
        amount: vestAmount,
        decimals: managedCurrent?.ledger.decimals ?? 6,
        remainingLocked,
        startTime,
        cliffTime,
        endTime,
      }),
    [
      scheduleId,
      beneficiary,
      vestAmount,
      managedCurrent,
      remainingLocked,
      startTime,
      cliffTime,
      endTime,
    ],
  );

  const applyPreset = (
    startOffsetSec: number,
    cliffOffsetSec: number,
    endOffsetSec: number,
  ) => {
    const base = Math.floor(Date.now() / 1000);
    setStartTime(toLocalDateTimeInput(base + startOffsetSec));
    setCliffTime(toLocalDateTimeInput(base + cliffOffsetSec));
    setEndTime(toLocalDateTimeInput(base + endOffsetSec));
  };

  const generateScheduleId = async () => {
    const seedInput =
      scheduleLabel.trim() ||
      `vest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const id = await startupIdFromSlug(
        `${seedInput}-${Math.floor(Date.now() / 1000)}`,
      );
      setScheduleId(id);
    } catch (err) {
      onReportError(
        err instanceof Error ? err.message : "Could not generate schedule ID.",
      );
    }
  };

  const startupLookup = useMemo(() => {
    const map = new Map<string, StartupData>();
    for (const item of [...discoveredStartups, ...startups]) {
      map.set(item.address.toBase58(), item);
    }
    return map;
  }, [startups, discoveredStartups]);

  const beneficiarySchedules = useMemo(
    () =>
      schedules.filter(
        (s) => publicKey && s.data.beneficiary.equals(publicKey),
      ),
    [schedules, publicKey],
  );
  const authoritySchedules = useMemo(
    () =>
      schedules.filter((s) => {
        const st = startupLookup.get(s.data.startup.toBase58());
        return Boolean(
          st && publicKey && st.config.authority.equals(publicKey),
        );
      }),
    [schedules, startupLookup, publicKey],
  );
  const filteredSchedules = useMemo(() => {
    if (roleFilter === "beneficiary") return beneficiarySchedules;
    if (roleFilter === "authority") return authoritySchedules;
    return schedules;
  }, [roleFilter, schedules, beneficiarySchedules, authoritySchedules]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!managedCurrent || !validation.valid) return;
    await onCreateSchedule({
      startup: managedCurrent,
      scheduleId,
      beneficiary,
      amount: vestAmount,
      startTime,
      cliffTime,
      endTime,
    });
  };

  return (
    <div className="grid2">
      <section className="card">
        <div className="cardhead">
          <div>
            <h2>Create a vesting schedule</h2>
            <p className="hint">
              Escrows tokens from the finalized locked reserve and activates an
              immutable release schedule.
            </p>
          </div>
          <span
            className={`status ${
              managedCurrent &&
              lifecycleStateName(managedCurrent.config.state) === "finalized"
                ? "ok"
                : "warn"
            }`}
          >
            {managedCurrent
              ? lifecycleStateName(managedCurrent.config.state)
              : "Select startup"}
          </span>
        </div>

        {!managedCurrent || startups.length === 0 ? (
          <div className="empty">
            Connect a startup authority wallet with a finalized startup token to
            create vesting schedules. Beneficiaries can view and claim their
            schedules on the right.
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor="vest-startup">Startup</label>
              <select
                id="vest-startup"
                value={managedCurrent.address.toBase58()}
                onChange={(e) => onSelectStartup(e.target.value)}
              >
                {startups.map((s) => (
                  <option
                    key={s.address.toBase58()}
                    value={s.address.toBase58()}
                  >
                    {localStorageName(s, publicKey?.toBase58()) ||
                      decodeStartupId(s.config.startupId) ||
                      shorten(s.address.toBase58())}{" "}
                    · {lifecycleStateName(s.config.state)}
                  </option>
                ))}
              </select>
            </div>

            <div className="fields">
              <div className="field full">
                <label htmlFor="vest-label">
                  Schedule label (optional helper for ID generation)
                </label>
                <div className="inline-input-btn">
                  <input
                    id="vest-label"
                    value={scheduleLabel}
                    onChange={(e) => setScheduleLabel(e.target.value)}
                    placeholder="e.g. Core Contributor Q4"
                  />
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => void generateScheduleId()}
                    disabled={busy}
                  >
                    Generate 32-byte ID
                  </button>
                </div>
              </div>

              <div className="field full">
                <label htmlFor="vest-schedule-id">
                  Schedule ID · exactly 32 UTF-8 bytes
                </label>
                <input
                  id="vest-schedule-id"
                  value={scheduleId}
                  onChange={(e) => setScheduleId(e.target.value)}
                  placeholder="Generate above or enter 32-byte identifier"
                  aria-invalid={touched && Boolean(validation.scheduleIdError)}
                />
                <small>
                  {new TextEncoder().encode(scheduleId).length}/32 bytes
                  {touched && validation.scheduleIdError ? (
                    <span className="inline-error">
                      {" "}
                      · {validation.scheduleIdError}
                    </span>
                  ) : null}
                </small>
              </div>

              <div className="field full">
                <label htmlFor="vest-beneficiary">Beneficiary public key</label>
                <input
                  id="vest-beneficiary"
                  value={beneficiary}
                  onChange={(e) => setBeneficiary(e.target.value)}
                  placeholder="Solana wallet address"
                  aria-invalid={
                    (touched || Boolean(beneficiary)) &&
                    Boolean(validation.beneficiaryError)
                  }
                />
                {(touched || Boolean(beneficiary)) &&
                  validation.beneficiaryError && (
                    <small className="inline-error">
                      {validation.beneficiaryError}
                    </small>
                  )}
              </div>

              <div className="field full">
                <label htmlFor="vest-amount">
                  Locked amount · {managedCurrent.ledger.decimals} decimals
                </label>
                <div className="inline-input-btn">
                  <input
                    id="vest-amount"
                    inputMode="decimal"
                    value={vestAmount}
                    onChange={(e) =>
                      setVestAmount(sanitizeDecimalInput(e.target.value))
                    }
                    placeholder="Amount from remaining locked reserve"
                    aria-invalid={
                      (touched || Boolean(vestAmount)) &&
                      Boolean(validation.amountError)
                    }
                  />
                  <button
                    type="button"
                    className="quiet"
                    disabled={remainingLocked <= 0n || busy}
                    onClick={() =>
                      setVestAmount(
                        formatUnits(
                          remainingLocked,
                          managedCurrent.ledger.decimals,
                        ),
                      )
                    }
                  >
                    Max
                  </button>
                </div>
                {(touched || Boolean(vestAmount)) && validation.amountError && (
                  <small className="inline-error">
                    {validation.amountError}
                  </small>
                )}
              </div>

              <div className="field full">
                <label>Quick schedule presets (local time)</label>
                <div className="preset-row">
                  <button
                    type="button"
                    className="preset-btn"
                    onClick={() => applyPreset(60, 120, 600)}
                  >
                    Demo (+1m / +2m / +10m)
                  </button>
                  <button
                    type="button"
                    className="preset-btn"
                    onClick={() => applyPreset(60, 30 * 86_400, 180 * 86_400)}
                  >
                    30d cliff / 6m vest
                  </button>
                  <button
                    type="button"
                    className="preset-btn"
                    onClick={() =>
                      applyPreset(60, 365 * 86_400, 4 * 365 * 86_400)
                    }
                  >
                    1y cliff / 4y vest
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="vest-start">Start time</label>
                <input
                  id="vest-start"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="vest-cliff">Cliff time</label>
                <input
                  id="vest-cliff"
                  type="datetime-local"
                  value={cliffTime}
                  onChange={(e) => setCliffTime(e.target.value)}
                />
              </div>
              <div className="field full">
                <label htmlFor="vest-end">End time</label>
                <input
                  id="vest-end"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
                {validation.timeError ? (
                  (touched || startTime || cliffTime || endTime) && (
                    <small className="inline-error">
                      {validation.timeError}
                    </small>
                  )
                ) : (
                  <small>
                    Cliff after {formatDuration(validation.cliffOffsetSeconds)}{" "}
                    · Total linear vest{" "}
                    {formatDuration(validation.durationSeconds)}
                  </small>
                )}
              </div>
            </div>

            <div className="review">
              <span>Startup authority signer</span>
              <b className="mono">
                {publicKey ? shorten(publicKey.toBase58()) : "Connect wallet"}
              </b>
              <span>Beneficiary / claim destination</span>
              <b>Immutable; program enforces beneficiary wallet</b>
              <span>Remaining locked reserve</span>
              <b className="tabular">
                {formatUnits(remainingLocked, managedCurrent.ledger.decimals)}{" "}
                tokens
              </b>
            </div>

            <button
              type="submit"
              className="primary"
              disabled={
                !connected ||
                !programReady ||
                !rpcVerified ||
                busy ||
                lifecycleStateName(managedCurrent.config.state) !==
                  "finalized" ||
                !validation.valid
              }
            >
              {busy
                ? "Transaction in progress…"
                : "Create and activate schedule"}
            </button>
          </form>
        )}
      </section>

      <section className="card">
        <div className="cardhead">
          <div>
            <h2>Schedules &amp; claims</h2>
            <p className="hint">
              Schedules owned by your selected startup or naming your wallet as
              beneficiary.
            </p>
          </div>
          <button
            type="button"
            className="quiet"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div
          className="segmented directory-toggle"
          role="group"
          aria-label="Filter vesting schedules by role"
        >
          <button
            type="button"
            className={roleFilter === "all" ? "selected" : ""}
            onClick={() => setRoleFilter("all")}
          >
            All ({schedules.length})
          </button>
          <button
            type="button"
            className={roleFilter === "beneficiary" ? "selected" : ""}
            onClick={() => setRoleFilter("beneficiary")}
          >
            Beneficiary ({beneficiarySchedules.length})
          </button>
          <button
            type="button"
            className={roleFilter === "authority" ? "selected" : ""}
            onClick={() => setRoleFilter("authority")}
          >
            Authority ({authoritySchedules.length})
          </button>
        </div>

        {isRefreshing && filteredSchedules.length === 0 ? (
          <div className="skeleton-stack">
            <div className="skeleton-box tall" />
            <div className="skeleton-box tall" />
          </div>
        ) : !filteredSchedules.length ? (
          <div className="empty">
            No matching onchain schedules found for this filter.
          </div>
        ) : (
          <div className="tokenlist">
            {filteredSchedules.map((row) => {
              const d = row.data;
              const totals = calcVesting(
                uint(d.totalLocked),
                uint(d.claimed),
                uint(d.startTs),
                uint(d.cliffTs),
                uint(d.endTs),
                now,
              );
              const active = Boolean(d.active);
              const isBeneficiary = Boolean(
                publicKey && d.beneficiary.equals(publicKey),
              );
              const parentStartup = startupLookup.get(d.startup.toBase58());
              const isAuthority = Boolean(
                parentStartup &&
                publicKey &&
                parentStartup.config.authority.equals(publicKey),
              );
              const startupLabel =
                (parentStartup
                  ? localStorageName(parentStartup, publicKey?.toBase58()) ||
                    decodeStartupId(parentStartup.config.startupId)
                  : "") || shorten(d.startup.toBase58());

              const timeline = computeVestingTimeline({
                active,
                total: uint(d.totalLocked),
                claimed: uint(d.claimed),
                claimable: totals.claimable,
                startTs: uint(d.startTs),
                cliffTs: uint(d.cliffTs),
                endTs: uint(d.endTs),
                nowTs: now,
              });

              return (
                <article className="schedule-card" key={row.address.toBase58()}>
                  <div className="schedule-head">
                    <div>
                      <div className="inline">
                        <strong>{startupLabel}</strong>
                        <span
                          className={`role-pill ${
                            isBeneficiary
                              ? "owner"
                              : isAuthority
                                ? "authority"
                                : "readonly"
                          }`}
                        >
                          {isBeneficiary
                            ? "You are beneficiary"
                            : isAuthority
                              ? "Startup authority"
                              : "Observer"}
                        </span>
                      </div>
                      <small className="mono inline-meta">
                        Schedule {shorten(row.address.toBase58(), 8, 6)}
                        <CopyButton
                          value={row.address.toBase58()}
                          label="Copy schedule address"
                        />
                      </small>
                    </div>
                    <span
                      className={`status ${
                        active && totals.claimable > 0n
                          ? "ok"
                          : active
                            ? "ok"
                            : "warn"
                      }`}
                    >
                      {timeline.statusLabel}
                    </span>
                  </div>

                  <div className="vesting-bar-wrap">
                    <div
                      className="vesting-bar"
                      aria-label="Vesting release progress"
                    >
                      <span
                        className="vest-seg-claimed"
                        style={{ width: `${timeline.claimedPct}%` }}
                        title={`Claimed: ${timeline.claimedPct.toFixed(1)}%`}
                      />
                      <span
                        className="vest-seg-claimable"
                        style={{ width: `${timeline.claimablePct}%` }}
                        title={`Claimable now: ${timeline.claimablePct.toFixed(1)}%`}
                      />
                      {timeline.cliffPct > 0 && timeline.cliffPct < 100 && (
                        <i
                          className="vest-cliff-pin"
                          style={{ left: `${timeline.cliffPct}%` }}
                          title="Cliff unlock threshold"
                        />
                      )}
                    </div>
                    <div className="vesting-bar-legend">
                      <span>
                        <i className="alloc-swatch vest-swatch-claimed" />{" "}
                        Claimed {timeline.claimedPct.toFixed(1)}%
                      </span>
                      <span>
                        <i className="alloc-swatch vest-swatch-claimable" />{" "}
                        Claimable {timeline.claimablePct.toFixed(1)}%
                      </span>
                      <span className="countdown-label">
                        {timeline.secondsToCliff > 0
                          ? `Cliff in ${formatDuration(timeline.secondsToCliff)}`
                          : timeline.secondsToEnd > 0
                            ? `Ends in ${formatDuration(timeline.secondsToEnd)}`
                            : "Schedule ended"}
                      </span>
                    </div>
                  </div>

                  <div className="detailgrid" style={{ marginTop: 12 }}>
                    <div className="detail">
                      <label>Beneficiary</label>
                      <div className="mono detail-row">
                        <span>{shorten(d.beneficiary.toBase58())}</span>
                        <CopyButton
                          value={d.beneficiary.toBase58()}
                          label="Copy beneficiary address"
                        />
                      </div>
                    </div>
                    <div className="detail">
                      <label>Total locked</label>
                      <div className="tabular">
                        {formatUnits(uint(d.totalLocked), row.decimals)}
                      </div>
                    </div>
                    <div className="detail">
                      <label>Vested / claimed</label>
                      <div className="tabular">
                        {formatUnits(totals.vested, row.decimals)} /{" "}
                        {formatUnits(totals.claimed, row.decimals)}
                      </div>
                    </div>
                    <div className="detail">
                      <label>Claimable now</label>
                      <div className="tabular text-ok">
                        {formatUnits(totals.claimable, row.decimals)}
                      </div>
                    </div>
                    <div className="detail">
                      <label>Remaining locked</label>
                      <div className="tabular">
                        {formatUnits(totals.remaining, row.decimals)}
                      </div>
                    </div>
                    <div className="detail">
                      <label>Mint</label>
                      <div className="mono detail-row">
                        <a
                          href={EXPLORER(d.mint.toBase58())}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shorten(d.mint.toBase58(), 7, 5)} ↗
                        </a>
                        <CopyButton
                          value={d.mint.toBase58()}
                          label="Copy mint address"
                        />
                      </div>
                    </div>
                    <div className="detail">
                      <label>Start time</label>
                      <div>
                        {new Date(
                          Number(uint(d.startTs)) * 1000,
                        ).toLocaleString()}
                      </div>
                    </div>
                    <div className="detail">
                      <label>Cliff time</label>
                      <div>
                        {new Date(
                          Number(uint(d.cliffTs)) * 1000,
                        ).toLocaleString()}
                      </div>
                    </div>
                    <div className="detail">
                      <label>End time</label>
                      <div>
                        {new Date(
                          Number(uint(d.endTs)) * 1000,
                        ).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {isBeneficiary && row.beneficiaryAta && (
                    <div className="ata-status">
                      {row.beneficiaryAta.exists ? (
                        <span>
                          Your token account holds{" "}
                          <b className="tabular">
                            {formatUnits(
                              row.beneficiaryAta.balance,
                              row.decimals,
                            )}
                          </b>{" "}
                          tokens.
                        </span>
                      ) : (
                        <span>
                          Your token account will be created automatically
                          inside your single claim transaction (~0.00204 SOL
                          rent).
                        </span>
                      )}
                    </div>
                  )}

                  <div className="schedule-actions">
                    <a
                      className="smallnote"
                      href={EXPLORER(row.address.toBase58())}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Schedule account ↗
                    </a>
                    <div className="inline">
                      {!active && isAuthority && (
                        <button
                          type="button"
                          className="primary"
                          disabled={busy || !connected}
                          onClick={() => void onActivateSchedule(row)}
                        >
                          {busy ? "Activating…" : "Activate schedule"}
                        </button>
                      )}
                      {isBeneficiary && (
                        <button
                          type="button"
                          className="quiet"
                          disabled={!active || totals.claimable === 0n || busy}
                          title={
                            !active
                              ? "Schedule must be activated by startup authority first."
                              : totals.claimable === 0n
                                ? "No vested tokens are currently claimable."
                                : "Sign one transaction to claim vested tokens."
                          }
                          onClick={() => void onClaimSchedule(row)}
                        >
                          {busy ? "Claiming…" : "Claim vested"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className="smallnote" style={{ marginTop: 12 }}>
          Claims are beneficiary-only. The connected wallet must match the
          recorded beneficiary; claims cannot redirect tokens.
        </p>
      </section>
    </div>
  );
}
