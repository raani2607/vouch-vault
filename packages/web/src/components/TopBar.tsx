"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { CLUSTER } from "@/lib/config";
import { shorten } from "@/lib/format";
import { CopyButton } from "./CopyButton";

export function TopBar({
  connected,
  walletAddress,
}: {
  connected: boolean;
  walletAddress: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brandmark" aria-hidden="true">
          A
        </div>
        <div>
          ATTENZA<small>STARTUP ATTENTION MARKETPLACE</small>
        </div>
      </div>
      <div className="topright">
        <span
          className={`network ${CLUSTER === "devnet" ? "devnet" : "localnet"}`}
        >
          {CLUSTER === "devnet" ? "Solana Devnet" : "Localnet mode"}
        </span>
        {connected && walletAddress && (
          <span className="balance-pill">
            <span className="mono">{shorten(walletAddress)}</span>
            <CopyButton value={walletAddress} label="Copy connected wallet" />
          </span>
        )}
        {mounted ? (
          <WalletMultiButton className="wallet" />
        ) : (
          <button type="button" className="wallet" disabled>
            Select Wallet
          </button>
        )}
      </div>
    </header>
  );
}
