# DisDex Vault UI Flow Spec

## Objective

Move new users from the legacy VPS wallet flow to an owner-wallet + Vault flow.

Legacy wallet `0x1337e80294f808b2Fd9b71f6E43869cAdf1cf0E5` remains on the old path until its current position is closed.

## Main Navigation

- Home
- Dashboard
- Vault
- Trade History
- Settings

## User Flow

### 1. Login

- User logs in with email + configured 2FA
- If needed, user then connects `owner wallet`

### 2. Connect Owner Wallet

Displayed on Vault page:
- connected owner wallet address
- connection status
- reconnect button

Action:
- `Owner wallet を接続`

### 3. Create Vault

Displayed after wallet connect:
- create vault CTA
- owner address confirmation
- expected fee model summary

Action:
- `運用Vaultを作成`

Result:
- vault record created
- status shown as pending / active / paused

### 4. Deposit

Displayed after vault creation:
- Vault address
- supported tokens
- deposit instructions
- warning about BNB gas

Action:
- `アドレスをコピー`
- `入金案内`

### 5. Autotrade Running

Dashboard and Vault page show:
- current total balance
- current holdings
- trader status
- unrealized P/L
- realized P/L
- fee-eligible profit
- recent autotrade actions

### 6. Withdraw

Displayed on Vault page:
- withdraw estimate
- fee estimate
- destination whitelist
- owner signature requirement

Actions:
- `出金見積もり`
- `出金する`

## Vault Page Required Sections

### Header summary

- Vault address
- Owner address
- Trader status
- Emergency / paused status

### Balance panel

- Total balance
- Token balances
- Unrealized P/L
- Realized P/L
- Fee-eligible profit

### Deposit panel

- Deposit address
- Copy button
- Supported assets

### Withdraw panel

- Whitelist destinations
- Withdrawal estimate
- Fee estimate
- Net receive estimate

### Activity panel

- Recent autotrade execution history
- Trade history link

## Home Screen Copy Direction

Replace legacy wording:
- from `運用ウォレット作成`
- to `運用Vault作成`

Replace recovery wording:
- from recovery phrase emphasis
- to owner wallet reconnection and on-chain ownership

## Settings

Keep:
- 2FA
- owner wallet reconnection confirmation
- notifications
- contact form

Reduce / remove:
- legacy VPS wallet recovery flow for new users
- admin withdrawal approval flow

## Legacy Compatibility Rules

### Legacy account

Address:
- `0x1337e80294f808b2Fd9b71f6E43869cAdf1cf0E5`

Handling:
- Continue showing legacy wallet information
- Do not force-migrate immediately
- Allow migration after current position is closed

### New users

- Default to Vault-first flow
- Do not present recovery phrase as the primary onboarding path

## Mobile Requirements

- Same information as desktop
- Responsive stacked layout
- Owner wallet connect and withdraw actions reachable without modal dead-ends
- 2FA and withdrawal estimate must be scrollable and usable on mobile
