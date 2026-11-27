use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{
    self, InitializeMint2, Mint, MintTo, SetAuthority, Token, TokenAccount, Transfer,
};

declare_id!("46UFiREvpUgYEB4hgDzBR6n29Mh1BKBR9yp7VoEAapCo");
const VAULTS: u8 = 0b1111;

#[program]
pub mod attenza_token {
    use super::*;

    pub fn initialize_startup(
        ctx: Context<InitializeStartup>,
        startup_id: [u8; 32],
        total_supply: u64,
        decimals: u8,
        allocations: AllocationAmounts,
    ) -> Result<()> {
        require!(total_supply > 0, AttenzaError::InvalidSupply);
        require!(decimals <= 9, AttenzaError::InvalidDecimals);
        require!(
            allocations.sum()? == total_supply,
            AttenzaError::AllocationMismatch
        );
        let config = &mut ctx.accounts.startup_config;
        config.startup_id = startup_id;
        config.authority = ctx.accounts.startup_authority.key();
        config.mint = ctx.accounts.mint.key();
        config.state = LifecycleState::Created;
        config.bump = ctx.bumps.startup_config;
        config.authority_bump = ctx.bumps.mint_authority;
        let ledger = &mut ctx.accounts.allocation_ledger;
        ledger.startup = config.key();
        ledger.created_by = ctx.accounts.startup_authority.key();
        ledger.total_supply = total_supply;
        ledger.decimals = decimals;
        ledger.allocations = allocations;
        ledger.vaults = [Pubkey::default(); 4];
        ledger.vault_mask = 0;
        ledger.locked_amount_assigned = 0;
        ledger.finalized_at = 0;
        ledger.bump = ctx.bumps.allocation_ledger;
        token::initialize_mint2(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                InitializeMint2 {
                    mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            decimals,
            &ctx.accounts.mint_authority.key(),
            None,
        )?;
        emit!(StartupTokenCreated {
            startup_id,
            startup: config.key(),
            mint: config.mint,
            total_supply,
            decimals,
            authority: config.authority
        });
        Ok(())
    }

    pub fn create_allocation_vault(
        ctx: Context<CreateAllocationVault>,
        bucket: AllocationBucket,
    ) -> Result<()> {
        require!(
            ctx.accounts.startup_config.state == LifecycleState::Created,
            AttenzaError::InvalidState
        );
        let i = bucket.index();
        let bit = 1u8 << i;
        require!(
            ctx.accounts.allocation_ledger.vault_mask & bit == 0,
            AttenzaError::VaultAlreadyCreated
        );
        ctx.accounts.allocation_ledger.vaults[i] = ctx.accounts.vault.key();
        ctx.accounts.allocation_ledger.vault_mask |= bit;
        emit!(AllocationVaultCreated {
            startup: ctx.accounts.startup_config.key(),
            bucket,
            vault: ctx.accounts.vault.key()
        });
        Ok(())
    }

    pub fn fund_allocations(ctx: Context<FundAllocations>) -> Result<()> {
        require!(
            ctx.accounts.startup_config.state == LifecycleState::Created,
            AttenzaError::InvalidState
        );
        require!(
            ctx.accounts.allocation_ledger.vault_mask == VAULTS,
            AttenzaError::VaultsIncomplete
        );
        require!(
            ctx.accounts.mint.supply == 0
                && ctx.accounts.mint.mint_authority
                    == COption::Some(ctx.accounts.mint_authority.key()),
            AttenzaError::MintStateInvalid
        );
        let authority = ctx.accounts.startup_config.authority;
        let startup_id = ctx.accounts.startup_config.startup_id;
        let bump = [ctx.accounts.startup_config.authority_bump];
        let seeds: &[&[u8]] = &[b"mint-authority", authority.as_ref(), &startup_id, &bump];
        let signer = &[seeds];
        let pairs = [
            (
                &ctx.accounts.market_vault,
                ctx.accounts.allocation_ledger.allocations.market_inventory,
            ),
            (
                &ctx.accounts.startup_reserve_vault,
                ctx.accounts.allocation_ledger.allocations.startup_reserve,
            ),
            (
                &ctx.accounts.community_reserve_vault,
                ctx.accounts.allocation_ledger.allocations.community_reserve,
            ),
            (
                &ctx.accounts.locked_reserve_vault,
                ctx.accounts.allocation_ledger.allocations.locked_reserve,
            ),
        ];
        for (vault, amount) in pairs {
            if amount > 0 {
                token::mint_to(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.key(),
                        MintTo {
                            mint: ctx.accounts.mint.to_account_info(),
                            to: vault.to_account_info(),
                            authority: ctx.accounts.mint_authority.to_account_info(),
                        },
                        signer,
                    ),
                    amount,
                )?;
            }
        }
        ctx.accounts.mint.reload()?;
        require!(
            ctx.accounts.mint.supply == ctx.accounts.allocation_ledger.total_supply,
            AttenzaError::SupplyMismatch
        );
        ctx.accounts.startup_config.state = LifecycleState::Funded;
        emit!(AllocationsFunded {
            startup: ctx.accounts.startup_config.key(),
            mint: ctx.accounts.mint.key(),
            total_supply: ctx.accounts.mint.supply
        });
        Ok(())
    }

