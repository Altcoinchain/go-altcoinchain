// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title XeggeXGovernance
 * @dev Controls whether the XeggeX wallet address can transact on Altcoinchain.
 *
 * The Altcoinchain node checks this contract to determine if an address is unblocked.
 * If isUnblocked(address) returns true, the address can send transactions.
 *
 * Storage layout: mapping(address => bool) at slot 0
 * The node reads: keccak256(abi.encode(address, 0)) to check if unblocked
 */
contract XeggeXGovernance {
    // Owner who can unblock addresses
    address public owner;

    // Mapping of unblocked addresses (slot 0)
    mapping(address => bool) public unblocked;

    // XeggeX wallet address
    address public constant XEGGEX_WALLET = 0x5CcCcb6d334197c7C4ba94E7873d0ef11381CD4e;

    // Events
    event AddressUnblocked(address indexed addr, uint256 timestamp);
    event AddressBlocked(address indexed addr, uint256 timestamp);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Check if an address is unblocked (can transact)
     * @param addr The address to check
     * @return True if the address is unblocked and can transact
     */
    function isUnblocked(address addr) external view returns (bool) {
        return unblocked[addr];
    }

    /**
     * @dev Unblock the XeggeX wallet - allows it to send transactions
     * Call this when XeggeX enables withdrawals
     */
    function unblockXeggeX() external onlyOwner {
        unblocked[XEGGEX_WALLET] = true;
        emit AddressUnblocked(XEGGEX_WALLET, block.timestamp);
    }

    /**
     * @dev Block the XeggeX wallet again if needed
     */
    function blockXeggeX() external onlyOwner {
        unblocked[XEGGEX_WALLET] = false;
        emit AddressBlocked(XEGGEX_WALLET, block.timestamp);
    }

    /**
     * @dev Unblock any address (for future use)
     * @param addr The address to unblock
     */
    function unblockAddress(address addr) external onlyOwner {
        unblocked[addr] = true;
        emit AddressUnblocked(addr, block.timestamp);
    }

    /**
     * @dev Block any address
     * @param addr The address to block
     */
    function blockAddress(address addr) external onlyOwner {
        unblocked[addr] = false;
        emit AddressBlocked(addr, block.timestamp);
    }

    /**
     * @dev Transfer ownership to a new address
     * @param newOwner The address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @dev Check if XeggeX is currently unblocked
     * @return True if XeggeX wallet can transact
     */
    function isXeggeXUnblocked() external view returns (bool) {
        return unblocked[XEGGEX_WALLET];
    }
}
