import {
  AnchorProvider,
  BN,
  Program,
  type Idl,
  setProvider,
} from "@anchor-lang/core";
import {
  createAccount,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import { readFileSync } from "node:fs";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import type { AttenzaToken } from "../target/types/attenza_token.js";

const provider = AnchorProvider.env();
setProvider(provider);
const idl = JSON.parse(
  readFileSync("target/idl/attenza_token.json", "utf8"),
) as Idl;
const program = new Program<AttenzaToken>(idl as AttenzaToken, provider);
const walletPath = process.env.ANCHOR_WALLET;
assert.isString(
  walletPath,
  "ANCHOR_WALLET must point to the ephemeral localnet payer",
);
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(walletPath as string, "utf8")) as number[],
  ),
);
const seed = (s: string) => Buffer.from(s);
const pda = (...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const startupId = (suffix: number) => Buffer.alloc(32, suffix);
const startupPda = (id: Buffer) =>
  pda(seed("startup"), provider.wallet.publicKey.toBuffer(), id);
const allocationPda = (id: Buffer) =>
  pda(seed("allocation"), provider.wallet.publicKey.toBuffer(), id);
const mintAuthorityPda = (id: Buffer) =>
  pda(seed("mint-authority"), provider.wallet.publicKey.toBuffer(), id);
const mintPda = (id: Buffer) =>
  pda(seed("mint"), provider.wallet.publicKey.toBuffer(), id);
const vaultPda = (startup: PublicKey, bucket: number) =>
  pda(seed("vault"), startup.toBuffer(), Buffer.from([bucket]));
const schedulePda = (startup: PublicKey, id: Buffer) =>
  pda(seed("vesting"), startup.toBuffer(), id);
const escrowPda = (startup: PublicKey, id: Buffer) =>
  pda(seed("vesting-escrow"), startup.toBuffer(), id);
const allocation = (
  market: number,
  startup: number,
  community: number,
  locked: number,
) => ({
  marketInventory: new BN(market),
  startupReserve: new BN(startup),
  communityReserve: new BN(community),
  lockedReserve: new BN(locked),
});

async function expectFailure(
  promise: Promise<unknown>,
  code?: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (code) assert.include(String(error), code);
    return;
  }
  assert.fail("Expected transaction to fail");
}

async function currentBlockTime(): Promise<number> {
  const slot = await provider.connection.getSlot("confirmed");
  const time = await provider.connection.getBlockTime(slot);
  assert.isNumber(time, "local validator must provide block time");
  return time as number;
}

