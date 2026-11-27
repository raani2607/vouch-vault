"use client";

import { CLUSTER, EXPLORER, PROGRAM_ID } from "@/lib/config";
import { shorten } from "@/lib/format";
import { CopyButton } from "./CopyButton";

export function NetworkStats({
  rpcVerified,
  balance,
  connected,
  managedCount,
  discoveredCount,
  programReady,
}: {
  rpcVerified: boolean | null;
  balance: number | null;
  connected: boolean;
  managedCount: number;
  discoveredCount: number;
  programReady: boolean | null;
}) {
  const lowSol = connected && balance !== null && balance < 0.02;

  return (
    <section className="stats" aria-label="Environment summary">
      <div className="stat">
        <label>Network verification</label>
        <strong className="stat-md">
          {rpcVerified === null
            ? "Checking…"
            : rpcVerified
              ? CLUSTER === "devnet"
                ? "Devnet confirmed"
                : "Localnet confirmed"
              : "Not verified"}
        </strong>
        <small>
          {CLUSTER === "devnet"
            ? "RPC genesis hash matched"
            : "Local validator loopback RPC"}
        </small>
      </div>
      <div className="stat">
        <label>Wallet SOL</label>
        <strong className="tabular">
          {balance === null ? "—" : balance.toFixed(4)}
        </strong>
        <small className={lowSol ? "stat-warn" : undefined}>
          {!connected
            ? "Connect a wallet"
            : lowSol
              ? "Low balance · creator lifecycle needs ~0.014 SOL"
              : "Confirmed wallet balance"}
        </small>
      </div>
      <div className="stat">
        <label>Startup tokens</label>
        <strong className="tabular">
          {connected ? managedCount : discoveredCount}
        </strong>
        <small>
          {connected
            ? `${managedCount} managed · ${discoveredCount} total onchain`
            : "Discovered on configured cluster"}
        </small>
      </div>
      <div className="stat">
        <label>Program status</label>
        <strong className="stat-md">
          {programReady === null
            ? "Checking…"
            : programReady
              ? "Deployed"
              : "Unavailable"}
        </strong>
        <small className="inline-meta">
          <a
            className="mono"
            href={EXPLORER(PROGRAM_ID.toBase58())}
            target="_blank"
            rel="noreferrer"
          >
            {shorten(PROGRAM_ID.toBase58(), 8, 6)} ↗
          </a>
          <CopyButton value={PROGRAM_ID.toBase58()} label="Copy program ID" />
        </small>
      </div>
    </section>
  );
}
