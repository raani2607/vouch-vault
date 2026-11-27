import type { PublicKey } from "@solana/web3.js";

export function requireConnectedWallet(
  key: PublicKey | null | undefined,
): PublicKey {
  if (!key) throw new Error("Connect a Solana wallet before continuing.");
  return key;
}

export function requireBeneficiaryWallet(
  actual: PublicKey | null | undefined,
  beneficiary: PublicKey,
): PublicKey {
  const key = requireConnectedWallet(actual);
  if (!key.equals(beneficiary))
    throw new Error("Only the recorded beneficiary can submit this M2 claim.");
  return key;
}