describe("ATTENZA local validator token lifecycle", () => {
  it("rejects invalid allocations without creating a startup or mint", async () => {
    const id = startupId(9);
    const startup = startupPda(id);
    await expectFailure(
      program.methods
        .initializeStartup(
          Array.from(id),
          new BN(100),
          6,
          allocation(20, 20, 20, 39),
        )
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: allocationPda(id),
          mintAuthority: mintAuthorityPda(id),
          mint: mintPda(id),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );
    assert.isNull(await provider.connection.getAccountInfo(startup));
    assert.isNull(await provider.connection.getAccountInfo(mintPda(id)));

    const zeroSupplyId = startupId(7);
    await expectFailure(
      program.methods
        .initializeStartup(
          Array.from(zeroSupplyId),
          new BN(0),
          6,
          allocation(0, 0, 0, 0),
        )
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startupPda(zeroSupplyId),
          allocationLedger: allocationPda(zeroSupplyId),
          mintAuthority: mintAuthorityPda(zeroSupplyId),
          mint: mintPda(zeroSupplyId),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
      "InvalidSupply",
    );

    const decimalsId = startupId(6);
    await expectFailure(
      program.methods
        .initializeStartup(
          Array.from(decimalsId),
          new BN(100),
          10,
          allocation(25, 25, 25, 25),
        )
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startupPda(decimalsId),
          allocationLedger: allocationPda(decimalsId),
          mintAuthority: mintAuthorityPda(decimalsId),
          mint: mintPda(decimalsId),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
      "InvalidDecimals",
    );

    const overflowId = startupId(8);
    const overflowMax = new BN("18446744073709551615");
    await expectFailure(
      program.methods
        .initializeStartup(Array.from(overflowId), overflowMax, 0, {
          marketInventory: overflowMax,
          startupReserve: new BN(1),
          communityReserve: new BN(0),
          lockedReserve: new BN(0),
        })
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startupPda(overflowId),
          allocationLedger: allocationPda(overflowId),
          mintAuthority: mintAuthorityPda(overflowId),
          mint: mintPda(overflowId),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );
    assert.isNull(
      await provider.connection.getAccountInfo(startupPda(overflowId)),
    );
  });

  it("creates and finalizes exact fixed supply across four controlled vaults", async () => {
    const id = startupId(1);
    const startup = startupPda(id);
    const ledger = allocationPda(id);
    const mint = mintPda(id);
    const auth = mintAuthorityPda(id);
    const allocations = allocation(500_000, 100_000, 100_000, 300_000);
    const initSig = await program.methods
      .initializeStartup(Array.from(id), new BN(1_000_000), 6, allocations)
      .accountsStrict({
        startupAuthority: provider.wallet.publicKey,
        startupConfig: startup,
        allocationLedger: ledger,
        mintAuthority: auth,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    assert.isString(initSig);
    const mintBefore = await getMint(provider.connection, mint);
    assert.equal(mintBefore.decimals, 6);
    assert.equal(mintBefore.supply, 0n);
    assert.isNull(mintBefore.freezeAuthority);
    assert.equal(mintBefore.mintAuthority?.toBase58(), auth.toBase58());

    await expectFailure(
      program.methods
        .initializeStartup(Array.from(id), new BN(1_000_000), 6, allocations)
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          mintAuthority: auth,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );

    const vaults = [0, 1, 2, 3].map((bucket) => vaultPda(startup, bucket));
    const attacker = Keypair.generate();
    await expectFailure(
      program.methods
        .createAllocationVault({ marketInventory: {} })
        .accountsStrict({
          startupAuthority: attacker.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          vaultAuthority: auth,
          mint,
          vault: vaults[0]!,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker])
        .rpc(),
    );
    await expectFailure(
      program.methods
        .createAllocationVault({ marketInventory: {} })
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          vaultAuthority: auth,
          mint: Keypair.generate().publicKey,
          vault: vaults[0]!,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );
    for (const [bucket, name] of [
      [0, "marketInventory"],
      [1, "startupReserve"],
      [2, "communityReserve"],
      [3, "lockedReserve"],
    ] as const) {
      await program.methods
        .createAllocationVault({ [name]: {} } as any)
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          vaultAuthority: auth,
          mint,
          vault: vaults[bucket]!,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    }
    await expectFailure(
      program.methods
        .createAllocationVault({ marketInventory: {} })
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          vaultAuthority: auth,
          mint,
          vault: vaults[0]!,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc(),
    );

    const [market, startupReserve, community, locked] = vaults;
    const fundSig = await program.methods
      .fundAllocations()
      .accountsStrict({
        startupAuthority: provider.wallet.publicKey,
        startupConfig: startup,
        allocationLedger: ledger,
        mintAuthority: auth,
        mint,
        marketVault: market!,
        startupReserveVault: startupReserve!,
        communityReserveVault: community!,
        lockedReserveVault: locked!,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    assert.isString(fundSig);
    assert.equal((await getMint(provider.connection, mint)).supply, 1_000_000n);
    assert.equal(
      (await getAccount(provider.connection, market!)).amount,
      500_000n,
    );
    assert.equal(
      (await getAccount(provider.connection, startupReserve!)).amount,
      100_000n,
    );
    assert.equal(
      (await getAccount(provider.connection, community!)).amount,
      100_000n,
    );
    assert.equal(
      (await getAccount(provider.connection, locked!)).amount,
      300_000n,
    );

    const finalizeSig = await program.methods
      .finalizeStartup()
      .accountsStrict({
        startupAuthority: provider.wallet.publicKey,
        startupConfig: startup,
        allocationLedger: ledger,
        mintAuthority: auth,
        mint,
        marketVault: market!,
        startupReserveVault: startupReserve!,
        communityReserveVault: community!,
        lockedReserveVault: locked!,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
    assert.isString(finalizeSig);
    const finalizedMint = await getMint(provider.connection, mint);
    assert.equal(finalizedMint.supply, 1_000_000n);
    assert.isNull(finalizedMint.mintAuthority);
    assert.isNull(finalizedMint.freezeAuthority);
    const state = await program.account.startupConfig.fetch(startup);
    assert.equal(Object.keys(state.state as object)[0], "finalized");
    await expectFailure(
      program.methods
        .fundAllocations()
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          mintAuthority: auth,
          mint,
          marketVault: market!,
          startupReserveVault: startupReserve!,
          communityReserveVault: community!,
          lockedReserveVault: locked!,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    );
    await expectFailure(
      program.methods
        .finalizeStartup()
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          mintAuthority: auth,
          mint,
          marketVault: market!,
          startupReserveVault: startupReserve!,
          communityReserveVault: community!,
          lockedReserveVault: locked!,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: SYSVAR_CLOCK_PUBKEY,
        })
        .rpc(),
    );
  });

  it("escrows the locked reserve and pays only vested tokens to the beneficiary", async () => {
    const id = startupId(1);
    const startup = startupPda(id);
    const ledger = allocationPda(id);
    const mint = mintPda(id);
    const auth = mintAuthorityPda(id);
    const locked = vaultPda(startup, 3);
    const beneficiary = Keypair.generate();
    await provider.connection.requestAirdrop(
      beneficiary.publicKey,
      1_000_000_000,
    );
    const beneficiaryTokens = await createAccount(
      provider.connection,
      payer,
      mint,
      beneficiary.publicKey,
    );
    const now = await currentBlockTime();
    const earlyId = startupId(33);
    const partialId = startupId(34);
    const completeId = startupId(35);
    const early = schedulePda(startup, earlyId);
    const partial = schedulePda(startup, partialId);
    const complete = schedulePda(startup, completeId);
    const earlyEscrow = escrowPda(startup, earlyId);
    const partialEscrow = escrowPda(startup, partialId);
    const completeEscrow = escrowPda(startup, completeId);

    const createSchedule = async (
      scheduleId: Buffer,
      schedule: PublicKey,
      escrow: PublicKey,
      amount: number,
      start: number,
      cliff: number,
      end: number,
    ) =>
      program.methods
        .createVestingSchedule(
          Array.from(scheduleId),
          new BN(amount),
          new BN(start),
          new BN(cliff),
          new BN(end),
        )
        .accountsStrict({
          startupAuthority: provider.wallet.publicKey,
          startupConfig: startup,
          allocationLedger: ledger,
          vaultAuthority: auth,
          mint,
          lockedReserveVault: locked,
          vestingSchedule: schedule,
          beneficiary: beneficiary.publicKey,
          escrow,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
    await createSchedule(
      earlyId,
      early,
      earlyEscrow,
      100_000,
      now - 100,
      now + 7_200,
      now + 10_800,
    );
    assert.equal(
      (await getAccount(provider.connection, locked)).amount,
      200_000n,
    );
    assert.equal(
      (await getAccount(provider.connection, earlyEscrow)).amount,
      100_000n,
    );
    await program.methods
      .activateVestingSchedule()
      .accountsStrict({
        startupAuthority: provider.wallet.publicKey,
        startupConfig: startup,
        vestingSchedule: early,
      })
      .rpc();
    await expectFailure(
      program.methods
        .claimVested()
        .accountsStrict({
          beneficiary: beneficiary.publicKey,
          vestingSchedule: early,
          escrow: earlyEscrow,
          beneficiaryTokenAccount: beneficiaryTokens,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc(),
    );

    await createSchedule(
      partialId,
      partial,
      partialEscrow,
      100_000,
      now - 300,
      now - 200,
      now + 600,
    );
    await createSchedule(
      completeId,
      complete,
      completeEscrow,
      100_000,
      now - 2_000,
      now - 1_500,
      now - 1_000,
    );
    await expectFailure(
      createSchedule(
        startupId(36),
        schedulePda(startup, startupId(36)),
        escrowPda(startup, startupId(36)),
        1,
        now - 2_000,
        now - 1_500,
        now - 1_000,
      ),
    );
    await program.methods
      .activateVestingSchedule()
      .accountsStrict({
        startupAuthority: provider.wallet.publicKey,
        startupConfig: startup,
        vestingSchedule: partial,
      })
      .rpc();
    await program.methods
      .activateVestingSchedule()
      .accountsStrict({
        startupAuthority: provider.wallet.publicKey,
        startupConfig: startup,
        vestingSchedule: complete,
      })
      .rpc();

    const partialSig = await program.methods
      .claimVested()
      .accountsStrict({
        beneficiary: beneficiary.publicKey,
        vestingSchedule: partial,
        escrow: partialEscrow,
        beneficiaryTokenAccount: beneficiaryTokens,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();
    assert.isString(partialSig);
    const scheduleState = await program.account.vestingSchedule.fetch(partial);
    assert.isAbove(scheduleState.claimed.toNumber(), 0);
    assert.isBelow(scheduleState.claimed.toNumber(), 100_000);
    assert.equal(
      (await getAccount(provider.connection, beneficiaryTokens)).amount,
      BigInt(scheduleState.claimed.toString()),
    );
    assert.equal(
      (await getAccount(provider.connection, partialEscrow)).amount,
      100_000n - BigInt(scheduleState.claimed.toString()),
    );

    const fullSig = await program.methods
      .claimVested()
      .accountsStrict({
        beneficiary: beneficiary.publicKey,
        vestingSchedule: complete,
        escrow: completeEscrow,
        beneficiaryTokenAccount: beneficiaryTokens,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();
    assert.isString(fullSig);
    assert.equal(
      (await getAccount(provider.connection, completeEscrow)).amount,
      0n,
    );
    assert.equal(
      (await getAccount(provider.connection, beneficiaryTokens)).amount,
      BigInt(scheduleState.claimed.toString()) + 100_000n,
    );
    await expectFailure(
      program.methods
        .claimVested()
        .accountsStrict({
          beneficiary: beneficiary.publicKey,
          vestingSchedule: complete,
          escrow: completeEscrow,
          beneficiaryTokenAccount: beneficiaryTokens,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary])
        .rpc(),
    );

    const attacker = Keypair.generate();
    await provider.connection.requestAirdrop(attacker.publicKey, 1_000_000_000);
    await expectFailure(
      program.methods
        .claimVested()
        .accountsStrict({
          beneficiary: attacker.publicKey,
          vestingSchedule: partial,
          escrow: partialEscrow,
          beneficiaryTokenAccount: beneficiaryTokens,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc(),
    );
  });
});
