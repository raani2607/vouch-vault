"use client";

import {
  AnchorProvider,
  Program,
  BN,
  type IdlAccounts,
  type Wallet,
} from "@anchor-lang/core";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
  getAccount,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  type Mint,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import idl from "../generated/vouchvault_token.json";
import type { VouchvaultToken } from "../generated/vouchvault_token";
import {
  PROGRAM_ID,
  RPC_URL,
  serializeU64,
  startupIdBytes,
  verifyConfiguredCluster,
} from "./config";
import type { LifecycleStage } from "./lifecycle";
import type { TransactionPhase } from "./transaction";
import type {
  StartupOperation,
  StartupTransactionRecord,
} from "./startup-history";

// Byte offsets verified against StartupConfig & VestingSchedule Anchor account layouts (8-byte discriminator + fields)
export const STARTUP_AUTHORITY_OFFSET = 40;
export const STARTUP_MINT_OFFSET = 72;
export const VESTING_STARTUP_OFFSET = 8;
export const VESTING_BENEFICIARY_OFFSET = 104;

export type StartupConfigAccount = IdlAccounts<VouchvaultToken>["startupConfig"];
export type AllocationLedgerAccount =
  IdlAccounts<VouchvaultToken>["allocationLedger"];
export type VestingScheduleAccount =
  IdlAccounts<VouchvaultToken>["vestingSchedule"];

export type StartupData = {
  address: PublicKey;
  config: StartupConfigAccount;
  ledger: AllocationLedgerAccount;
  mintState: Mint;
  vaults: string[];
  balances: bigint[];
  vaultAuthority: PublicKey;
};

export type ScheduleData = {
  address: PublicKey;
  data: VestingScheduleAccount;
  decimals: number;
  beneficiaryAta?: {
    address: PublicKey;
    exists: boolean;
    balance: bigint;
  };
};

export type DecodedActivityEvent = {
  name: string;
  data: Record<string, unknown>;
};

export type RpcActivityEntry = {
  signature: string;
  slot: number;
  err: unknown;
  timestamp: number | null;
  events: DecodedActivityEvent[];
};

export const connection = new Connection(RPC_URL, { commitment: "confirmed" });

const READONLY_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction>(transaction: T): Promise<T> =>
    transaction,
  signAllTransactions: async <T extends Transaction>(
    transactions: T[],
  ): Promise<T[]> => transactions,
} as unknown as Wallet;

export const program = (wallet: Wallet) =>
  new Program<VouchvaultToken>(
    idl as VouchvaultToken,
    new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }),
  );

export const readProgram = () => program(READONLY_WALLET);

