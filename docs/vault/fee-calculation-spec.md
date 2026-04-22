# DisDex Vault Profit Fee Calculation Spec

## Objective

Charge a `10%` profit fee on withdrawals without charging fees on principal.

## Recommended Initial Model

Use:
- single-user vault accounting
- principal ledger
- High Water Mark support

Do not start with:
- simplistic `current balance - first deposit` logic

## Core Ledger Fields

- `principalUsd`
  - cumulative deposited principal
- `withdrawnPrincipalUsd`
  - principal already returned to the user
- `highWaterMarkUsd`
  - highest crystallized value for fee purposes
- `feesPaidUsd`
  - cumulative fee charged
- `realizedProfitUsd`
  - optional realized profit tracking

## Definitions

### NAV

`NAV = current total USD value of the vault`

### Effective principal

`effectivePrincipalUsd = max(0, principalUsd - withdrawnPrincipalUsd)`

### Profit base

`profitBaseUsd = max(0, NAV - effectivePrincipalUsd)`

## Withdrawal Fee Logic

When user requests a withdrawal:

1. Compute current `NAV`
2. Compute `effectivePrincipalUsd`
3. Compute `profitBaseUsd`
4. Split requested withdrawal into principal and profit portions proportionally
5. Charge `10%` fee on profit portion only

## Formula

If:
- `withdrawUsd` is requested gross withdrawal
- `NAV > 0`

Then:

- `principalRatio = effectivePrincipalUsd / NAV`
- `profitRatio = profitBaseUsd / NAV`
- `principalPortionUsd = withdrawUsd * principalRatio`
- `profitPortionUsd = withdrawUsd * profitRatio`
- `feeUsd = profitPortionUsd * 0.10`
- `netToUserUsd = withdrawUsd - feeUsd`

## Example

- Principal: `1000`
- Current NAV: `1500`
- Profit: `500`
- Withdrawal request: `500`

Then:
- `principalRatio = 1000 / 1500 = 0.6667`
- `profitRatio = 500 / 1500 = 0.3333`
- `principalPortion = 333.33`
- `profitPortion = 166.67`
- `fee = 16.67`
- `netToUser = 483.33`

## Additional Deposits

When user deposits more funds:
- `principalUsd += depositAmountUsd`
- record deposit timestamp and amount
- do not blindly reset HWM

## High Water Mark Guidance

MVP:
- keep `highWaterMarkUsd` available in state and ledger
- use it later to avoid charging twice on the same profit segment

Initial practical rule:
- charge on current profit portion at withdrawal time
- record `feesPaidUsd`
- in later phase, tighten crystallization around HWM

## Monthly Fee Crystallization

Initial version:
- not implemented

Future option:
- crystallize profit monthly
- charge fee monthly even without withdrawal

## Avoid

- using only `current balance - initial deposit`
- ignoring additional deposits
- ignoring partial withdrawals
- charging fee on principal

## Recommended Implementation Order

1. Store principal ledger fields
2. Implement withdrawal estimate API
3. Implement on-chain withdrawal fee calculation
4. Record fee ledger and trade ledger
5. Add HWM refinement later
