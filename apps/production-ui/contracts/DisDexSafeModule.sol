// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISafe {
    function execTransactionFromModule(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        returns (bool success);
}

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title DisDexSafeModule
/// @notice Safe を資産保管本体として使いながら、VPS bot には trade の最小権限だけを与えるための
///         MVP モジュール。出金は owner(Ledger) 署名がないと通らず、宛先はホワイトリストに限定する。
contract DisDexSafeModule {
    error NotOwner();
    error NotTrader();
    error NotGuardian();
    error ContractPaused();
    error InvalidSafe();
    error InvalidAddress();
    error NotWhitelisted();
    error WhitelistTimelockPending();
    error WhitelistTimelockNotReady();
    error RouterNotAllowed();
    error TokenNotAllowed();
    error SelectorNotAllowed();
    error TradeLimitExceeded();
    error DailyLimitExceeded();
    error SlippageTooHigh();
    error SignatureExpired();
    error InvalidSignature();
    error NonceUsed();
    error SafeExecutionFailed();
    error NotPaused();

    event WithdrawExecuted(address indexed token, address indexed to, uint256 amount, uint256 nonce);
    event WithdrawalWhitelistScheduled(address indexed target, bool allowed, uint256 eta);
    event WithdrawalWhitelistUpdated(address indexed target, bool allowed);
    event TraderUpdated(address indexed trader, bool allowed);
    event GuardianUpdated(address indexed guardian, bool allowed);
    event RouterUpdated(address indexed router, bool allowed);
    event TokenUpdated(address indexed token, bool allowed);
    event SelectorUpdated(bytes4 indexed selector, bool allowed);
    event PerTradeLimitUpdated(address indexed token, uint256 amount);
    event DailyLimitUpdated(address indexed token, uint256 amount);
    event DailyUsageConsumed(address indexed token, uint256 amount, uint256 dayIndex, uint256 used);
    event SlippageUpdated(uint256 bps);
    event WhitelistTimelockUpdated(uint256 previousSeconds, uint256 nextSeconds);
    event EmergencyWithdrawExecuted(address indexed token, address indexed to, uint256 amount, address indexed by);
    event TradeExecuted(
        address indexed router,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes4 selector
    );
    event RouterAllowanceUpdated(address indexed token, address indexed router, uint256 amount);
    event Paused(address indexed by, string reason);
    event Unpaused(address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    uint8 internal constant OPERATION_CALL = 0;

    ISafe public immutable safe;
    address public owner;
    address public trader;
    address public guardian;

    bool public paused;
    uint256 public whitelistTimelockSeconds = 24 hours;
    uint256 public maxSlippageBps = 35;
    uint256 public withdrawNonce;

    mapping(address => bool) public whitelist;
    mapping(address => uint256) public whitelistEta;
    mapping(address => bool) public whitelistTargetState;

    mapping(address => bool) public allowedRouters;
    mapping(address => bool) public allowedTokens;
    mapping(bytes4 => bool) public allowedSelectors;

    mapping(address => uint256) public perTradeLimit;
    mapping(address => uint256) public dailyLimit;
    mapping(address => uint256) public dailyUsage;
    mapping(address => uint256) public dailyUsageDay;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyTrader() {
        if (msg.sender != trader) revert NotTrader();
        _;
    }

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner) revert NotGuardian();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier whenPaused() {
        if (!paused) revert NotPaused();
        _;
    }

    constructor(address safe_, address owner_, address trader_, address guardian_) {
        if (safe_ == address(0) || owner_ == address(0) || trader_ == address(0)) revert InvalidAddress();
        safe = ISafe(safe_);
        owner = owner_;
        trader = trader_;
        guardian = guardian_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setTrader(address nextTrader, bool allowed) external onlyOwner {
        if (nextTrader == address(0)) revert InvalidAddress();
        trader = allowed ? nextTrader : address(0);
        emit TraderUpdated(nextTrader, allowed);
    }

    function setGuardian(address nextGuardian, bool allowed) external onlyOwner {
        if (nextGuardian == address(0)) revert InvalidAddress();
        guardian = allowed ? nextGuardian : address(0);
        emit GuardianUpdated(nextGuardian, allowed);
    }

    function setAllowedRouter(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert InvalidAddress();
        allowedRouters[router] = allowed;
        emit RouterUpdated(router, allowed);
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        allowedTokens[token] = allowed;
        emit TokenUpdated(token, allowed);
    }

    function setFunctionSelector(bytes4 selector, bool allowed) external onlyOwner {
        allowedSelectors[selector] = allowed;
        emit SelectorUpdated(selector, allowed);
    }

    function setPerTradeLimit(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        perTradeLimit[token] = amount;
        emit PerTradeLimitUpdated(token, amount);
    }

    function setDailyLimit(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        dailyLimit[token] = amount;
        emit DailyLimitUpdated(token, amount);
    }

    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        require(bps <= 2_000, "slippage too wide");
        maxSlippageBps = bps;
        emit SlippageUpdated(bps);
    }

    function setWhitelistTimelockSeconds(uint256 nextSeconds) external onlyOwner {
        require(nextSeconds <= 7 days, "timelock too long");
        uint256 previousSeconds = whitelistTimelockSeconds;
        whitelistTimelockSeconds = nextSeconds;
        emit WhitelistTimelockUpdated(previousSeconds, nextSeconds);
    }

    function pause(string calldata reason) external onlyGuardianOrOwner {
        paused = true;
        emit Paused(msg.sender, reason);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner whenPaused {
        if (to == address(0)) revert InvalidAddress();
        if (!whitelist[to]) revert NotWhitelisted();

        bool ok;
        if (token == address(0)) {
            ok = safe.execTransactionFromModule(to, amount, "", OPERATION_CALL);
        } else {
            bytes memory data = abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount);
            ok = safe.execTransactionFromModule(token, 0, data, OPERATION_CALL);
        }
        if (!ok) revert SafeExecutionFailed();

        emit EmergencyWithdrawExecuted(token, to, amount, msg.sender);
    }

    function scheduleWhitelistAdd(address to, uint256 eta) external onlyOwner {
        _scheduleWhitelistChange(to, true, eta);
    }

    function scheduleWhitelistRemoval(address to, uint256 eta) external onlyOwner {
        _scheduleWhitelistChange(to, false, eta);
    }

    function addWhitelist(address to) external onlyOwner {
        _applyWhitelistChange(to, true);
    }

    function removeWhitelist(address to) external onlyOwner {
        _applyWhitelistChange(to, false);
    }

    function executeScheduledWhitelistChange(address to) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        uint256 eta = whitelistEta[to];
        if (eta == 0) revert WhitelistTimelockPending();
        if (block.timestamp < eta) revert WhitelistTimelockNotReady();

        bool nextState = whitelistTargetState[to];
        whitelist[to] = nextState;
        delete whitelistEta[to];
        delete whitelistTargetState[to];

        emit WithdrawalWhitelistUpdated(to, nextState);
    }

    function approveRouterToken(address token, address router, uint256 amount) external onlyOwner whenNotPaused {
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (!allowedRouters[router]) revert RouterNotAllowed();

        bytes memory resetData = abi.encodeWithSelector(IERC20Minimal.approve.selector, router, 0);
        bytes memory setData = abi.encodeWithSelector(IERC20Minimal.approve.selector, router, amount);

        bool resetOk = safe.execTransactionFromModule(token, 0, resetData, OPERATION_CALL);
        bool setOk = safe.execTransactionFromModule(token, 0, setData, OPERATION_CALL);
        if (!resetOk || !setOk) revert SafeExecutionFailed();

        emit RouterAllowanceUpdated(token, router, amount);
    }

    function withdraw(address token, address to, uint256 amount, uint256 deadline, bytes calldata ownerSig)
        external
        whenNotPaused
    {
        if (amount == 0) revert InvalidAddress();
        if (!whitelist[to]) revert NotWhitelisted();
        if (block.timestamp > deadline) revert SignatureExpired();

        uint256 currentNonce = withdrawNonce;
        bytes32 digest = getWithdrawDigest(token, to, amount, currentNonce, deadline);
        if (_recoverSigner(digest, ownerSig) != owner) revert InvalidSignature();

        withdrawNonce = currentNonce + 1;

        bool ok;
        if (token == address(0)) {
            ok = safe.execTransactionFromModule(to, amount, "", OPERATION_CALL);
        } else {
            bytes memory data = abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount);
            ok = safe.execTransactionFromModule(token, 0, data, OPERATION_CALL);
        }
        if (!ok) revert SafeExecutionFailed();

        emit WithdrawExecuted(token, to, amount, currentNonce);
    }

    /// @notice expectedAmountOut は bot が参照した見積値。minAmountOut がこれを下回りすぎる場合は reject する。
    function trade(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 expectedAmountOut,
        bytes calldata data
    ) external onlyTrader whenNotPaused {
        if (amountIn == 0) revert TradeLimitExceeded();
        if (!allowedRouters[router]) revert RouterNotAllowed();
        if (!allowedTokens[tokenIn] || !allowedTokens[tokenOut]) revert TokenNotAllowed();

        bytes4 selector = _selector(data);
        if (!allowedSelectors[selector]) revert SelectorNotAllowed();

        uint256 singleLimit = perTradeLimit[tokenIn];
        if (singleLimit != 0 && amountIn > singleLimit) revert TradeLimitExceeded();

        _consumeDailyUsage(tokenIn, amountIn);

        if (expectedAmountOut != 0) {
            uint256 floorAmount = (expectedAmountOut * (10_000 - maxSlippageBps)) / 10_000;
            if (minAmountOut < floorAmount) revert SlippageTooHigh();
        }

        bool ok = safe.execTransactionFromModule(router, 0, data, OPERATION_CALL);
        if (!ok) revert SafeExecutionFailed();

        emit TradeExecuted(router, tokenIn, tokenOut, amountIn, minAmountOut, selector);
    }

    function getWithdrawDigest(address token, address to, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 payloadHash = keccak256(
            abi.encodePacked(
                "DisDexWithdraw",
                block.chainid,
                address(safe),
                token,
                to,
                amount,
                nonce,
                deadline,
                address(this)
            )
        );
        return _toEthSignedMessageHash(payloadHash);
    }

    function _scheduleWhitelistChange(address to, bool allowed, uint256 eta) internal {
        if (to == address(0)) revert InvalidAddress();
        require(eta >= block.timestamp + whitelistTimelockSeconds, "eta too early");
        whitelistEta[to] = eta;
        whitelistTargetState[to] = allowed;
        emit WithdrawalWhitelistScheduled(to, allowed, eta);
    }

    function _applyWhitelistChange(address to, bool allowed) internal {
        if (to == address(0)) revert InvalidAddress();
        whitelist[to] = allowed;
        delete whitelistEta[to];
        delete whitelistTargetState[to];
        emit WithdrawalWhitelistUpdated(to, allowed);
    }

    function _consumeDailyUsage(address token, uint256 amount) internal {
        uint256 today = block.timestamp / 1 days;
        if (dailyUsageDay[token] != today) {
            dailyUsageDay[token] = today;
            dailyUsage[token] = 0;
        }

        uint256 nextUsage = dailyUsage[token] + amount;
        uint256 limit = dailyLimit[token];
        if (limit != 0 && nextUsage > limit) revert DailyLimitExceeded();

        dailyUsage[token] = nextUsage;
        emit DailyUsageConsumed(token, amount, today, nextUsage);
    }

    function _selector(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) revert SelectorNotAllowed();
        assembly {
            selector := calldataload(data.offset)
        }
    }

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
