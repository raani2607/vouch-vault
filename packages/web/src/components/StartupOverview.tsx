"use client";

import { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { decodeStartupId, EXPLORER } from "@/lib/config";
import {
  BUCKET_METADATA,
  STARTUP_OPERATION_LABELS,
  address,
  formatPercent,
  formatUnits,
  localStorageName,
  shorten,
  uint,
  type TxRow,
} from "@/lib/format";
import { lifecycleStateName, type StartupData } from "@/lib/chain";
import {
  countCompletedLifecycleSteps,
  getStartupLifecycleSteps,
} from "@/lib/lifecycle";
import { CopyButton } from "./CopyButton";

export function StartupOverview({
  connected,
  walletKey,
  startups,
  discoveredStartups,
  current,
  selected,
  onSelect,
  history,
  isRefreshing,
  busy,
  onRefresh,
  onNavigateCreate,
  onResumeStartup,
  onLookupStartup,
}: {
  connected: boolean;
  walletKey: PublicKey | null;
  startups: StartupData[];
  discoveredStartups: StartupData[];
  current: StartupData | undefined;
  selected: string;
  onSelect: (startupAddress: string) => void;
  history: TxRow[];
  isRefreshing: boolean;
  busy: boolean;
  onRefresh: () => void;
  onNavigateCreate: () => void;
  onResumeStartup: (startup: StartupData) => void;
  onLookupStartup: (query: string) => Promise<void>;
}) {
  const [directoryTab, setDirectoryTab] = useState<"managed" | "all">(
    connected ? "managed" : "all",
  );
  const [lookupInput, setLookupInput] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  const visibleList =
    directoryTab === "managed" && connected ? startups : discoveredStartups;
  const activeTab = !connected ? "all" : directoryTab;

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    setLookupError("");
    if (!lookupInput.trim()) return;
    setLookingUp(true);
    try {
      await onLookupStartup(lookupInput);
      setLookupInput("");
    } catch (err) {
      setLookupError(
        err instanceof Error ? err.message : "Could not locate startup.",
      );
    } finally {
      setLookingUp(false);
    }
  };

  const selectedName = current
    ? localStorageName(current, walletKey?.toBase58())
    : "";
  const currentStage = current
    ? lifecycleStateName(current.config.state)
    : "uninitialized";
  const isOwner = Boolean(
    current && walletKey && current.config.authority.equals(walletKey),
  );
  const lifecycleSteps = current
    ? getStartupLifecycleSteps(currentStage, Number(current.ledger.vaultMask))
    : [];
  const completedSteps = current
    ? countCompletedLifecycleSteps(
        currentStage,
        Number(current.ledger.vaultMask),
      )
    : 0;

  const creationRecord = history.find(
    (row) =>
      row.operation === "startup-creation" ||
      row.events.some((event) => event.name === "StartupTokenCreated"),
  );
  const finalizedRecord = history.find(
    (row) =>
      row.operation === "startup-finalization" ||
      row.events.some((event) => event.name === "TokenInitializationFinalized"),
  );

  const allocatedAmounts = current
    ? [
        uint(current.ledger.allocations.marketInventory),
        uint(current.ledger.allocations.startupReserve),
        uint(current.ledger.allocations.communityReserve),
        uint(current.ledger.allocations.lockedReserve),
      ]
    : [];
  const totalDeclared = current ? uint(current.ledger.totalSupply) : 0n;

  return (
    <div className="grid2">
      <section className="card">
        <div className="cardhead">
          <div>
            <div className="inline">
              <h2>
                {current
                  ? selectedName || "Startup token detail"
                  : "Startup token inspector"}
              </h2>
              {current && (
                <span className={`role-pill ${isOwner ? "owner" : "readonly"}`}>
                  {isOwner ? "Your authority" : "Read-only"}
                </span>
              )}
            </div>
            <p className="hint">
              {current
                ? `Authority ${shorten(address(current.config.authority))} · PDA ${shorten(current.address.toBase58())}`
                : "Inspect any onchain startup record or connect a wallet to create and manage your own."}
            </p>
          </div>
          <span
            className={`status ${
              current && currentStage === "finalized" ? "ok" : "warn"
            }`}
          >
            {current
              ? currentStage
              : connected
                ? "No selection"
                : "Public view"}
          </span>
        </div>

        {isRefreshing && !current ? (
          <div className="skeleton-stack" aria-label="Loading startup accounts">
            <div className="skeleton-line lg" />
            <div className="skeleton-grid">
              <div className="skeleton-box" />
              <div className="skeleton-box" />
              <div className="skeleton-box" />
            </div>
            <div className="skeleton-grid two">
              <div className="skeleton-box tall" />
              <div className="skeleton-box tall" />
            </div>
          </div>
        ) : !current ? (
          <div className="empty">
            {connected
              ? "No startup token records were found for this wallet. Look up an existing startup on the right, or initialize a new startup token."
              : "No startup token selected. Choose a discovered startup from the directory or look up a Startup PDA / Mint address."}
            {connected && (
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="quiet"
                  onClick={onNavigateCreate}
                >
                  Create a startup token
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {currentStage !== "finalized" && (
              <div className="resume-card">
                <div className="resume-head">
                  <div>
                    <span className="eyebrow">
                      INCOMPLETE LIFECYCLE · {completedSteps} OF 7 STEPS DONE
                    </span>
                    <h3>Complete startup initialization</h3>
                    <p className="hint">
                      {isOwner
                        ? "This startup has pending on-chain steps. Resume directly from the current PDA state without re-entering configuration."
                        : "Connect the startup authority wallet to complete the remaining setup steps."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    disabled={!isOwner || busy}
                    onClick={() => onResumeStartup(current)}
                  >
                    {busy ? "Resuming…" : "Resume & complete setup"}
                  </button>
                </div>
                <ol className="stepper-list">
                  {lifecycleSteps.map((s) => (
                    <li
                      key={s.operation}
                      className={`stepper-item ${s.status}`}
                    >
                      <span className="stepper-dot">
                        {s.status === "done"
                          ? "✓"
                          : s.status === "next"
                            ? "→"
                            : s.index + 1}
                      </span>
                      <div>
                        <strong>{s.title}</strong>
                        <small>{s.detail}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="detailgrid">
              <div className="detail">
                <label>Startup identity · 32 bytes</label>
                <div className="mono detail-row">
                  <span>{decodeStartupId(current.config.startupId)}</span>
                  <CopyButton
                    value={decodeStartupId(current.config.startupId)}
                    label="Copy startup identity"
                  />
                </div>
              </div>
              <div className="detail">
                <label>Mint address</label>
                <div className="mono detail-row">
                  <a
                    href={EXPLORER(address(current.config.mint))}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shorten(address(current.config.mint), 10, 8)} ↗
                  </a>
                  <CopyButton
                    value={address(current.config.mint)}
                    label="Copy mint address"
                  />
                </div>
              </div>
              <div className="detail">
                <label>Actual SPL mint supply</label>
                <div className="tabular">
                  {formatUnits(
                    current.mintState.supply,
                    current.mintState.decimals,
                  )}{" "}
                  tokens
                </div>
              </div>
              <div className="detail">
                <label>Mint authority</label>
                <div>
                  {current.mintState.mintAuthority === null
                    ? "Revoked · None"
                    : shorten(current.mintState.mintAuthority.toBase58())}
                </div>
              </div>
              <div className="detail">
                <label>Freeze authority</label>
                <div>
                  {current.mintState.freezeAuthority === null
                    ? "None"
                    : shorten(current.mintState.freezeAuthority.toBase58())}
                </div>
              </div>
              <div className="detail">
                <label>Finalized at</label>
                <div>
                  {uint(current.ledger.finalizedAt)
                    ? new Date(
                        Number(current.ledger.finalizedAt) * 1000,
                      ).toLocaleString()
                    : "Not finalized"}
                </div>
              </div>
              <div className="detail">
                <label>Creation transaction</label>
                <div>
                  {creationRecord ? (
                    <>
                      <div className="detail-row">
                        <a
                          className="mono"
                          href={EXPLORER(creationRecord.signature, "tx")}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shorten(creationRecord.signature, 9, 7)} ↗
                        </a>
                        <CopyButton
                          value={creationRecord.signature}
                          label="Copy creation signature"
                        />
                      </div>
                      <small className="smallnote">
                        {creationRecord.recordedStatus ??
                          (creationRecord.err ? "Failed" : "Confirmed")}{" "}
                        · {creationRecord.source ?? "RPC discovered"}
                      </small>
                    </>
                  ) : (
                    "No creation signature in local records or recent RPC history."
                  )}
                </div>
              </div>
              <div className="detail">
                <label>Finalization transaction</label>
                <div>
                  {finalizedRecord ? (
                    <>
                      <div className="detail-row">
                        <a
                          className="mono"
                          href={EXPLORER(finalizedRecord.signature, "tx")}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shorten(finalizedRecord.signature, 9, 7)} ↗
                        </a>
                        <CopyButton
                          value={finalizedRecord.signature}
                          label="Copy finalization signature"
                        />
                      </div>
                      <small className="smallnote">
                        {finalizedRecord.recordedStatus ??
                          (finalizedRecord.err ? "Failed" : "Confirmed")}{" "}
                        · {finalizedRecord.source ?? "RPC discovered"}
                      </small>
                    </>
                  ) : (
                    "No finalization signature in local records or recent RPC history."
                  )}
                </div>
              </div>
              <div className="detail">
                <label>Startup config PDA</label>
                <div className="mono detail-row">
                  <a
                    href={EXPLORER(current.address.toBase58())}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shorten(current.address.toBase58(), 9, 7)} ↗
                  </a>
                  <CopyButton
                    value={current.address.toBase58()}
                    label="Copy startup PDA"
                  />
                </div>
              </div>
            </div>

            <div className="section-subhead">
              <h2>
                Allocation vaults{" "}
                <span className="smallnote">
                  · allocated inventory, not active liquidity
                </span>
              </h2>
            </div>

            {totalDeclared > 0n && (
              <div className="alloc-viz" aria-label="Token allocation shares">
                <div className="alloc-stacked-bar">
                  {BUCKET_METADATA.map((meta, i) => {
                    const amount = allocatedAmounts[i] ?? 0n;
                    const widthPct =
                      totalDeclared > 0n
                        ? Number((amount * 10_000n) / totalDeclared) / 100
                        : 0;
                    if (widthPct <= 0) return null;
                    return (
                      <span
                        key={meta.label}
                        className={`alloc-segment ${meta.colorClass}`}
                        style={{ width: `${widthPct}%` }}
                        title={`${meta.label}: ${formatPercent(amount, totalDeclared)}`}
                      />
                    );
                  })}
                </div>
                <div className="alloc-legend">
                  {BUCKET_METADATA.map((meta, i) => {
                    const amount = allocatedAmounts[i] ?? 0n;
                    return (
                      <span key={meta.label} className="alloc-legend-item">
                        <i className={`alloc-swatch ${meta.colorClass}`} />
                        {meta.shortLabel}{" "}
                        <b className="tabular">
                          {formatPercent(amount, totalDeclared)}
                        </b>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="vaults">
              {current.vaults.map((vault, i) => {
                const meta = BUCKET_METADATA[i]!;
                const allocated = allocatedAmounts[i] ?? 0n;
                const isInitialized =
                  vault !== "11111111111111111111111111111111";
                return (
                  <div className="vault" key={`${meta.label}-${vault}-${i}`}>
                    <div className="vault-top">
                      <label>
                        <i className={`alloc-swatch ${meta.colorClass}`} />{" "}
                        {meta.label}
                      </label>
                      <span className="vault-pct tabular">
                        {formatPercent(allocated, totalDeclared)}
                      </span>
                    </div>
                    <strong className="tabular">
                      {formatUnits(
                        current.balances[i] ?? 0n,
                        current.ledger.decimals,
                      )}
                    </strong>
                    <small>
                      Current balance ·{" "}
                      {formatUnits(allocated, current.ledger.decimals)}{" "}
                      allocated
                    </small>
                    {isInitialized ? (
                      <>
                        <small className="detail-row">
                          <a
                            href={EXPLORER(vault)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Vault {shorten(vault, 10, 8)} ↗
                          </a>
                          <CopyButton
                            value={vault}
                            label="Copy vault address"
                          />
                        </small>
                        <small className="detail-row">
                          <a
                            href={EXPLORER(current.vaultAuthority.toBase58())}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Authority{" "}
                            {shorten(current.vaultAuthority.toBase58(), 8, 6)} ↗
                          </a>
                          <CopyButton
                            value={current.vaultAuthority.toBase58()}
                            label="Copy vault authority"
                          />
                        </small>
                      </>
                    ) : (
                      <small className="stat-warn">Vault not created yet</small>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="smallnote" style={{ marginTop: 12 }}>
              Market inventory is isolated in a program-controlled PDA vault and
              cannot be arbitrarily withdrawn by the founder authority.
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="cardhead">
          <div>
            <h2>Startup directory</h2>
            <p className="hint">
              Switch between startups managed by your wallet or inspect any
              onchain startup.
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

        <form className="lookup-form" onSubmit={handleLookup}>
          <label htmlFor="startup-lookup" className="sr-only">
            Lookup startup PDA or mint address
          </label>
          <input
            id="startup-lookup"
            value={lookupInput}
            onChange={(e) => {
              setLookupInput(e.target.value);
              setLookupError("");
            }}
            placeholder="Lookup by Startup PDA or Mint address…"
          />
          <button
            type="submit"
            className="quiet"
            disabled={lookingUp || !lookupInput.trim()}
          >
            {lookingUp ? "Finding…" : "Inspect"}
          </button>
        </form>
        {lookupError && <p className="inline-error">{lookupError}</p>}

        {connected && (
          <div
            className="segmented directory-toggle"
            role="group"
            aria-label="Startup directory filter"
          >
            <button
              type="button"
              className={activeTab === "managed" ? "selected" : ""}
              onClick={() => setDirectoryTab("managed")}
            >
              My startups ({startups.length})
            </button>
            <button
              type="button"
              className={activeTab === "all" ? "selected" : ""}
              onClick={() => setDirectoryTab("all")}
            >
              All onchain ({discoveredStartups.length})
            </button>
          </div>
        )}

        {isRefreshing && visibleList.length === 0 ? (
          <div className="skeleton-stack">
            <div className="skeleton-box" />
            <div className="skeleton-box" />
          </div>
        ) : visibleList.length === 0 ? (
          <div className="empty">
            {activeTab === "managed"
              ? "No startup records created by this wallet yet."
              : "No onchain startup records found on this cluster."}
          </div>
        ) : (
          <div className="tokenlist">
            {visibleList.map((item) => {
              const itemStage = lifecycleStateName(item.config.state);
              const isSelected =
                current?.address.equals(item.address) ||
                selected === item.address.toBase58();
              const owned = Boolean(
                walletKey && item.config.authority.equals(walletKey),
              );
              return (
                <button
                  type="button"
                  className={`tokenitem ${isSelected ? "selected" : ""}`}
                  key={item.address.toBase58()}
                  onClick={() => onSelect(item.address.toBase58())}
                >
                  <span>
                    <strong>
                      {localStorageName(item, walletKey?.toBase58()) ||
                        decodeStartupId(item.config.startupId) ||
                        shorten(item.address.toBase58())}
                    </strong>
                    <small>
                      {shorten(address(item.config.mint), 10, 8)} ·{" "}
                      <span
                        className={
                          itemStage === "finalized" ? "text-ok" : "text-warn"
                        }
                      >
                        {itemStage}
                      </span>
                      {owned ? " · yours" : ""}
                    </small>
                  </span>
                  <span className="amount tabular">
                    {formatUnits(
                      item.mintState.supply > 0n
                        ? item.mintState.supply
                        : uint(item.ledger.totalSupply),
                      item.ledger.decimals,
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          <div className="cardhead">
            <div>
              <h2>Recent activity</h2>
              <p className="hint">
                Merged locally recorded signatures and recent confirmed RPC
                account history.
              </p>
            </div>
          </div>
          {!history.length ? (
            <div className="smallnote">
              No transaction records are saved for this startup, and recent RPC
              discovery returned no activity.
            </div>
          ) : (
            <div className="siglist">
              {history.map((row) => {
                const statusText =
                  row.recordedStatus ?? (row.err ? "Failed" : "Confirmed");
                return (
                  <div className="sig sig-activity" key={row.signature}>
                    <div className="sig-meta">
                      <strong>
                        {row.operation
                          ? STARTUP_OPERATION_LABELS[row.operation]
                          : row.events.length
                            ? row.events
                                .map((event) =>
                                  event.name.replace(/([A-Z])/g, " $1"),
                                )
                                .join(", ")
                            : "Program transaction"}
                      </strong>
                      <small>
                        {row.slot ? `Slot ${row.slot} · ` : ""}
                        {row.timestamp
                          ? `${new Date(row.timestamp * 1000).toLocaleString()} · `
                          : ""}
                        <span
                          className={
                            statusText === "failed" || statusText === "Failed"
                              ? "text-err"
                              : "text-ok"
                          }
                        >
                          {statusText}
                        </span>{" "}
                        · {row.source ?? "RPC discovered"}
                      </small>
                    </div>
                    <div className="inline">
                      <CopyButton
                        value={row.signature}
                        label="Copy transaction signature"
                      />
                      <a
                        href={EXPLORER(row.signature, "tx")}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shorten(row.signature, 8, 6)} ↗
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
