// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Test helper: something the vault can call.
contract MockTarget {
    uint256 public pings;
    uint256 public received;
    uint256 public lastApproval;

    function ping() external payable { pings++; received += msg.value; }
    function approve(address, uint256 amount) external returns (bool) { lastApproval = amount; return true; }
    function fail() external pure { revert("nope"); }
    receive() external payable { received += msg.value; }
}
