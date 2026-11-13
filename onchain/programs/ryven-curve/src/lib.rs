//! Ryven bonding curve: a pump-style constant-product market over VIRTUAL reserves.
//!
//!   price(token) = virtual_sol / virtual_tokens,   virtual_sol * virtual_tokens = k
//!
//! * The full token supply is deposited into a program-owned vault at creation; the mint
//!   authority must already be revoked, so supply is fixed and nobody holds a premine.
//! * Buyers send SOL (held as lamports on the curve PDA) and receive tokens; sellers do the
//!   reverse. Every trade has a slippage bound and a fee (`fee_bps`).
//! * When the vault's sellable reserve hits zero the curve is `complete` (graduated) and
//!   trading stops. DEX migration is out of scope for this MVP.
//!
//! DEVNET ONLY. UNAUDITED. Do not use with real funds.
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("7bmmZ19DfE6ondLjXTyw4tigdFqMPVjccCDchHnbvbMV");

pub const CONFIG_SEED: &[u8] = b"config";
pub const CURVE_SEED: &[u8] = b"curve";
pub const MAX_FEE_BPS: u16 = 500; // 5% hard ceiling

#[program]
pub mod ryven_curve {
    use super::*;

    /// One-time platform configuration.
    pub fn initialize_config(ctx: Context<InitializeConfig>, params: ConfigParams) -> Result<()> {
        require!(params.fee_bps <= MAX_FEE_BPS, CurveError::FeeTooHigh);
        require!(params.initial_virtual_sol > 0 && params.initial_virtual_tokens > 0, CurveError::InvalidParams);
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.fee_recipient = params.fee_recipient;
        c.fee_bps = params.fee_bps;
        c.initial_virtual_sol = params.initial_virtual_sol;
        c.initial_virtual_tokens = params.initial_virtual_tokens;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Moves the entire (fixed) supply of a freshly launched mint into the curve vault.
    pub fn create_curve(ctx: Context<CreateCurve>) -> Result<()> {
        let mint = &ctx.accounts.mint;
        require!(mint.mint_authority.is_none(), CurveError::MintAuthorityNotRevoked);
        require!(mint.freeze_authority.is_none(), CurveError::FreezeAuthorityPresent);
        let supply = mint.supply;
        require!(supply > 0, CurveError::InvalidParams);
        require!(ctx.accounts.creator_token_account.amount == supply, CurveError::CreatorMustHoldFullSupply);
        let cfg = &ctx.accounts.config;
        // Virtual token reserve must exceed the real supply so the curve never divides by zero.
        require!(cfg.initial_virtual_tokens > supply, CurveError::InvalidParams);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    mint: mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            supply,
            mint.decimals,
        )?;

        let curve = &mut ctx.accounts.curve;
        curve.mint = mint.key();
        curve.creator = ctx.accounts.creator.key();
        curve.virtual_sol_reserves = cfg.initial_virtual_sol;
        curve.virtual_token_reserves = cfg.initial_virtual_tokens;
        curve.real_sol_reserves = 0;
        curve.real_token_reserves = supply;
        curve.token_total_supply = supply;
        curve.complete = false;
        curve.bump = ctx.bumps.curve;
        emit!(CurveCreated { mint: curve.mint, creator: curve.creator, supply });
        Ok(())
    }