const seed = (value: string) => Buffer.from(value);
const pda = (...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export function deriveStartup(authority: PublicKey, startupId: Uint8Array) {
  const id = Buffer.from(startupId);
  const startup = pda(seed("startup"), authority.toBuffer(), id);
  return {
    startup,
    ledger: pda(seed("allocation"), authority.toBuffer(), id),
    mintAuthority: pda(seed("mint-authority"), authority.toBuffer(), id),
    mint: pda(seed("mint"), authority.toBuffer(), id),
    vaults: [0, 1, 2, 3].map((index) =>
      pda(seed("vault"), startup.toBuffer(), Buffer.from([index])),
    ),
  };
}

export function deriveSchedule(startup: PublicKey, scheduleId: Uint8Array) {
  const id = Buffer.from(scheduleId);
  return {
    schedule: pda(seed("vesting"), startup.toBuffer(), id),
    escrow: pda(seed("vesting-escrow"), startup.toBuffer(), id),
  };
}

export function lifecycleStateName(
  state: StartupConfigAccount["state"] | string,
): Exclude<LifecycleStage, "uninitialized"> {
  if (typeof state === "string") {
    const lower = state.toLowerCase();
    if (lower === "funded") return "funded";
    if (lower === "finalized") return "finalized";
    return "created";
  }
  const key = (Object.keys(state ?? {})[0] ?? "created").toLowerCase();
  if (key === "funded") return "funded";
  if (key === "finalized") return "finalized";
  return "created";
}

async function ready() {
  await verifyConfiguredCluster(connection);
}

export class SubmittedTransactionError extends Error {
  constructor(
    readonly signature: string,
    cause: unknown,
  ) {
    super(
      `Transaction ${signature} was submitted, but confirmation failed: ${cause instanceof Error ? cause.message : "unknown error"}`,
    );
    this.name = "SubmittedTransactionError";
  }
}

export class TransactionConfirmationTimeoutError extends SubmittedTransactionError {
  constructor(
    signature: string,
    cause: unknown,
    readonly confirmed = true,
  ) {
    super(signature, cause);
    this.message = confirmed
      ? `Transaction ${signature} was confirmed, but finalization timed out. Inspect this original signature before retrying.`
      : `Transaction ${signature} was submitted, but confirmation timed out. Inspect this original signature before retrying.`;
    this.name = "TransactionConfirmationTimeoutError";
  }
}

export async function confirmSubmittedTransaction(
  rpc: Pick<Connection, "confirmTransaction">,
  signature: string,
  blockhash: { blockhash: string; lastValidBlockHeight: number },
  onPhase?: (phase: TransactionPhase) => void,
) {
  onPhase?.("confirming");
  let status: Awaited<ReturnType<Connection["confirmTransaction"]>>;
  try {
    status = await rpc.confirmTransaction(
      { signature, ...blockhash },
      "confirmed",
    );
  } catch (error) {
    onPhase?.("timed-out");
    throw new TransactionConfirmationTimeoutError(signature, error, false);
  }
  if (status.value.err)
    throw new SubmittedTransactionError(
      signature,
      new Error(JSON.stringify(status.value.err)),
    );
  onPhase?.("confirmed");
  try {
    const finalized = await rpc.confirmTransaction(
      { signature, ...blockhash },
      "finalized",
    );
    if (finalized.value.err)
      throw new SubmittedTransactionError(
        signature,
        new Error(JSON.stringify(finalized.value.err)),
      );
    onPhase?.("finalized");
  } catch (error) {
    if (error instanceof SubmittedTransactionError) throw error;
    onPhase?.("timed-out");
    throw new TransactionConfirmationTimeoutError(signature, error);
  }
  return signature;
}

type TxTracking = {
  operation: StartupOperation;
  startupAddress: string;
  startupIdentity: string;
  resultingAccount: string;
  onRecord?: (record: StartupTransactionRecord) => void;
};

async function tx(
  wallet: Wallet,
  build: () => Promise<Transaction>,
  onPhase?: (phase: TransactionPhase) => void,
  onSignature?: (signature: string) => void,
  tracking?: TxTracking,
) {
  let signature: string | undefined;
  let submittedAt = Date.now();
  const record = (status: StartupTransactionRecord["status"]) => {
    if (signature && tracking)
      tracking.onRecord?.({
        signature,
        startupAddress: tracking.startupAddress,
        startupIdentity: tracking.startupIdentity,
        operation: tracking.operation,
        timestamp: submittedAt,
        resultingAccount: tracking.resultingAccount,
        status,
      });
  };
  const phase = (next: TransactionPhase) => {
    onPhase?.(next);
    if (next === "confirmed") record("confirmed");
    if (next === "finalized") record("finalized");
  };
  try {
    onPhase?.("preparing");
    const transaction = await build();
    const latest = await connection.getLatestBlockhash("confirmed");
    transaction.feePayer = wallet.publicKey;
    transaction.recentBlockhash = latest.blockhash;
    onPhase?.("awaiting-wallet");
    const signed = await wallet.signTransaction(transaction);
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    submittedAt = Date.now();
    onSignature?.(signature);
    record("submitted");
    onPhase?.("submitted");
    const confirmedSignature = await confirmSubmittedTransaction(
      connection,
      signature,
      latest,
      phase,
    );
    record("finalized");
    return confirmedSignature;
  } catch (error) {
    onPhase?.(
      error instanceof TransactionConfirmationTimeoutError
        ? "timed-out"
        : "failed",
    );
    if (error instanceof TransactionConfirmationTimeoutError)
      record(error.confirmed ? "confirmed" : "submitted");
    else if (signature) record("failed");
    if (error instanceof SubmittedTransactionError) throw error;
    if (signature) throw new SubmittedTransactionError(signature, error);
    throw error;
  }
}

async function hydrateStartup(
  client: Program<VouchvaultToken>,
  address: PublicKey,
  config: StartupConfigAccount,
): Promise<StartupData> {
  const derived = deriveStartup(
    config.authority,
    Uint8Array.from(config.startupId),
  );
  const ledger = await client.account.allocationLedger.fetch(derived.ledger);
  const mintState = await getMint(connection, config.mint);
  const vaults = ledger.vaults.map((key) => key.toBase58());
  const balances = await Promise.all(
    ledger.vaults.map(async (vaultAddress) => {
      if (vaultAddress.equals(PublicKey.default)) return 0n;
      try {
        const info = await getAccount(connection, vaultAddress);
        return info.amount;
      } catch {
        return 0n;
      }
    }),
  );
  return {
    address,
    config,
    ledger,
    mintState,
    vaults,
    balances,
    vaultAuthority: derived.mintAuthority,
  };
}

export async function listStartups(wallet?: Wallet): Promise<StartupData[]> {
  const client = wallet ? program(wallet) : readProgram();
  const configs = wallet
    ? await client.account.startupConfig.all([
        {
          memcmp: {
            offset: STARTUP_AUTHORITY_OFFSET,
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ])
    : await client.account.startupConfig.all();
  return Promise.all(
    configs.map((item) => hydrateStartup(client, item.publicKey, item.account)),
  );
}

export async function listPublicStartups(): Promise<StartupData[]> {
  const client = readProgram();
  const configs = await client.account.startupConfig.all();
  return Promise.all(
    configs.map((item) => hydrateStartup(client, item.publicKey, item.account)),
  );
}

export async function fetchStartupByAddressOrMint(
  addressInput: string,
): Promise<StartupData | null> {
  const trimmed = addressInput.trim();
  if (!trimmed) return null;
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(trimmed);
  } catch {
    throw new Error("Enter a valid Solana Startup PDA or Mint address.");
  }
  const client = readProgram();
  try {
    const direct = await client.account.startupConfig.fetch(pubkey);
    return hydrateStartup(client, pubkey, direct);
  } catch {
    const byMint = await client.account.startupConfig.all([
      { memcmp: { offset: STARTUP_MINT_OFFSET, bytes: pubkey.toBase58() } },
    ]);
    const match = byMint[0];
    if (!match) return null;
    return hydrateStartup(client, match.publicKey, match.account);
  }
}

export async function getBeneficiaryTokenStatus(
  mint: PublicKey,
  owner: PublicKey,
): Promise<{ address: PublicKey; exists: boolean; balance: bigint }> {
  const address = await getAssociatedTokenAddress(mint, owner);
  try {
    const account = await getAccount(connection, address, "confirmed");
    return { address, exists: true, balance: account.amount };
  } catch {
    return { address, exists: false, balance: 0n };
  }
}

export async function listRelevantSchedules(params: {
  startupAddress?: PublicKey;
  beneficiary?: PublicKey;
}): Promise<ScheduleData[]> {
  const client = readProgram();
  const queries: Promise<
    { publicKey: PublicKey; account: VestingScheduleAccount }[]
  >[] = [];
  if (params.startupAddress) {
    queries.push(
      client.account.vestingSchedule.all([
        {
          memcmp: {
            offset: VESTING_STARTUP_OFFSET,
            bytes: params.startupAddress.toBase58(),
          },
        },
      ]),
    );
  }
  if (params.beneficiary) {
    queries.push(
      client.account.vestingSchedule.all([
        {
          memcmp: {
            offset: VESTING_BENEFICIARY_OFFSET,
            bytes: params.beneficiary.toBase58(),
          },
        },
      ]),
    );
  }
  if (!queries.length) return [];

  const groups = await Promise.all(queries);
  const deduped = new Map<
    string,
    { publicKey: PublicKey; account: VestingScheduleAccount }
  >();
  for (const list of groups) {
    for (const row of list) {
      deduped.set(row.publicKey.toBase58(), row);
    }
  }

  const mintCache = new Map<string, Promise<Mint>>();
  const getCachedMint = (mint: PublicKey) => {
    const key = mint.toBase58();
    let promise = mintCache.get(key);
    if (!promise) {
      promise = getMint(connection, mint);
      mintCache.set(key, promise);
    }
    return promise;
  };

  const ataCache = new Map<
    string,
    Promise<{ address: PublicKey; exists: boolean; balance: bigint }>
  >();
  const getCachedAta = (mint: PublicKey, owner: PublicKey) => {
    const key = `${mint.toBase58()}:${owner.toBase58()}`;
    let promise = ataCache.get(key);
    if (!promise) {
      promise = getBeneficiaryTokenStatus(mint, owner);
      ataCache.set(key, promise);
    }
    return promise;
  };

  return Promise.all(
    [...deduped.values()].map(async (row) => {
      const mintInfo = await getCachedMint(row.account.mint);
      const isConnectedBeneficiary =
        params.beneficiary &&
        row.account.beneficiary.equals(params.beneficiary);
      const beneficiaryAta = isConnectedBeneficiary
        ? await getCachedAta(row.account.mint, params.beneficiary!)
        : undefined;
      return {
        address: row.publicKey,
        data: row.account,
        decimals: mintInfo.decimals,
        ...(beneficiaryAta ? { beneficiaryAta } : {}),
      };
    }),
  );
}

export type CreationInput = {
  startupName: string;
  startupId: string;
  total: bigint;
  decimals: number;
  market: bigint;
  startup: bigint;
  community: bigint;
  locked: bigint;
};

async function runMissingLifecycleSteps(
  wallet: Wallet,
  client: Program<VouchvaultToken>,
  id: Uint8Array,
  addresses: ReturnType<typeof deriveStartup>,
  expected: {
    total: bigint;
    market: bigint;
    startup: bigint;
    community: bigint;
    locked: bigint;
  },
  initialConfig: StartupConfigAccount,
  initialLedger: AllocationLedgerAccount,
  onStep: (name: string) => void,
  onPhase?: (phase: TransactionPhase) => void,
  onSignature?: (signature: string) => void,
  onRecord?: (record: StartupTransactionRecord) => void,
): Promise<string[]> {
  const sigs: string[] = [];
  let config = initialConfig;
  const ledger = initialLedger;
  const identity = Array.from(id, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const tracking = (
    operation: StartupOperation,
    resultingAccount: PublicKey,
  ): TxTracking => ({
    operation,
    startupAddress: addresses.startup.toBase58(),
    startupIdentity: identity,
    resultingAccount: resultingAccount.toBase58(),
    onRecord,
  });

  const bucketNames = [
    "marketInventory",
    "startupReserve",
    "communityReserve",
    "lockedReserve",
  ] as const;

  if (lifecycleStateName(config.state) === "created") {
    for (const [index, bucket] of bucketNames.entries()) {
      if ((Number(ledger.vaultMask) & (1 << index)) !== 0) continue;
      onStep(`Create ${bucket} vault`);
      sigs.push(
        await tx(
          wallet,
          () =>
            client.methods
              .createAllocationVault({ [bucket]: {} } as Record<
                typeof bucket,
                Record<string, never>
              >)
              .accountsStrict({
                startupAuthority: wallet.publicKey,
                startupConfig: addresses.startup,
                allocationLedger: addresses.ledger,
                vaultAuthority: addresses.mintAuthority,
                mint: addresses.mint,
                vault: addresses.vaults[index]!,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
              })
              .transaction(),
          onPhase,
          onSignature,
          tracking(
            (
              [
                "market-vault-creation",
                "startup-vault-creation",
                "community-vault-creation",
                "locked-vault-creation",
              ] as const
            )[index]!,
            addresses.vaults[index]!,
          ),
        ),
      );
    }

    onStep("Fund four allocation vaults");
    sigs.push(
      await tx(
        wallet,
        () =>
          client.methods
            .fundAllocations()
            .accountsStrict({
              startupAuthority: wallet.publicKey,
              startupConfig: addresses.startup,
              allocationLedger: addresses.ledger,
              mintAuthority: addresses.mintAuthority,
              mint: addresses.mint,
              marketVault: addresses.vaults[0]!,
              startupReserveVault: addresses.vaults[1]!,
              communityReserveVault: addresses.vaults[2]!,
              lockedReserveVault: addresses.vaults[3]!,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .transaction(),
        onPhase,
        onSignature,
        tracking("allocation-funding", addresses.ledger),
      ),
    );
    config = await client.account.startupConfig.fetch(addresses.startup);
  }

  if (lifecycleStateName(config.state) === "funded") {
    onStep("Finalize supply and revoke mint authority");
    sigs.push(
      await tx(
        wallet,
        () =>
          client.methods
            .finalizeStartup()
            .accountsStrict({
              startupAuthority: wallet.publicKey,
              startupConfig: addresses.startup,
              allocationLedger: addresses.ledger,
              mintAuthority: addresses.mintAuthority,
              mint: addresses.mint,
              marketVault: addresses.vaults[0]!,
              startupReserveVault: addresses.vaults[1]!,
              communityReserveVault: addresses.vaults[2]!,
              lockedReserveVault: addresses.vaults[3]!,
              tokenProgram: TOKEN_PROGRAM_ID,
              clock: SYSVAR_CLOCK_PUBKEY,
            })
            .transaction(),
        onPhase,
        onSignature,
        tracking("startup-finalization", addresses.startup),
      ),
    );
  }

  onStep("Verify confirmed mint and vault accounts");
  const mint = await getMint(connection, addresses.mint);
  if (
    mint.supply !== expected.total ||
    mint.mintAuthority !== null ||
    mint.freezeAuthority !== null
  ) {
    throw new Error(
      "On-chain mint verification did not match the fixed-supply expectations.",
    );
  }
  const balances = await Promise.all(
    addresses.vaults.map(
      async (address) => (await getAccount(connection, address)).amount,
    ),
  );
  const expectedBalances = [
    expected.market,
    expected.startup,
    expected.community,
    expected.locked,
  ];
  if (balances.some((amount, index) => amount !== expectedBalances[index])) {
    throw new Error(
      "Confirmed vault balances do not match the allocation ledger.",
    );
  }
  return sigs;
}

export async function createStartup(
  wallet: Wallet,
  input: CreationInput,
  onStep: (name: string) => void,
  onPhase?: (phase: TransactionPhase) => void,
  onSignature?: (signature: string) => void,
  onRecord?: (record: StartupTransactionRecord) => void,
) {
  await ready();
  const id = startupIdBytes(input.startupId);
  const addresses = deriveStartup(wallet.publicKey, id);
  const identity = Array.from(id, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const client = program(wallet);
  const sigs: string[] = [];
  let config: StartupConfigAccount;
  let ledger: AllocationLedgerAccount;

  if (await connection.getAccountInfo(addresses.startup, "confirmed")) {
    config = await client.account.startupConfig.fetch(addresses.startup);
    ledger = await client.account.allocationLedger.fetch(addresses.ledger);
    const stored = [
      ledger.allocations.marketInventory,
      ledger.allocations.startupReserve,
      ledger.allocations.communityReserve,
      ledger.allocations.lockedReserve,
    ].map((amount: BN) => amount.toString());
    const submitted = [
      input.market,
      input.startup,
      input.community,
      input.locked,
    ].map(String);
    if (
      !config.authority.equals(wallet.publicKey) ||
      !config.mint.equals(addresses.mint) ||
      !Buffer.from(config.startupId).equals(Buffer.from(id)) ||
      ledger.totalSupply.toString() !== input.total.toString() ||
      ledger.decimals !== input.decimals ||
      stored.some(
        (amount: string, index: number) => amount !== submitted[index],
      )
    ) {
      throw new Error(
        "A startup already exists at this identity with different parameters. No transaction was sent.",
      );
    }
  } else {
    onStep("Initialize startup and mint account");
    sigs.push(
      await tx(
        wallet,
        () =>
          client.methods
            .initializeStartup(
              Array.from(id),
              serializeU64(input.total),
              input.decimals,
              {
                marketInventory: serializeU64(input.market),
                startupReserve: serializeU64(input.startup),
                communityReserve: serializeU64(input.community),
                lockedReserve: serializeU64(input.locked),
              },
            )
            .accountsStrict({
              startupAuthority: wallet.publicKey,
              startupConfig: addresses.startup,
              allocationLedger: addresses.ledger,
              mintAuthority: addresses.mintAuthority,
              mint: addresses.mint,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              rent: SYSVAR_RENT_PUBKEY,
            })
            .transaction(),
        onPhase,
        onSignature,
        {
          operation: "startup-creation",
          startupAddress: addresses.startup.toBase58(),
          startupIdentity: identity,
          resultingAccount: addresses.startup.toBase58(),
          onRecord,
        },
      ),
    );
    config = await client.account.startupConfig.fetch(addresses.startup);
    ledger = await client.account.allocationLedger.fetch(addresses.ledger);
  }

  const remainingSigs = await runMissingLifecycleSteps(
    wallet,
    client,
    id,
    addresses,
    {
      total: input.total,
      market: input.market,
      startup: input.startup,
      community: input.community,
      locked: input.locked,
    },
    config,
    ledger,
    onStep,
    onPhase,
    onSignature,
    onRecord,
  );

  return { addresses, signatures: [...sigs, ...remainingSigs] };
}

export async function resumeStartup(
  wallet: Wallet,
  existing: StartupData,
  onStep: (name: string) => void,
  onPhase?: (phase: TransactionPhase) => void,
  onSignature?: (signature: string) => void,
  onRecord?: (record: StartupTransactionRecord) => void,
) {
  await ready();
  if (!existing.config.authority.equals(wallet.publicKey)) {
    throw new Error(
      "Connect the startup authority wallet that initialized this startup to resume.",
    );
  }
  const client = program(wallet);
  const id = Uint8Array.from(existing.config.startupId);
  const addresses = deriveStartup(wallet.publicKey, id);
  const freshConfig = await client.account.startupConfig.fetch(
    addresses.startup,
  );
  const freshLedger = await client.account.allocationLedger.fetch(
    addresses.ledger,
  );
  const signatures = await runMissingLifecycleSteps(
    wallet,
    client,
    id,
    addresses,
    {
      total: BigInt(freshLedger.totalSupply.toString()),
      market: BigInt(freshLedger.allocations.marketInventory.toString()),
      startup: BigInt(freshLedger.allocations.startupReserve.toString()),
      community: BigInt(freshLedger.allocations.communityReserve.toString()),
      locked: BigInt(freshLedger.allocations.lockedReserve.toString()),
    },
    freshConfig,
    freshLedger,
    onStep,
    onPhase,
    onSignature,
    onRecord,
  );
  return { addresses, signatures };
}

export async function createSchedule(
  wallet: Wallet,
  startup: PublicKey,
  startupId: Uint8Array,
  input: {
    scheduleId: Uint8Array;
    beneficiary: PublicKey;
    amount: bigint;
    start: number;
    cliff: number;
    end: number;
  },
  onPhase?: (phase: TransactionPhase) => void,
  onSignature?: (signature: string) => void,
  onRecord?: (record: StartupTransactionRecord) => void,
) {
  await ready();
  const client = program(wallet);
  const addresses = deriveStartup(wallet.publicKey, startupId);
  const vest = deriveSchedule(startup, input.scheduleId);
  const identity = Array.from(startupId, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const sig = await tx(
    wallet,
    () =>
      client.methods
        .createVestingSchedule(
          Array.from(input.scheduleId),
          serializeU64(input.amount),
          new BN(input.start),
          new BN(input.cliff),
          new BN(input.end),
        )
        .accountsStrict({
          startupAuthority: wallet.publicKey,
          startupConfig: startup,
          allocationLedger: addresses.ledger,
          vaultAuthority: addresses.mintAuthority,
          mint: addresses.mint,
          lockedReserveVault: addresses.vaults[3]!,
          vestingSchedule: vest.schedule,
          beneficiary: input.beneficiary,
          escrow: vest.escrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .transaction(),
    onPhase,
    onSignature,
    {
      operation: "vesting-create",
      startupAddress: startup.toBase58(),
      startupIdentity: identity,
      resultingAccount: vest.schedule.toBase58(),
      onRecord,
    },
  );
  return { ...vest, signature: sig };
}

export async function activateSchedule(
  wallet: Wallet,
  startup: PublicKey,
  schedule: PublicKey,
  startupId?: Uint8Array,
  onPhase?: (phase: TransactionPhase) => void,
  onSignature?: (signature: string) => void,
  onRecord?: (record: StartupTransactionRecord) => void,
) {
  await ready();
  const identity = startupId
    ? Array.from(startupId, (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      )
    : "";
  return tx(
    wallet,
    () =>
      program(wallet)
        .methods.activateVestingSchedule()
        .accountsStrict({
          startupAuthority: wallet.publicKey,
          startupConfig: startup,
          vestingSchedule: schedule,
        })
        .transaction(),
    onPhase,
    onSignature,
    startupId
      ? {
          operation: "vesting-activate",
          startupAddress: startup.toBase58(),
          startupIdentity: identity,
          resultingAccount: schedule.toBase58(),
          onRecord,
        }
      : undefined,
  );
}

export async function claimSchedule(
  wallet: Wallet,
  schedule: PublicKey,
  mint: PublicKey,
  onPhase?: (phase: TransactionPhase) => void,
  onSignature?: (signature: string) => void,
  onRecord?: (record: StartupTransactionRecord) => void,
) {
  await ready();
  const client = program(wallet);
  const beneficiaryToken = await getAssociatedTokenAddress(
    mint,
    wallet.publicKey,
  );
  const scheduleData = await client.account.vestingSchedule.fetch(schedule);
  const ataExists = Boolean(
    await connection.getAccountInfo(beneficiaryToken, "confirmed"),
  );

  const identity = Array.from(scheduleData.startupId, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  const sig = await tx(
    wallet,
    async () => {
      const transaction = new Transaction();
      if (!ataExists) {
        transaction.add(
          createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            beneficiaryToken,
            wallet.publicKey,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }
      const claimIx = await client.methods
        .claimVested()
        .accountsStrict({
          beneficiary: wallet.publicKey,
          vestingSchedule: schedule,
          escrow: scheduleData.escrow,
          beneficiaryTokenAccount: beneficiaryToken,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
      transaction.add(claimIx);
      return transaction;
    },
    onPhase,
    onSignature,
    {
      operation: "vesting-claim",
      startupAddress: scheduleData.startup.toBase58(),
      startupIdentity: identity,
      resultingAccount: beneficiaryToken.toBase58(),
      onRecord,
    },
  );
  return { signature: sig, createdAtaInTx: !ataExists, beneficiaryToken };
}

export async function activityFor(
  address: PublicKey,
): Promise<RpcActivityEntry[]> {
  const sigs = await connection.getSignaturesForAddress(
    address,
    { limit: 10 },
    "confirmed",
  );
  if (!sigs.length) return [];

  const client = readProgram();
  const transactions = await connection.getTransactions(
    sigs.map((entry) => entry.signature),
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  );

  return sigs.map((entry, index) => {
    const transaction = transactions[index] ?? null;
    const events: DecodedActivityEvent[] = (
      transaction?.meta?.logMessages ?? []
    )
      .map((log) => client.coder.events.decode(log))
      .filter((event): event is NonNullable<typeof event> => event !== null)
      .map((event) => ({
        name: event.name,
        data: event.data as Record<string, unknown>,
      }));
    return {
      signature: entry.signature,
      slot: entry.slot,
      err: entry.err,
      timestamp: transaction?.blockTime ?? entry.blockTime ?? null,
      events,
    };
  });
}
