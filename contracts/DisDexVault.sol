// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title DisDexVault
/// @notice Single-user operating vault for DisDexManager.
/// @dev This contract is intentionally simple and designed as an implementation
///      target for the next migration. The trader can only call trade(), while
///      owner keeps withdrawal / whitelist / emergency control.
contract DisDexVault {
    error NotOwner();
    error NotTrader();
    error InvalidAddress();
    error InvalidAmount();
    error RouterNotAllowed();
    error TokenNotAllowed();
    error WithdrawalTargetNotAllowed();
    error VaultPaused();
    error TradeLimitExceeded();
    error DailyLimitExceeded();
    error NativeTransferFailed();

    event Deposit(address indexed token, uint256 amount, address indexed from);
    event WithdrawExecuted(
        address indexed token,
        address indexed to,
        uint256 grossAmount,
        uint256 profitComponent,
        uint256 feeAmount,
        uint256 netAmount
    );
    event FeeCharged(address indexed token, uint256 amount, address indexed recipient);
    event TradeExecuted(
        address indexed router,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    );
    event TraderChanged(address indexed previousTrader, address indexed nextTrader);
    event OwnerChanged(address indexed previousOwner, address indexed nextOwner);
    event FeeRecipientChanged(address indexed previousRecipient, address indexed nextRecipient);
    event AllowedTokenUpdated(address indexed token, bool allowed);
    event AllowedRouterUpdated(address indexed router, bool allowed);
    event WithdrawalWhitelistUpdated(address indexed account, bool allowed);
    event PrincipalRecorded(address indexed token, uint256 newPrincipal);
    event HighWaterMarkUpdated(address indexed token, uint256 newValue);
    event RiskLimitsUpdated(uint256 maxTradeUsd, uint256 dailyTradeUsd, uint256 dailyLossLimitBps);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    address public owner;
    address public trader;
    address public feeRecipient;
    uint256 public feeBps;
    bool public paused;

    uint256 public maxTradeUsd;
    uint256 public dailyTradeUsd;
    uint256 public dailyLossLimitBps;

    mapping(address => bool) public allowedToken;
    mapping(address => bool) public allowedRouter;
    mapping(address => bool) public withdrawalWhitelist;

    mapping(address => uint256) public depositedPrincipal;
    mapping(address => uint256) public withdrawnPrincipal;
    mapping(address => uint256) public highWaterMark;
    mapping(address => uint256) public realizedProfitBase;
    mapping(address => uint256) public feesPaid;

    uint256 public currentDayIndex;
    uint256 public currentDayTradeUsd;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyTrader() {
        if (msg.sender != trader) revert NotTrader();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    constructor(
        address owner_,
        address trader_,
        address feeRecipient_,
        uint256 feeBps_,
        uint256 maxTradeUsd_,
        uint256 dailyTradeUsd_,
        uint256 dailyLossLimitBps_
    ) {
        if (owner_ == address(0) || trader_ == address(0) || feeRecipient_ == address(0)) revert InvalidAddress();
        owner = owner_;
        trader = trader_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        maxTradeUsd = maxTradeUsd_;
        dailyTradeUsd = dailyTradeUsd_;
        dailyLossLimitBps = dailyLossLimitBps_;
    }

    receive() external payable {
        emit Deposit(address(0), msg.value, msg.sender);
    }

    function deposit(address token, uint256 amount) external payable whenNotPaused {
        if (token == address(0)) {
            if (msg.value == 0) revert InvalidAmount();
            depositedPrincipal[address(0)] += msg.value;
            emit PrincipalRecorded(address(0), depositedPrincipal[address(0)]);
            emit Deposit(address(0), msg.value, msg.sender);
            return;
        }

        if (amount == 0) revert InvalidAmount();
        if (!allowedToken[token]) revert TokenNotAllowed();
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        depositedPrincipal[token] += amount;
        emit PrincipalRecorded(token, depositedPrincipal[token]);
        emit Deposit(token, amount, msg.sender);
    }

    /// @notice Withdraw with profit fee charged only on the profit component.
    /// @dev navValue should be the server-computed current valuation for the token bucket.
    function withdraw(address token, uint256 amount, address to, uint256 navValue) external onlyOwner whenNotPaused {
        if (to == address(0)) revert InvalidAddress();
        if (!withdrawalWhitelist[to]) revert WithdrawalTargetNotAllowed();
        if (amount == 0) revert InvalidAmount();

        uint256 effectivePrincipal = 0;
        if (depositedPrincipal[token] > withdrawnPrincipal[token]) {
            effectivePrincipal = depositedPrincipal[token] - withdrawnPrincipal[token];
        }

        uint256 profitBase = 0;
        if (navValue > effectivePrincipal) {
            profitBase = navValue - effectivePrincipal;
        }
        if (navValue > highWaterMark[token]) {
            highWaterMark[token] = navValue;
            emit HighWaterMarkUpdated(token, navValue);
        }

        uint256 profitComponent = 0;
        if (navValue > 0 && profitBase > 0) {
            profitComponent = (amount * profitBase) / navValue;
        }
        uint256 feeAmount = (profitComponent * feeBps) / 10_000;
        uint256 netAmount = amount - feeAmount;

        withdrawnPrincipal[token] += amount > effectivePrincipal ? effectivePrincipal : amount;
        realizedProfitBase[token] += profitComponent;
        feesPaid[token] += feeAmount;

        if (token == address(0)) {
            _sendNative(feeRecipient, feeAmount);
            _sendNative(to, netAmount);
        } else {
            IERC20(token).transfer(feeRecipient, feeAmount);
            IERC20(token).transfer(to, netAmount);
        }

        emit FeeCharged(token, feeAmount, feeRecipient);
        emit WithdrawExecuted(token, to, amount, profitComponent, feeAmount, netAmount);
    }

    function previewWithdraw(address token, uint256 amount, uint256 navValue)
        external
        view
        returns (
            uint256 effectivePrincipal,
            uint256 profitBase,
            uint256 profitComponent,
            uint256 feeAmount,
            uint256 netAmount
        )
    {
        if (depositedPrincipal[token] > withdrawnPrincipal[token]) {
            effectivePrincipal = depositedPrincipal[token] - withdrawnPrincipal[token];
        }

        if (navValue > effectivePrincipal) {
            profitBase = navValue - effectivePrincipal;
        }

        if (navValue > 0 && profitBase > 0) {
            profitComponent = (amount * profitBase) / navValue;
        }

        feeAmount = (profitComponent * feeBps) / 10_000;
        netAmount = amount > feeAmount ? amount - feeAmount : 0;
    }

    function trade(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data,
        uint256 assumedUsdValue
    ) external onlyTrader whenNotPaused {
        if (!allowedRouter[router]) revert RouterNotAllowed();
        if (!allowedToken[tokenIn] || !allowedToken[tokenOut]) revert TokenNotAllowed();
        if (amountIn == 0) revert InvalidAmount();
        if (assumedUsdValue > maxTradeUsd) revert TradeLimitExceeded();

        uint256 dayIndex = block.timestamp / 1 days;
        if (dayIndex != currentDayIndex) {
            currentDayIndex = dayIndex;
            currentDayTradeUsd = 0;
        }

        currentDayTradeUsd += assumedUsdValue;
        if (currentDayTradeUsd > dailyTradeUsd) revert DailyLimitExceeded();

        if (tokenIn != address(0)) {
            IERC20(tokenIn).approve(router, 0);
            IERC20(tokenIn).approve(router, amountIn);
        }

        (bool ok,) = router.call{ value: tokenIn == address(0) ? amountIn : 0 }(data);
        require(ok, "router-call-failed");
        emit TradeExecuted(router, tokenIn, tokenOut, amountIn, minAmountOut);
    }

    function setTrader(address nextTrader) external onlyOwner {
        if (nextTrader == address(0)) revert InvalidAddress();
        emit TraderChanged(trader, nextTrader);
        trader = nextTrader;
    }

    function setOwner(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidAddress();
        emit OwnerChanged(owner, nextOwner);
        owner = nextOwner;
    }

    function setFeeRecipient(address nextFeeRecipient) external onlyOwner {
        if (nextFeeRecipient == address(0)) revert InvalidAddress();
        emit FeeRecipientChanged(feeRecipient, nextFeeRecipient);
        feeRecipient = nextFeeRecipient;
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedToken[token] = allowed;
        emit AllowedTokenUpdated(token, allowed);
    }

    function setAllowedRouter(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert InvalidAddress();
        allowedRouter[router] = allowed;
        emit AllowedRouterUpdated(router, allowed);
    }

    function setWithdrawalWhitelist(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        withdrawalWhitelist[account] = allowed;
        emit WithdrawalWhitelistUpdated(account, allowed);
    }

    function setRiskLimits(uint256 nextMaxTradeUsd, uint256 nextDailyTradeUsd, uint256 nextDailyLossLimitBps)
        external
        onlyOwner
    {
        maxTradeUsd = nextMaxTradeUsd;
        dailyTradeUsd = nextDailyTradeUsd;
        dailyLossLimitBps = nextDailyLossLimitBps;
        emit RiskLimitsUpdated(nextMaxTradeUsd, nextDailyTradeUsd, nextDailyLossLimitBps);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function _sendNative(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{ value: amount }("");
        if (!ok) revert NativeTransferFailed();
    }
}
