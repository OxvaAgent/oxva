// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Test helper: a minimal ERC-20. `quiet` makes transfer return nothing, like some old tokens.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    bool public quiet;

    constructor(bool quiet_) { quiet = quiet_; }

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        if (quiet) assembly { return(0, 0) }
        return true;
    }

    function approve(address, uint256) external pure returns (bool) { return true; }
}
