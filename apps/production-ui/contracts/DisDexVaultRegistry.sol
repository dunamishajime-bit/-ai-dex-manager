// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DisDexVaultRegistry {
    error NotFactory();
    error InvalidAddress();
    error OwnerAlreadyHasVault();
    error VaultAlreadyRegistered();

    address public immutable factory;

    mapping(address => address[]) private ownerVaults;
    mapping(address => address) public vaultOwner;
    mapping(address => address) public primaryVaultOfOwner;
    mapping(address => uint8) public vaultStatus;

    event VaultRegistered(address indexed owner, address indexed vault);
    event VaultStatusUpdated(address indexed vault, uint8 status);

    constructor(address factory_) {
        if (factory_ == address(0)) revert InvalidAddress();
        factory = factory_;
    }

    function registerVault(address owner, address vault) external {
        if (msg.sender != factory) revert NotFactory();
        if (owner == address(0) || vault == address(0)) revert InvalidAddress();
        if (vaultOwner[vault] != address(0)) revert VaultAlreadyRegistered();
        if (primaryVaultOfOwner[owner] != address(0)) revert OwnerAlreadyHasVault();
        ownerVaults[owner].push(vault);
        vaultOwner[vault] = owner;
        primaryVaultOfOwner[owner] = vault;
        emit VaultRegistered(owner, vault);
    }

    function setVaultStatus(address vault, uint8 status) external {
        if (msg.sender != factory) revert NotFactory();
        if (vault == address(0)) revert InvalidAddress();
        vaultStatus[vault] = status;
        emit VaultStatusUpdated(vault, status);
    }

    function getVault(address owner) external view returns (address) {
        return primaryVaultOfOwner[owner];
    }

    function getVaults(address owner) external view returns (address[] memory) {
        return ownerVaults[owner];
    }
}
