"use client";

import { EXPLORER } from "@/lib/config";
import { shorten } from "@/lib/format";
import {
  transactionPhaseLabel,
  type TransactionPhase,
} from "@/lib/transaction";
import { CopyButton } from "./CopyButton";

export function StatusBanner({
  error,
  notice,
  signatures,
  phase,
  busy,
  onDismissError,
  onDismissNotice,
}: {
  error: string;
  notice: string;
  signatures: string[];
  phase: TransactionPhase;
  busy: boolean;
  onDismissError: () => void;
  onDismissNotice: () => void;
}) {
  return (
    <div aria-live="polite" className="banner-stack">
      {error && (
        <div className="error" role="alert">
          <div className="banner-head">
            <div>
              <strong>Action needs attention</strong>
              <p className="banner-copy">{error}</p>
            </div>
            <button
              type="button"
              className="dismiss-btn"
              onClick={onDismissError}
              aria-label="Dismiss error message"
            >
              ✕
            </button>
          </div>
          {signatures.length > 0 && (
            <div className="siglist">
              {signatures.map((sig) => (
                <div className="sig" key={sig}>
                  <span>Inspect original transaction</span>
                  <div className="inline">
                    <CopyButton value={sig} label="Copy signature" />
                    <a
                      href={EXPLORER(sig, "tx")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shorten(sig, 12, 10)} ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {notice && (
        <div className="progressbox" role="status">
          <div className="banner-head">
            <div>
              <b>{notice}</b>
              {!busy && phase !== "idle" && (
                <span className="phase-pill">
                  {transactionPhaseLabel(phase)}
                </span>
              )}
            </div>
            <button
              type="button"
              className="dismiss-btn"
              onClick={onDismissNotice}
              aria-label="Dismiss status notice"
            >
              ✕
            </button>
          </div>
          {signatures.length > 0 && (
            <div className="siglist">
              {signatures.map((sig, i) => (
                <div className="sig" key={sig}>
                  <span>Transaction {i + 1}</span>
                  <div className="inline">
                    <CopyButton value={sig} label="Copy signature" />
                    <a
                      href={EXPLORER(sig, "tx")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shorten(sig, 12, 10)} ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
