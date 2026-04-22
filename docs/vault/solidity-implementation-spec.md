# DisDex Vault Solidity Implementation Spec

## Goal

- User keeps an `owner wallet`
- Funds are stored in a `Vault`
- Bot can only trade
- Profit fee of `10%` is charged automatically on withdrawal

## Contracts

### DisDexVaultFactory

Responsibilities:
- Create one vault per user
- Set initial `owner` and `trader`
- Register the vault in the registry

Main functions:
- `createVault(address owner, address trader, address feeRecipient) returns (address vault)`
- `setRegistry(address registry)`

Events:
- `VaultCreated(address indexed owner, address indexed vault, address trader)`

### DisDexVaultRegistry

Responsibilities:
- Map user owner addresses to vault addresses
- Track active / legacy / migrated status if needed

Main functions:
- `registerVault(address owner, address vault)`
- `getVault(address owner) view returns (address)`
- `setVaultStatus(address vault, uint8 status)`

Events:
- `VaultRegistered(address indexed owner, address indexed vault)`
- `VaultStatusUpdated(address indexed vault, uint8 status)`

### DisDexVault

Responsibilities:
- Hold user funds
- Accept deposits
- Execute trades through approved routers only
- Enforce withdrawal fee logic
- Maintain principal / HWM accounting

## Roles

### owner

Can:
- deposit
- withdraw
- change whitelist
- change owner
- change trader
- pause / unpause

Cannot:
- bypass fee logic on withdrawal
- give trader arbitrary transfer power

### trader

Can:
- call `trade(...)` only

Cannot:
- withdraw
- change owner
- change whitelist
- pause / unpause unless explicitly allowed in future
- execute arbitrary calls

### admin

Default:
- no asset control

Optional:
- only factory / registry management

## Core State

```solidity
address public owner;
address public trader;
address public feeRecipient;
uint16 public feeBps; // 1000 = 10%
bool public paused;

mapping(address => bool) public allowedToken;
mapping(address => bool) public allowedRouter;
mapping(address => bool) public withdrawalWhitelist;

uint256 public principalUsd;
uint256 public withdrawnPrincipalUsd;
uint256 public highWaterMarkUsd;
uint256 public realizedProfitUsd;
uint256 public feesPaidUsd;

uint256 public maxTradeUsd;
uint256 public dailyTradeUsd;
uint256 public dailyLossLimitBps;
uint256 public lastDailyResetAt;
```

## Core Functions

### deposit(address token, uint256 amount)

- Owner deposits approved token
- Transfer token into vault
- Increase principal ledger using current USD valuation
- Emit `Deposit`

### withdraw(address token, uint256 amount, address to)

- Owner only
- Destination must be whitelisted
- Compute current NAV
- Split requested withdrawal into:
  - principal component
  - profit component
- Charge fee on profit component only
- Send fee to `feeRecipient`
- Send net amount to destination
- Update `withdrawnPrincipalUsd`, `feesPaidUsd`, `highWaterMarkUsd` as needed
- Emit `FeeCharged` and `WithdrawExecuted`

### trade(address router, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes calldata data)

- Trader only
- Router must be approved
- Tokens must be approved
- No arbitrary delegatecall
- Enforce max trade and daily limit
- Execute router call
- Emit `TradeExecuted`

### setTrader(address newTrader)

- Owner only

### setAllowedToken(address token, bool allowed)

- Owner only

### setAllowedRouter(address router, bool allowed)

- Owner only

### setWithdrawalWhitelist(address to, bool allowed)

- Owner only

### pause() / unpause()

- Owner only

## Profit Fee Logic

### Accounting model

- `principalUsd`: total deposited principal
- `withdrawnPrincipalUsd`: principal already returned
- `highWaterMarkUsd`: highest fee crystallization base reached
- `feesPaidUsd`: cumulative charged fees

### Definitions

- `navUsd = current vault market value`
- `effectivePrincipalUsd = max(0, principalUsd - withdrawnPrincipalUsd)`
- `profitBaseUsd = max(0, navUsd - effectivePrincipalUsd)`

### Withdrawal split

For a withdrawal request:

- `principalRatio = effectivePrincipalUsd / navUsd`
- `profitRatio = profitBaseUsd / navUsd`
- `principalPortion = withdrawUsd * principalRatio`
- `profitPortion = withdrawUsd * profitRatio`
- `feeUsd = profitPortion * 10%`

Fee is charged only from `profitPortion`.

## Safety Constraints

- Trader cannot transfer funds arbitrarily
- Trader cannot call arbitrary targets
- No delegatecall-based escape route
- Approved tokens only
- Approved routers only
- Daily notional cap
- Per-trade cap
- Pause supported

## Events

```solidity
event VaultCreated(address indexed owner, address indexed vault, address trader);
event Deposit(address indexed owner, address indexed token, uint256 amount, uint256 usdValue);
event WithdrawExecuted(address indexed owner, address indexed token, address indexed to, uint256 grossAmount, uint256 feeAmount);
event FeeCharged(address indexed owner, address indexed token, uint256 feeAmount, address feeRecipient);
event TradeExecuted(address indexed trader, address indexed router, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
event TraderChanged(address indexed oldTrader, address indexed newTrader);
event Paused(address indexed owner);
event Unpaused(address indexed owner);
```

## Recommended MVP Scope

Phase 1:
- Factory
- Registry
- Vault
- Deposit
- Withdraw with fee
- Trade with router/token allowlist
- Pause

Phase 2:
- Enhanced NAV oracle routing
- Better fee crystallization
- Emergency withdrawal helper
- Guard / module pattern if Smart Account integration is added
