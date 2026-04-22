# DisDex Vault / Owner Architecture

## Goal

- User keeps ownership with an external owner wallet such as MetaMask.
- Trading capital is stored in an on-chain Vault.
- The bot can trade only.
- Withdrawals charge a 10% fee on the profit component only.
- Existing VPS wallet `0x1337e80294f808b2Fd9b71f6E43869cAdf1cf0E5` remains untouched until its current position is closed.

## Core Roles

### Owner wallet

- Controlled by the user
- Used for login, recovery, and withdrawal approval
- Must not be generated or stored by the site

### Vault

- Holds operational capital
- Receives deposits directly
- Executes withdrawals through fee-aware contract logic
- Tracks principal, withdrawn principal, high-water-mark, realized profit, and fees paid

### Trader bot

- Can call trade functions only
- Cannot withdraw
- Cannot change owner
- Cannot change withdrawal whitelist

## Deposit Flow

1. User logs in.
2. User connects owner wallet.
3. User creates Vault.
4. User deposits directly into the Vault address.
5. Bot trades using Vault funds.

## Recovery Flow

1. User restores MetaMask or reconnects the same owner wallet.
2. User opens DisDex again or any emergency recovery UI.
3. The same owner wallet regains control of the Vault.
4. Vault funds remain on-chain even if the site is unavailable.

## Fee Model

- Fee recipient is configured in the Vault.
- Fee rate is 10% on the profit component only.
- Principal is never charged.
- High-water-mark is preserved across additional deposits.

### Basic formula

- `NAV = current vault market value`
- `profitBase = max(0, NAV - effectivePrincipalBase - highWaterAdjustment)`
- `fee = profitComponent * 10%`

## UI Direction

### Home

- Promote `owner wallet connection`
- Promote `Vault creation`
- Explain that deposits go to the Vault, not to the owner wallet

### Wallets

- Show owner wallet
- Show Vault address
- Show trader status
- Show principal
- Show fee-eligible profit
- Show estimated net withdrawal
- Show Vault event timeline

### Settings

- 2FA
- owner wallet reconnect confirmation
- notifications
- inquiry

## Migration Note

- Legacy VPS wallet flow stays available for the currently active operational wallet.
- New users should move to owner wallet + Vault onboarding.
