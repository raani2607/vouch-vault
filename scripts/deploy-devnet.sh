#!/usr/bin/env bash
set -euo pipefail

if [[ "${ATTENZA_DEPLOY_AUTHORIZED:-}" != "YES" ]]; then
  echo "Blocked: Product Owner must explicitly authorize this Devnet deployment immediately before running it." >&2
  exit 2
fi
if [[ -z "${ANCHOR_WALLET:-}" || -z "${ATTENZA_PROGRAM_KEYPAIR:-}" ]]; then
  echo "Set ANCHOR_WALLET and ATTENZA_PROGRAM_KEYPAIR to filesystem paths; never put key material in environment values." >&2
  exit 2
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rpc="https://api.devnet.solana.com"
program_id="46UFiREvpUgYEB4hgDzBR6n29Mh1BKBR9yp7VoEAapCo"

node "$root/scripts/devnet-preflight.mjs"
echo "Deploying only to Solana Devnet at $rpc"
echo "Program ID: $program_id"
solana program deploy "$root/target/deploy/attenza_token.so" \
  --url "$rpc" \
  --keypair "$ANCHOR_WALLET" \
  --program-id "$ATTENZA_PROGRAM_KEYPAIR" \
  --upgrade-authority "$ANCHOR_WALLET" \
  --commitment confirmed

solana program show "$program_id" \
  --url "$rpc" \
  --keypair "$ANCHOR_WALLET" \
  --commitment confirmed
