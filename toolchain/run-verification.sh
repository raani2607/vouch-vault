#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="localhost/attenza-solana-dev:anchor-1.2.2-solana-4.1.2-tools-v1.57"
runtime=""
if command -v podman >/dev/null 2>&1; then
  runtime=podman
elif command -v docker >/dev/null 2>&1; then
  runtime=docker
else
  echo "Install Podman or Docker to run the isolated ATTENZA toolchain." >&2
  exit 1
fi

"$runtime" build -f "$root/toolchain/Containerfile" -t "$image" "$root"
"$runtime" run --rm --security-opt=seccomp=unconfined -v "$root:/workspace" -w /workspace "$image" bash -lc '
  set -euo pipefail
  node --version
  pnpm --version
  rustc --version
  cargo --version
  anchor --version
  solana --version
  solana-test-validator --version
  avm platform-tools resolve
  pnpm verify:env
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm format:check
  cargo fmt --all -- --check
  cargo clippy --workspace --all-targets --locked
  anchor build --tools-version v1.57
  pnpm idl:check
  pnpm typecheck:tests
  pnpm test:validator
'
