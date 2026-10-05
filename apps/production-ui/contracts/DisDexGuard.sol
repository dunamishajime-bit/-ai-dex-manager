// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DisDexGuard
/// @notice Optional helper contract documenting how trader calls could be filtered further.
/// @dev The current implementation is intentionally lightweight and meant as a future extension point.
contract DisDexGuard {
    mapping(address => bool) public allowedTarget;
    mapping(bytes4 => bool) public allowedSelector;
    address public owner;

    error NotOwner();
    error InvalidAddress();

    event AllowedTargetUpdated(address indexed target, bool allowed);
    event AllowedSelectorUpdated(bytes4 indexed selector, bool allowed);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidAddress();
        owner = owner_;
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert InvalidAddress();
        allowedTarget[target] = allowed;
        emit AllowedTargetUpdated(target, allowed);
    }

    function setAllowedSelector(bytes4 selector, bool allowed) external onlyOwner {
        allowedSelector[selector] = allowed;
        emit AllowedSelectorUpdated(selector, allowed);
    }

    function canCall(address target, bytes4 selector) external view returns (bool) {
        return allowedTarget[target] && allowedSelector[selector];
    }
}
