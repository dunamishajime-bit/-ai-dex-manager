// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DisDexVault.sol";
import "./DisDexVaultRegistry.sol";

contract DisDexVaultFactory {
    error InvalidAddress();
    error NotOwner();
    error OwnerAlreadyHasVault();

    address public owner;
    address public feeRecipient;
    uint256 public defaultFeeBps = 1000;
    uint256 public defaultMaxTradeUsd = 2500e18;
    uint256 public defaultDailyTradeUsd = 10000e18;
    uint256 public defaultDailyLossLimitBps = 250;

    DisDexVaultRegistry public immutable registry;

    event VaultCreated(address indexed owner, address indexed trader, address vault, string label);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed nextRecipient);
    event DefaultsUpdated(uint256 feeBps, uint256 maxTradeUsd, uint256 dailyTradeUsd, uint256 dailyLossLimitBps);
    event OwnerUpdated(address indexed previousOwner, address indexed nextOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address feeRecipient_) {
        if (feeRecipient_ == address(0)) revert InvalidAddress();
        owner = msg.sender;
        feeRecipient = feeRecipient_;
        registry = new DisDexVaultRegistry(address(this));
    }

    function createVault(address owner_, address trader, string calldata label) external returns (address vault) {
        if (owner_ == address(0) || trader == address(0)) revert InvalidAddress();
        if (registry.getVault(owner_) != address(0)) revert OwnerAlreadyHasVault();
        DisDexVault instance = new DisDexVault(
            owner_,
            trader,
            feeRecipient,
            defaultFeeBps,
            defaultMaxTradeUsd,
            defaultDailyTradeUsd,
            defaultDailyLossLimitBps
        );
        vault = address(instance);
        registry.registerVault(owner_, vault);
        registry.setVaultStatus(vault, 1);
        emit VaultCreated(owner_, trader, vault, label);
    }

    function setFeeRecipient(address nextRecipient) external onlyOwner {
        if (nextRecipient == address(0)) revert InvalidAddress();
        emit FeeRecipientUpdated(feeRecipient, nextRecipient);
        feeRecipient = nextRecipient;
    }

    function setDefaults(
        uint256 feeBps_,
        uint256 maxTradeUsd_,
        uint256 dailyTradeUsd_,
        uint256 dailyLossLimitBps_
    ) external onlyOwner {
        defaultFeeBps = feeBps_;
        defaultMaxTradeUsd = maxTradeUsd_;
        defaultDailyTradeUsd = dailyTradeUsd_;
        defaultDailyLossLimitBps = dailyLossLimitBps_;
        emit DefaultsUpdated(feeBps_, maxTradeUsd_, dailyTradeUsd_, dailyLossLimitBps_);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidAddress();
        emit OwnerUpdated(owner, nextOwner);
        owner = nextOwner;
    }
}