    pub fn finalize_startup(ctx: Context<FinalizeStartup>) -> Result<()> {
        require!(
            ctx.accounts.startup_config.state == LifecycleState::Funded,
            AttenzaError::InvalidState
        );
        let l = &ctx.accounts.allocation_ledger;
        require!(
            ctx.accounts.mint.supply == l.total_supply,
            AttenzaError::SupplyMismatch
        );
        require!(
            ctx.accounts.market_vault.amount == l.allocations.market_inventory,
            AttenzaError::VaultBalanceMismatch
        );
        require!(
            ctx.accounts.startup_reserve_vault.amount == l.allocations.startup_reserve,
            AttenzaError::VaultBalanceMismatch
        );
        require!(
            ctx.accounts.community_reserve_vault.amount == l.allocations.community_reserve,
            AttenzaError::VaultBalanceMismatch
        );
        require!(
            ctx.accounts.locked_reserve_vault.amount == l.allocations.locked_reserve,
            AttenzaError::VaultBalanceMismatch
        );
        require!(
            ctx.accounts.mint.freeze_authority.is_none(),
            AttenzaError::FreezeAuthorityPresent
        );
        require!(
            ctx.accounts.mint.mint_authority == COption::Some(ctx.accounts.mint_authority.key()),
            AttenzaError::MintStateInvalid
        );
        let authority = ctx.accounts.startup_config.authority;
        let startup_id = ctx.accounts.startup_config.startup_id;
        let bump = [ctx.accounts.startup_config.authority_bump];
        let seeds: &[&[u8]] = &[b"mint-authority", authority.as_ref(), &startup_id, &bump];
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[seeds],
            ),
            AuthorityType::MintTokens,
            None,
        )?;
        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.startup_config.state = LifecycleState::Finalized;
        ctx.accounts.allocation_ledger.finalized_at = now;
        emit!(TokenInitializationFinalized {
            startup_id: ctx.accounts.startup_config.startup_id,
            startup: ctx.accounts.startup_config.key(),
            mint: ctx.accounts.mint.key(),
            total_supply: ctx.accounts.mint.supply,
            finalized_at: now
        });
        Ok(())
    }

    pub fn create_vesting_schedule(
        ctx: Context<CreateVestingSchedule>,
        schedule_id: [u8; 32],
        amount: u64,
        start_ts: i64,
        cliff_ts: i64,
        end_ts: i64,
    ) -> Result<()> {
        require!(
            ctx.accounts.startup_config.state == LifecycleState::Finalized,
            AttenzaError::InvalidState
        );
        require!(
            start_ts >= 0 && start_ts < end_ts && cliff_ts >= start_ts && cliff_ts <= end_ts,
            AttenzaError::InvalidSchedule
        );
        require!(amount > 0, AttenzaError::InvalidSchedule);
        let assigned = ctx
            .accounts
            .allocation_ledger
            .locked_amount_assigned
            .checked_add(amount)
            .ok_or(AttenzaError::Arithmetic)?;
        require!(
            assigned <= ctx.accounts.allocation_ledger.allocations.locked_reserve,
            AttenzaError::LockedReserveAssigned
        );
        let config = ctx.accounts.startup_config.key();
        let authority = ctx.accounts.startup_config.authority;
        let startup_id = ctx.accounts.startup_config.startup_id;
        let bump = [ctx.accounts.startup_config.authority_bump];
        let seeds: &[&[u8]] = &[b"mint-authority", authority.as_ref(), &startup_id, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.locked_reserve_vault.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        let s = &mut ctx.accounts.vesting_schedule;
        s.startup = config;
        s.startup_id = ctx.accounts.startup_config.startup_id;
        s.schedule_id = schedule_id;
        s.beneficiary = ctx.accounts.beneficiary.key();
        s.mint = ctx.accounts.mint.key();
        s.escrow = ctx.accounts.escrow.key();
        s.total_locked = amount;
        s.start_ts = start_ts;
        s.cliff_ts = cliff_ts;
        s.end_ts = end_ts;
        s.claimed = 0;
        s.active = false;
        s.bump = ctx.bumps.vesting_schedule;
        ctx.accounts.allocation_ledger.locked_amount_assigned = assigned;
        emit!(VestingScheduleCreated {
            startup_id: s.startup_id,
            schedule: s.key(),
            beneficiary: s.beneficiary,
            mint: s.mint,
            escrow: s.escrow,
            total_locked: s.total_locked,
            start_ts,
            cliff_ts,
            end_ts
        });
        Ok(())
    }

    pub fn activate_vesting_schedule(ctx: Context<ActivateVestingSchedule>) -> Result<()> {
        require!(
            !ctx.accounts.vesting_schedule.active,
            AttenzaError::ScheduleAlreadyActive
        );
        require!(
            ctx.accounts.vesting_schedule.total_locked > 0,
            AttenzaError::InvalidSchedule
        );
        ctx.accounts.vesting_schedule.active = true;
        let s = &ctx.accounts.vesting_schedule;
        emit!(VestingScheduleActivated {
            startup_id: s.startup_id,
            schedule: s.key(),
            beneficiary: s.beneficiary,
            total_locked: s.total_locked,
            start_ts: s.start_ts,
            cliff_ts: s.cliff_ts,
            end_ts: s.end_ts
        });
        Ok(())
    }

    pub fn claim_vested(ctx: Context<ClaimVested>) -> Result<()> {
        let s = &mut ctx.accounts.vesting_schedule;
        require!(s.active, AttenzaError::ScheduleNotActive);
        require_keys_eq!(
            ctx.accounts.beneficiary.key(),
            s.beneficiary,
            AttenzaError::UnauthorizedBeneficiary
        );
        let vested = vested_amount(s, Clock::get()?.unix_timestamp)?;
        let amount = vested
            .checked_sub(s.claimed)
            .ok_or(AttenzaError::Arithmetic)?;
        require!(amount > 0, AttenzaError::NothingToClaim);
        let claimed = s
            .claimed
            .checked_add(amount)
            .ok_or(AttenzaError::Arithmetic)?;
        require!(claimed <= s.total_locked, AttenzaError::Arithmetic);
        let startup = s.startup;
        let schedule_id = s.schedule_id;
        let bump = [s.bump];
        let seeds: &[&[u8]] = &[b"vesting", startup.as_ref(), &schedule_id, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.beneficiary_token_account.to_account_info(),
                    authority: s.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        s.claimed = claimed;
        let now = Clock::get()?.unix_timestamp;
        emit!(VestingClaimed {
            startup_id: s.startup_id,
            schedule: s.key(),
            beneficiary: s.beneficiary,
            amount_claimed: amount,
            cumulative_claimed: claimed,
            remaining_locked: s
                .total_locked
                .checked_sub(claimed)
                .ok_or(AttenzaError::Arithmetic)?,
            timestamp: now
        });
        Ok(())
    }
}

fn vested_amount(s: &VestingSchedule, now: i64) -> Result<u64> {
    require!(
        s.start_ts >= 0 && s.start_ts < s.end_ts,
        AttenzaError::InvalidSchedule
    );
    if now < s.cliff_ts || now < s.start_ts {
        return Ok(0);
    }
    if now >= s.end_ts {
        return Ok(s.total_locked);
    }
    let elapsed = u128::try_from(now.checked_sub(s.start_ts).ok_or(AttenzaError::Timestamp)?)
        .map_err(|_| error!(AttenzaError::Timestamp))?;
    let duration = u128::try_from(
        s.end_ts
            .checked_sub(s.start_ts)
            .ok_or(AttenzaError::Timestamp)?,
    )
    .map_err(|_| error!(AttenzaError::Timestamp))?;
    let value = u128::from(s.total_locked)
        .checked_mul(elapsed)
        .ok_or(AttenzaError::Arithmetic)?
        / duration;
    u64::try_from(value).map_err(|_| error!(AttenzaError::Arithmetic))
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct AllocationAmounts {
    pub market_inventory: u64,
    pub startup_reserve: u64,
    pub community_reserve: u64,
    pub locked_reserve: u64,
}
impl AllocationAmounts {
    fn sum(self) -> Result<u64> {
        self.market_inventory
            .checked_add(self.startup_reserve)
            .and_then(|x| x.checked_add(self.community_reserve))
            .and_then(|x| x.checked_add(self.locked_reserve))
            .ok_or_else(|| error!(AttenzaError::Arithmetic))
    }
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AllocationBucket {
    MarketInventory,
    StartupReserve,
    CommunityReserve,
    LockedReserve,
}
impl AllocationBucket {
    fn index(self) -> usize {
        match self {
            Self::MarketInventory => 0,
            Self::StartupReserve => 1,
            Self::CommunityReserve => 2,
            Self::LockedReserve => 3,
        }
    }
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum LifecycleState {
    Created,
    Funded,
    Finalized,
}

#[derive(Accounts)]
#[instruction(startup_id: [u8; 32], total_supply: u64, decimals: u8, allocations: AllocationAmounts)]
pub struct InitializeStartup<'info> {
    #[account(mut)]
    pub startup_authority: Signer<'info>,
    #[account(init, payer=startup_authority, space=8+StartupConfig::INIT_SPACE, seeds=[b"startup", startup_authority.key().as_ref(), &startup_id], bump)]
    pub startup_config: Account<'info, StartupConfig>,
    #[account(init, payer=startup_authority, space=8+AllocationLedger::INIT_SPACE, seeds=[b"allocation", startup_authority.key().as_ref(), &startup_id], bump)]
    pub allocation_ledger: Account<'info, AllocationLedger>,
    /// CHECK: Canonical PDA temporarily signs mint operations; no private key exists.
    #[account(seeds=[b"mint-authority", startup_authority.key().as_ref(), &startup_id], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Created with Token Program ownership and initialized by initialize_mint2 below.
    #[account(init, payer=startup_authority, space=anchor_spl::token::spl_token::state::Mint::LEN, owner=token_program.key(), seeds=[b"mint", startup_authority.key().as_ref(), &startup_id], bump)]
    pub mint: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
#[instruction(bucket: AllocationBucket)]
pub struct CreateAllocationVault<'info> {
    #[account(mut, address=startup_config.authority)]
    pub startup_authority: Signer<'info>,
    #[account(mut, seeds=[b"startup", startup_authority.key().as_ref(), &startup_config.startup_id], bump=startup_config.bump)]
    pub startup_config: Account<'info, StartupConfig>,
    #[account(mut, seeds=[b"allocation", startup_config.authority.as_ref(), &startup_config.startup_id], bump=allocation_ledger.bump, constraint=allocation_ledger.startup==startup_config.key())]
    pub allocation_ledger: Account<'info, AllocationLedger>,
    /// CHECK: Canonical PDA token-account owner.
    #[account(seeds=[b"mint-authority", startup_config.authority.as_ref(), &startup_config.startup_id], bump=startup_config.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(address=startup_config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(init, payer=startup_authority, seeds=[b"vault", startup_config.key().as_ref(), &[bucket.index() as u8]], bump, token::mint=mint, token::authority=vault_authority)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct FundAllocations<'info> {
    #[account(mut, address=startup_config.authority)]
    pub startup_authority: Signer<'info>,
    #[account(mut, seeds=[b"startup", startup_authority.key().as_ref(), &startup_config.startup_id], bump=startup_config.bump)]
    pub startup_config: Account<'info, StartupConfig>,
    #[account(mut, seeds=[b"allocation", startup_config.authority.as_ref(), &startup_config.startup_id], bump=allocation_ledger.bump, constraint=allocation_ledger.startup==startup_config.key())]
    pub allocation_ledger: Account<'info, AllocationLedger>,
    /// CHECK: Canonical temporary mint authority.
    #[account(seeds=[b"mint-authority", startup_config.authority.as_ref(), &startup_config.startup_id], bump=startup_config.authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut, address=startup_config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, address=allocation_ledger.vaults[0], token::mint=mint, token::authority=mint_authority)]
    pub market_vault: Account<'info, TokenAccount>,
    #[account(mut, address=allocation_ledger.vaults[1], token::mint=mint, token::authority=mint_authority)]
    pub startup_reserve_vault: Account<'info, TokenAccount>,
    #[account(mut, address=allocation_ledger.vaults[2], token::mint=mint, token::authority=mint_authority)]
    pub community_reserve_vault: Account<'info, TokenAccount>,
    #[account(mut, address=allocation_ledger.vaults[3], token::mint=mint, token::authority=mint_authority)]
    pub locked_reserve_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct FinalizeStartup<'info> {
    #[account(mut, address=startup_config.authority)]
    pub startup_authority: Signer<'info>,
    #[account(mut, seeds=[b"startup", startup_authority.key().as_ref(), &startup_config.startup_id], bump=startup_config.bump)]
    pub startup_config: Account<'info, StartupConfig>,
    #[account(mut, seeds=[b"allocation", startup_config.authority.as_ref(), &startup_config.startup_id], bump=allocation_ledger.bump, constraint=allocation_ledger.startup==startup_config.key())]
    pub allocation_ledger: Account<'info, AllocationLedger>,
    /// CHECK: Canonical temporary mint authority.
    #[account(seeds=[b"mint-authority", startup_config.authority.as_ref(), &startup_config.startup_id], bump=startup_config.authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut, address=startup_config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(address=allocation_ledger.vaults[0], token::mint=mint, token::authority=mint_authority)]
    pub market_vault: Account<'info, TokenAccount>,
    #[account(address=allocation_ledger.vaults[1], token::mint=mint, token::authority=mint_authority)]
    pub startup_reserve_vault: Account<'info, TokenAccount>,
    #[account(address=allocation_ledger.vaults[2], token::mint=mint, token::authority=mint_authority)]
    pub community_reserve_vault: Account<'info, TokenAccount>,
    #[account(address=allocation_ledger.vaults[3], token::mint=mint, token::authority=mint_authority)]
    pub locked_reserve_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}
#[derive(Accounts)]
#[instruction(schedule_id: [u8; 32])]
pub struct CreateVestingSchedule<'info> {
    #[account(mut, address=startup_config.authority)]
    pub startup_authority: Signer<'info>,
    #[account(mut, seeds=[b"startup", startup_authority.key().as_ref(), &startup_config.startup_id], bump=startup_config.bump)]
    pub startup_config: Account<'info, StartupConfig>,
    #[account(mut, seeds=[b"allocation", startup_config.authority.as_ref(), &startup_config.startup_id], bump=allocation_ledger.bump, constraint=allocation_ledger.startup==startup_config.key())]
    pub allocation_ledger: Account<'info, AllocationLedger>,
    /// CHECK: Canonical PDA token-account owner for reserve vault.
    #[account(seeds=[b"mint-authority", startup_config.authority.as_ref(), &startup_config.startup_id], bump=startup_config.authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(address=startup_config.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, address=allocation_ledger.vaults[3], token::mint=mint, token::authority=vault_authority)]
    pub locked_reserve_vault: Account<'info, TokenAccount>,
    #[account(init, payer=startup_authority, space=8+VestingSchedule::INIT_SPACE, seeds=[b"vesting", startup_config.key().as_ref(), &schedule_id], bump)]
    pub vesting_schedule: Account<'info, VestingSchedule>,
    pub beneficiary: SystemAccount<'info>,
    #[account(init, payer=startup_authority, seeds=[b"vesting-escrow", startup_config.key().as_ref(), &schedule_id], bump, token::mint=mint, token::authority=vesting_schedule)]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct ActivateVestingSchedule<'info> {
    #[account(address=startup_config.authority)]
    pub startup_authority: Signer<'info>,
    #[account(seeds=[b"startup", startup_authority.key().as_ref(), &startup_config.startup_id], bump=startup_config.bump)]
    pub startup_config: Account<'info, StartupConfig>,
    #[account(mut, seeds=[b"vesting", startup_config.key().as_ref(), &vesting_schedule.schedule_id], bump=vesting_schedule.bump, constraint=vesting_schedule.startup==startup_config.key())]
    pub vesting_schedule: Account<'info, VestingSchedule>,
}
#[derive(Accounts)]
pub struct ClaimVested<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    #[account(mut, seeds=[b"vesting", vesting_schedule.startup.as_ref(), &vesting_schedule.schedule_id], bump=vesting_schedule.bump)]
    pub vesting_schedule: Account<'info, VestingSchedule>,
    #[account(mut, address=vesting_schedule.escrow, seeds=[b"vesting-escrow", vesting_schedule.startup.as_ref(), &vesting_schedule.schedule_id], bump, token::mint=mint, token::authority=vesting_schedule)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, token::mint=mint, token::authority=beneficiary)]
    pub beneficiary_token_account: Account<'info, TokenAccount>,
    #[account(address=vesting_schedule.mint)]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct StartupConfig {
    pub startup_id: [u8; 32],
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub state: LifecycleState,
    pub bump: u8,
    pub authority_bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct AllocationLedger {
    pub startup: Pubkey,
    pub created_by: Pubkey,
    pub total_supply: u64,
    pub decimals: u8,
    pub allocations: AllocationAmounts,
    pub vaults: [Pubkey; 4],
    pub vault_mask: u8,
    pub locked_amount_assigned: u64,
    pub finalized_at: i64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct VestingSchedule {
    pub startup: Pubkey,
    pub startup_id: [u8; 32],
    pub schedule_id: [u8; 32],
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub escrow: Pubkey,
    pub total_locked: u64,
    pub start_ts: i64,
    pub cliff_ts: i64,
    pub end_ts: i64,
    pub claimed: u64,
    pub active: bool,
    pub bump: u8,
}

#[event]
pub struct StartupTokenCreated {
    pub startup_id: [u8; 32],
    pub startup: Pubkey,
    pub mint: Pubkey,
    pub total_supply: u64,
    pub decimals: u8,
    pub authority: Pubkey,
}
#[event]
pub struct AllocationVaultCreated {
    pub startup: Pubkey,
    pub bucket: AllocationBucket,
    pub vault: Pubkey,
}
#[event]
pub struct AllocationsFunded {
    pub startup: Pubkey,
    pub mint: Pubkey,
    pub total_supply: u64,
}
#[event]
pub struct TokenInitializationFinalized {
    pub startup_id: [u8; 32],
    pub startup: Pubkey,
    pub mint: Pubkey,
    pub total_supply: u64,
    pub finalized_at: i64,
}
#[event]
pub struct VestingScheduleCreated {
    pub startup_id: [u8; 32],
    pub schedule: Pubkey,
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub escrow: Pubkey,
    pub total_locked: u64,
    pub start_ts: i64,
    pub cliff_ts: i64,
    pub end_ts: i64,
}
#[event]
pub struct VestingScheduleActivated {
    pub startup_id: [u8; 32],
    pub schedule: Pubkey,
    pub beneficiary: Pubkey,
    pub total_locked: u64,
    pub start_ts: i64,
    pub cliff_ts: i64,
    pub end_ts: i64,
}
#[event]
pub struct VestingClaimed {
    pub startup_id: [u8; 32],
    pub schedule: Pubkey,
    pub beneficiary: Pubkey,
    pub amount_claimed: u64,
    pub cumulative_claimed: u64,
    pub remaining_locked: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum AttenzaError {
    #[msg("Supply must be greater than zero.")]
    InvalidSupply,
    #[msg("Decimals must be at most nine.")]
    InvalidDecimals,
    #[msg("Allocations must equal total supply exactly.")]
    AllocationMismatch,
    #[msg("Checked arithmetic failed.")]
    Arithmetic,
    #[msg("Instruction is invalid in the current state.")]
    InvalidState,
    #[msg("Allocation vault already exists.")]
    VaultAlreadyCreated,
    #[msg("All four vaults must exist before funding.")]
    VaultsIncomplete,
    #[msg("Mint authority or initial supply is invalid.")]
    MintStateInvalid,
    #[msg("Mint supply differs from declared supply.")]
    SupplyMismatch,
    #[msg("Vault balance differs from allocation.")]
    VaultBalanceMismatch,
    #[msg("Mint freeze authority must be absent.")]
    FreezeAuthorityPresent,
    #[msg("Vesting timestamps are invalid.")]
    InvalidSchedule,
    #[msg("Locked reserve has already been assigned.")]
    LockedReserveAssigned,
    #[msg("Schedule is already active.")]
    ScheduleAlreadyActive,
    #[msg("Schedule is not active.")]
    ScheduleNotActive,
    #[msg("Only the beneficiary may claim.")]
    UnauthorizedBeneficiary,
    #[msg("No additional amount is vested.")]
    NothingToClaim,
    #[msg("Timestamp is outside the valid range.")]
    Timestamp,
}

#[cfg(test)]
mod vesting_math_tests {
    use super::*;

    fn schedule(total_locked: u64, start_ts: i64, cliff_ts: i64, end_ts: i64) -> VestingSchedule {
        VestingSchedule {
            startup: Pubkey::default(),
            startup_id: [0; 32],
            schedule_id: [0; 32],
            beneficiary: Pubkey::default(),
            mint: Pubkey::default(),
            escrow: Pubkey::default(),
            total_locked,
            start_ts,
            cliff_ts,
            end_ts,
            claimed: 0,
            active: true,
            bump: 0,
        }
    }

    #[test]
    fn cliff_and_linear_release_boundaries_are_integer_rounded_down() {
        let s = schedule(11, 100, 200, 300);
        assert_eq!(vested_amount(&s, 99).unwrap(), 0);
        assert_eq!(vested_amount(&s, 199).unwrap(), 0);
        assert_eq!(vested_amount(&s, 200).unwrap(), 5);
        assert_eq!(vested_amount(&s, 250).unwrap(), 8);
        assert_eq!(vested_amount(&s, 300).unwrap(), 11);
        assert_eq!(vested_amount(&s, 301).unwrap(), 11);
    }

    #[test]
    fn rejects_invalid_timestamp_ranges() {
        let invalid = schedule(10, 20, 15, 10);
        assert!(vested_amount(&invalid, 10).is_err());
    }
}
