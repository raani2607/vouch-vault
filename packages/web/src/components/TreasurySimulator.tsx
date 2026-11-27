"use client";

import { useMemo, useState } from "react";
import {
  calculateTreasuryFeeSplit,
  formatUnits,
  sanitizeDecimalInput,
  toBaseUnits,
} from "@/lib/config";

const QUOTE_DECIMALS = 6;
const PRESET_NOTIONALS = ["1000", "10000", "250000"] as const;

export function TreasurySimulator() {
  const [grossInput, setGrossInput] = useState("1000.000000");

  const { split, error } = useMemo(() => {
    const cleaned = sanitizeDecimalInput(grossInput);
    if (!cleaned) {
      return { split: null, error: "Enter a non-negative USDC amount." };
    }
    try {
      const baseUnits = toBaseUnits(cleaned, QUOTE_DECIMALS);
      return { split: calculateTreasuryFeeSplit(baseUnits), error: "" };
    } catch (err) {
      return {
        split: null,
        error:
          err instanceof Error ? err.message : "Invalid gross notional amount.",
      };
    }
  }, [grossInput]);

  return (
    <div className="grid2">
      <section className="card">
        <div className="cardhead">
          <div>
            <h2>Fee &amp; Growth Treasury Simulator</h2>
            <p className="hint">
              Deterministic checked integer basis-point math (50 bps total = 30
              bps LP + 20 bps protocol, split 50% Growth Treasury / 30% Protocol
              Reserve / 20% Risk &amp; Ops).
            </p>
          </div>
          <span className="status ok">Checked bigint</span>
        </div>

        <div className="fields">
          <div className="field full">
            <label htmlFor="sim-gross-notional">
              Gross quote notional (USDC · 6 decimals)
            </label>
            <input
              id="sim-gross-notional"
              inputMode="decimal"
              value={grossInput}
              onChange={(e) =>
                setGrossInput(sanitizeDecimalInput(e.target.value))
              }
              placeholder="e.g. 1000.000000"
              aria-invalid={Boolean(error)}
            />
            {error ? (
              <small className="inline-error">{error}</small>
            ) : (
              <small>
                Exact input in base units:{" "}
                <span className="mono tabular">
                  {split ? split.grossNotional.toLocaleString() : "0"}
                </span>{" "}
                (1 USDC = 1,000,000 base units)
              </small>
            )}
          </div>

          <div className="field full">
            <label>Reference presets</label>
            <div className="preset-row">
              {PRESET_NOTIONALS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="preset-btn"
                  onClick={() => setGrossInput(`${preset}.000000`)}
                >
                  {Number(preset).toLocaleString()}.000000 USDC
                </button>
              ))}
            </div>
          </div>
        </div>

        {split && (
          <>
            <div className="review">
              <span>Gross notional (Q)</span>
              <b className="tabular">
                {formatUnits(split.grossNotional, QUOTE_DECIMALS)} USDC (
                {split.grossNotional.toLocaleString()} units)
              </b>
              <span>Effective net notional (Q - F)</span>
              <b className="tabular">
                {formatUnits(split.effectiveNetNotional, QUOTE_DECIMALS)} USDC (
                {split.effectiveNetNotional.toLocaleString()} units)
              </b>
              <span>Total fee (F · 50 bps)</span>
              <b className="tabular">
                {formatUnits(split.totalFee, QUOTE_DECIMALS)} USDC (
                {split.totalFee.toLocaleString()} units)
              </b>
              <span>LP fee retained (L · 30 bps)</span>
              <b className="tabular">
                {formatUnits(split.lpFee, QUOTE_DECIMALS)} USDC (
                {split.lpFee.toLocaleString()} units)
              </b>
              <span>Protocol share (P · 20 bps)</span>
              <b className="tabular">
                {formatUnits(split.protocolFee, QUOTE_DECIMALS)} USDC (
                {split.protocolFee.toLocaleString()} units)
              </b>
            </div>

            <div className="notice" style={{ marginBottom: 0 }}>
              <strong>EXACT REMAINDER CONSERVATION VERIFIED</strong>
              <span>
                L + P ={" "}
                <span className="mono">
                  {(split.lpFee + split.protocolFee).toLocaleString()}
                </span>{" "}
                = F · Growth + Reserve + Risk ={" "}
                <span className="mono">
                  {(
                    split.growthTreasury +
                    split.protocolReserve +
                    split.riskOpsBuffer
                  ).toLocaleString()}
                </span>{" "}
                = P
              </span>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="cardhead">
          <div>
            <h2>Protocol Share Partition (50 / 30 / 20)</h2>
            <p className="hint">
              Conservative floor division with remainder assigned to the Risk
              &amp; Ops buffer so zero base units leak.
            </p>
          </div>
          <span className="role-pill owner">Parity spec</span>
        </div>

        {split ? (
          <>
            <div className="alloc-viz" aria-label="Protocol share breakdown">
              <div className="alloc-stacked-bar">
                <span className="alloc-segment alloc-market" style={{ width: "50%" }} />
                <span className="alloc-segment alloc-startup" style={{ width: "30%" }} />
                <span className="alloc-segment alloc-community" style={{ width: "20%" }} />
              </div>
              <div className="alloc-legend">
                <span className="alloc-legend-item">
                  <i className="alloc-swatch alloc-market" />
                  Growth Treasury <b>50%</b>
                </span>
                <span className="alloc-legend-item">
                  <i className="alloc-swatch alloc-startup" />
                  Protocol Reserve <b>30%</b>
                </span>
                <span className="alloc-legend-item">
                  <i className="alloc-swatch alloc-community" />
                  Risk &amp; Ops <b>20%</b>
                </span>
              </div>
            </div>

            <div className="vaults" style={{ gridTemplateColumns: "1fr" }}>
              <div className="vault">
                <div className="vault-top">
                  <label>
                    <i className="alloc-swatch alloc-market" /> Builder Growth
                    Treasury (50%)
                  </label>
                  <span className="vault-pct tabular">floor(P * 50 / 100)</span>
                </div>
                <strong className="tabular">
                  {formatUnits(split.growthTreasury, QUOTE_DECIMALS)} USDC
                </strong>
                <small className="mono">
                  {split.growthTreasury.toLocaleString()} base units
                </small>
              </div>

              <div className="vault">
                <div className="vault-top">
                  <label>
                    <i className="alloc-swatch alloc-startup" /> Protocol
                    Sustainability Reserve (30%)
                  </label>
                  <span className="vault-pct tabular">floor(P * 30 / 100)</span>
                </div>
                <strong className="tabular">
                  {formatUnits(split.protocolReserve, QUOTE_DECIMALS)} USDC
                </strong>
                <small className="mono">
                  {split.protocolReserve.toLocaleString()} base units
                </small>
              </div>

              <div className="vault">
                <div className="vault-top">
                  <label>
                    <i className="alloc-swatch alloc-community" /> Risk &amp;
                    Operations Buffer (20% remainder)
                  </label>
                  <span className="vault-pct tabular">P - Growth - Reserve</span>
                </div>
                <strong className="tabular">
                  {formatUnits(split.riskOpsBuffer, QUOTE_DECIMALS)} USDC
                </strong>
                <small className="mono">
                  {split.riskOpsBuffer.toLocaleString()} base units
                </small>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">
            Enter a valid USDC notional amount to preview exact integer fee
            splits.
          </div>
        )}
      </section>
    </div>
  );
}
