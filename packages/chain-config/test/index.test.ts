import { describe, expect, it } from "vitest";

import {
  calculateTreasuryFeeSplit,
  ConfigError,
  explorerUrl,
  parseChainConfig,
} from "../src/index.js";

const VALID_MINT = "So11111111111111111111111111111111111111112";

describe("parseChainConfig", () => {
  it("defaults to localnet and allows an omitted quote mint", () => {
    expect(parseChainConfig({})).toEqual({
      cluster: "localnet",
      rpcUrl: new URL("http://127.0.0.1:8899"),
      quoteMint: undefined,
    });
  });

  it("accepts a real 32-byte public key", () => {
    expect(
      parseChainConfig({ VOUCHVAULT_QUOTE_MINT: VALID_MINT }).quoteMint,
    ).toBe(VALID_MINT);
  });

  it("accepts the canonical Devnet endpoint", () => {
    expect(
      parseChainConfig({
        VOUCHVAULT_CLUSTER: "devnet",
        VOUCHVAULT_QUOTE_MINT: VALID_MINT,
      }).rpcUrl.href,
    ).toBe("https://api.devnet.solana.com/");
  });

  it.each(["mainnet-beta", "testnet", ""])(
    "rejects unsupported cluster %s",
    (cluster) => {
      expect(() => parseChainConfig({ VOUCHVAULT_CLUSTER: cluster })).toThrow(
        ConfigError,
      );
    },
  );

  it.each([
    "https://api.mainnet-beta.solana.com",
    "https://api.devnet.solana.com:8899",
    "https://api.devnet.solana.com:443",
    "https://api.devnet.solana.com/rpc",
    "https://api.devnet.solana.com/?commitment=finalized",
    "https://api.devnet.solana.com/#fragment",
    "https://user@api.devnet.solana.com",
    "http://api.devnet.solana.com",
    "https://devnet.solana.com",
    "https://api.devnet.solana.com.evil.example",
  ])("rejects noncanonical remote endpoint %s", (url) => {
    expect(() =>
      parseChainConfig({
        VOUCHVAULT_CLUSTER: "devnet",
        VOUCHVAULT_RPC_URL: url,
      }),
    ).toThrow(ConfigError);
  });

  it.each([
    "SOLANA_RPC_URL",
    "RPC_URL",
    "ANCHOR_PROVIDER_URL",
    "SOLANA_CLUSTER",
  ])("rejects bypass alias %s", (alias) => {
    expect(() =>
      parseChainConfig({ [alias]: "https://api.mainnet-beta.solana.com" }),
    ).toThrow("unsupported");
  });

  it("retains local loopback endpoint support with an explicit local port", () => {
    expect(
      parseChainConfig({ VOUCHVAULT_RPC_URL: "http://localhost:9900" }).rpcUrl
        .port,
    ).toBe("9900");
  });

  it.each([
    "https://127.0.0.1:8899",
    "http://localhost/path",
    "http://127.0.0.1/?x=1",
    "http://127.0.0.1/#fragment",
    "http://evil.localhost:8899",
    "file:///tmp/rpc",
  ])("rejects unsafe local endpoint %s", (url) => {
    expect(() => parseChainConfig({ VOUCHVAULT_RPC_URL: url })).toThrow(
      ConfigError,
    );
  });

  it.each(["0OIl", "too-short", "1".repeat(44)])(
    "rejects invalid public keys %s",
    (quoteMint) => {
      expect(() =>
        parseChainConfig({ VOUCHVAULT_QUOTE_MINT: quoteMint }),
      ).toThrow("32-byte Solana public key");
    },
  );

  it("does not claim that syntactic validation verifies a real mint account", () => {
    expect(
      parseChainConfig({ VOUCHVAULT_QUOTE_MINT: VALID_MINT }).quoteMint,
    ).toBe(VALID_MINT);
  });

  it("generates cluster-aware Solana Explorer URLs for devnet and localnet", () => {
    expect(explorerUrl("abc", "devnet", "tx")).toBe(
      "https://explorer.solana.com/tx/abc?cluster=devnet",
    );
    expect(explorerUrl("abc", "localnet", "address")).toBe(
      "https://explorer.solana.com/address/abc?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899",
    );
  });
});

describe("calculateTreasuryFeeSplit", () => {
  it("matches the 1,000.000000 USDC (1,000,000,000 base units) reference vector", () => {
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

  it("conserves remainders exactly across odd and boundary base-unit inputs", () => {
    for (const q of [
      0n,
      1n,
      199n,
      200n,
      500n,
      999n,
      12_345_678n,
      18_446_744_073_709_551_615n,
    ]) {
      const split = calculateTreasuryFeeSplit(q);
      expect(split.effectiveNetNotional + split.totalFee).toBe(
        split.grossNotional,
      );
      expect(split.lpFee + split.protocolFee).toBe(split.totalFee);
      expect(
        split.growthTreasury + split.protocolReserve + split.riskOpsBuffer,
      ).toBe(split.protocolFee);
    }
  });

  it("rejects negative gross notional inputs", () => {
    expect(() => calculateTreasuryFeeSplit(-1n)).toThrow(ConfigError);
  });
});