    /// Spend up to `sol_amount` lamports (fee included) to buy tokens.
    pub fn buy(ctx: Context<Trade>, sol_amount: u64, min_tokens_out: u64) -> Result<()> {
        require!(sol_amount > 0, CurveError::ZeroAmount);
        let fee_bps = ctx.accounts.config.fee_bps;
        let curve = &mut ctx.accounts.curve;
        require!(!curve.complete, CurveError::CurveComplete);

        let quote = quote_buy(curve.virtual_sol_reserves, curve.virtual_token_reserves, curve.real_token_reserves, sol_amount, fee_bps)?;
        require!(quote.tokens_out >= min_tokens_out, CurveError::SlippageExceeded);
        require!(quote.tokens_out > 0, CurveError::ZeroAmount);

        // SOL: trader → curve PDA (reserve) and trader → fee recipient.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer { from: ctx.accounts.trader.to_account_info(), to: curve.to_account_info() },
            ),
            quote.sol_in,
        )?;
        if quote.fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer { from: ctx.accounts.trader.to_account_info(), to: ctx.accounts.fee_recipient.to_account_info() },
                ),
                quote.fee,
            )?;
        }

        // Tokens: vault → trader, signed by the curve PDA.
        let mint_key = curve.mint;
        let seeds: &[&[u8]] = &[CURVE_SEED, mint_key.as_ref(), &[curve.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.trader_token_account.to_account_info(),
                    authority: curve.to_account_info(),
                },
                &[seeds],
            ),
            quote.tokens_out,
            ctx.accounts.mint.decimals,
        )?;

        curve.virtual_sol_reserves = curve.virtual_sol_reserves.checked_add(quote.sol_in).ok_or(CurveError::MathOverflow)?;
        curve.virtual_token_reserves = curve.virtual_token_reserves.checked_sub(quote.tokens_out).ok_or(CurveError::MathOverflow)?;
        curve.real_sol_reserves = curve.real_sol_reserves.checked_add(quote.sol_in).ok_or(CurveError::MathOverflow)?;
        curve.real_token_reserves = curve.real_token_reserves.checked_sub(quote.tokens_out).ok_or(CurveError::MathOverflow)?;
        if curve.real_token_reserves == 0 {
            curve.complete = true;
            emit!(CurveCompleted { mint: curve.mint });
        }
        emit!(TradeEvent {
            mint: curve.mint,
            trader: ctx.accounts.trader.key(),
            is_buy: true,
            sol_amount: quote.sol_in,
            token_amount: quote.tokens_out,
            fee: quote.fee,
            virtual_sol_reserves: curve.virtual_sol_reserves,
            virtual_token_reserves: curve.virtual_token_reserves,
        });
        Ok(())
    }

    /// Sell `token_amount` tokens for at least `min_sol_out` lamports (after fee).
    pub fn sell(ctx: Context<Trade>, token_amount: u64, min_sol_out: u64) -> Result<()> {
        require!(token_amount > 0, CurveError::ZeroAmount);
        let fee_bps = ctx.accounts.config.fee_bps;
        let curve = &mut ctx.accounts.curve;
        require!(!curve.complete, CurveError::CurveComplete);

        let quote = quote_sell(curve.virtual_sol_reserves, curve.virtual_token_reserves, token_amount, fee_bps)?;
        require!(quote.gross <= curve.real_sol_reserves, CurveError::InsufficientReserves);
        require!(quote.net >= min_sol_out, CurveError::SlippageExceeded);

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.trader_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            token_amount,
            ctx.accounts.mint.decimals,
        )?;

        // The curve PDA is owned by this program, so it can debit its own lamports directly.
        let curve_info = curve.to_account_info();
        **curve_info.try_borrow_mut_lamports()? = curve_info.lamports().checked_sub(quote.gross).ok_or(CurveError::MathOverflow)?;
        let trader_info = ctx.accounts.trader.to_account_info();
        **trader_info.try_borrow_mut_lamports()? = trader_info.lamports().checked_add(quote.net).ok_or(CurveError::MathOverflow)?;
        let fee_info = ctx.accounts.fee_recipient.to_account_info();
        **fee_info.try_borrow_mut_lamports()? = fee_info.lamports().checked_add(quote.fee).ok_or(CurveError::MathOverflow)?;

        curve.virtual_sol_reserves = curve.virtual_sol_reserves.checked_sub(quote.gross).ok_or(CurveError::MathOverflow)?;
        curve.virtual_token_reserves = curve.virtual_token_reserves.checked_add(token_amount).ok_or(CurveError::MathOverflow)?;
        curve.real_sol_reserves = curve.real_sol_reserves.checked_sub(quote.gross).ok_or(CurveError::MathOverflow)?;
        curve.real_token_reserves = curve.real_token_reserves.checked_add(token_amount).ok_or(CurveError::MathOverflow)?;
        emit!(TradeEvent {
            mint: curve.mint,
            trader: ctx.accounts.trader.key(),
            is_buy: false,
            sol_amount: quote.net,
            token_amount,
            fee: quote.fee,
            virtual_sol_reserves: curve.virtual_sol_reserves,
            virtual_token_reserves: curve.virtual_token_reserves,
        });
        Ok(())
    }
}

// ───────────────────────────── math (mirrored in src/lib/shared/curve.ts) ─────────────────────────────

#[derive(Debug, PartialEq, Eq)]
pub struct BuyQuote {
    pub sol_in: u64,
    pub fee: u64,
    pub tokens_out: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SellQuote {
    pub gross: u64,
    pub fee: u64,
    pub net: u64,
}

fn ceil_div(a: u128, b: u128) -> u128 {
    a.div_ceil(b)
}

/// `sol_amount` is the total the trader is willing to spend, fee included.
pub fn quote_buy(vs: u64, vt: u64, real_tokens: u64, sol_amount: u64, fee_bps: u16) -> Result<BuyQuote> {
    let (vs, vt) = (vs as u128, vt as u128);
    let k = vs.checked_mul(vt).ok_or(CurveError::MathOverflow)?;
    let fee = (sol_amount as u128) * (fee_bps as u128) / 10_000;
    let mut sol_in = sol_amount as u128 - fee;
    // Round the new token reserve UP so the curve never gives away rounding dust.
    let new_vt = ceil_div(k, vs + sol_in);
    let mut tokens_out = vt - new_vt;
    let mut fee_out = fee;
    if tokens_out >= real_tokens as u128 {
        // Last buyer: take exactly the remaining reserve and charge only the SOL needed.
        tokens_out = real_tokens as u128;
        let needed_vs = ceil_div(k, vt - tokens_out);
        sol_in = needed_vs - vs;
        fee_out = sol_in * (fee_bps as u128) / (10_000 - fee_bps as u128);
    }
    Ok(BuyQuote {
        sol_in: u64::try_from(sol_in).map_err(|_| CurveError::MathOverflow)?,
        fee: u64::try_from(fee_out).map_err(|_| CurveError::MathOverflow)?,
        tokens_out: u64::try_from(tokens_out).map_err(|_| CurveError::MathOverflow)?,
    })
}

pub fn quote_sell(vs: u64, vt: u64, token_amount: u64, fee_bps: u16) -> Result<SellQuote> {
    let (vs, vt) = (vs as u128, vt as u128);
    let k = vs.checked_mul(vt).ok_or(CurveError::MathOverflow)?;
    // Round the new SOL reserve UP so sellers never get more than the curve owes.
    let new_vs = ceil_div(k, vt + token_amount as u128);
    let gross = vs - new_vs;
    let fee = gross * (fee_bps as u128) / 10_000;
    Ok(SellQuote {
        gross: u64::try_from(gross).map_err(|_| CurveError::MathOverflow)?,
        fee: u64::try_from(fee).map_err(|_| CurveError::MathOverflow)?,
        net: u64::try_from(gross - fee).map_err(|_| CurveError::MathOverflow)?,
    })
}

// ───────────────────────────── accounts ─────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigParams {
    pub fee_recipient: Pubkey,
    pub fee_bps: u16,
    pub initial_virtual_sol: u64,
    pub initial_virtual_tokens: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub fee_bps: u16,
    pub initial_virtual_sol: u64,
    pub initial_virtual_tokens: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub token_total_supply: u64,
    pub complete: bool,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateCurve<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = creator, space = 8 + Curve::INIT_SPACE, seeds = [CURVE_SEED, mint.key().as_ref()], bump)]
    pub curve: Account<'info, Curve>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = curve,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = creator,
        associated_token::token_program = token_program,
    )]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Trade<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: must equal config.fee_recipient; only receives lamports.
    #[account(mut, address = config.fee_recipient @ CurveError::InvalidFeeRecipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds = [CURVE_SEED, mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = curve,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = trader,
        associated_token::mint = mint,
        associated_token::authority = trader,
        associated_token::token_program = token_program,
    )]
    pub trader_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ───────────────────────────── events & errors ─────────────────────────────

#[event]
pub struct CurveCreated {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub supply: u64,
}

#[event]
pub struct CurveCompleted {
    pub mint: Pubkey,
}

#[event]
pub struct TradeEvent {
    pub mint: Pubkey,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub sol_amount: u64,
    pub token_amount: u64,
    pub fee: u64,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
}

#[error_code]
pub enum CurveError {
    #[msg("Fee exceeds the 5% ceiling")]
    FeeTooHigh,
    #[msg("Invalid parameters")]
    InvalidParams,
    #[msg("Mint authority must be revoked before creating a curve")]
    MintAuthorityNotRevoked,
    #[msg("Mint must not have a freeze authority")]
    FreezeAuthorityPresent,
    #[msg("Creator must deposit the entire supply")]
    CreatorMustHoldFullSupply,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Curve has graduated; trading is closed")]
    CurveComplete,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("Curve does not hold enough SOL")]
    InsufficientReserves,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Fee recipient does not match config")]
    InvalidFeeRecipient,
}

#[cfg(test)]
mod tests {
    use super::*;
    const VS: u64 = 30_000_000_000; // 30 SOL virtual
    const VT: u64 = 1_073_000_000_000_000; // 1.073B virtual tokens (6 decimals)
    const REAL: u64 = 1_000_000_000_000_000; // 1B real tokens

    #[test]
    fn buy_then_sell_never_profits() {
        let b = quote_buy(VS, VT, REAL, 1_000_000_000, 100).unwrap();
        assert_eq!(b.fee, 10_000_000);
        assert!(b.tokens_out > 0);
        let s = quote_sell(VS + b.sol_in, VT - b.tokens_out, b.tokens_out, 100).unwrap();
        assert!(s.net < 1_000_000_000, "round trip must lose to fees + rounding");
        assert!(s.gross <= b.sol_in, "curve never pays out more than it took in");
    }

    #[test]
    fn last_buy_is_capped_at_remaining_reserve() {
        let b = quote_buy(VS, VT, REAL, u64::MAX / 4, 100).unwrap();
        assert_eq!(b.tokens_out, REAL);
        assert!(b.sol_in > 0);
    }

    #[test]
    fn price_increases_with_buys() {
        let b1 = quote_buy(VS, VT, REAL, 1_000_000_000, 0).unwrap();
        let b2 = quote_buy(VS + b1.sol_in, VT - b1.tokens_out, REAL - b1.tokens_out, 1_000_000_000, 0).unwrap();
        assert!(b2.tokens_out < b1.tokens_out);
    }
}
