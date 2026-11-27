// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title OxvaVault
/// @notice A wallet an AI agent can spend from, only inside rules its owner sets.
///         The agent proposes; the vault checks the policy before anything is sent:
///         allowed (sent at once), held (waits for the owner), or reverted (never sent).
/// @dev    BETA. This contract has NOT been audited. Anyone using it accepts that a bug could lose funds.
///         Budgets and caps apply to the native coin (ETH) a call sends. Because token amounts are not
///         budgeted, the agent may never call token-moving functions (transfer, approve, permit, NFT
///         transfers); only the owner can move tokens out, with withdrawToken.
contract OxvaVault {
    string public constant VERSION = "OxvaVault 1.1.0-beta (unaudited)";

    enum Status { None, Pending, Executed, Rejected }

    struct Proposal {
        address to;
        uint256 value;
        bytes data;
        uint64 createdAt;
        Status status;
    }

    address public immutable owner;
    address public agent;
    bool public paused;

    uint256 public hourlyBudget;   // wei the agent may send per hour without approval
    uint256 public perTxCap;       // wei per single call, even with approval
    uint256 public approvalAbove;  // wei above which the owner must approve

    uint256 public windowStart;    // start of the current one-hour budget window
    uint256 public spentInWindow;  // wei sent in the current window

    mapping(address => bool) public allowed;
    Proposal[] private _proposals;

    uint256 private _lock = 1;


    // reasons a proposal is held
    uint8 public constant HOLD_APPROVAL = 1;
    uint8 public constant HOLD_BUDGET = 2;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed to, uint256 amount);
    event PolicySet(uint256 hourlyBudget, uint256 perTxCap, uint256 approvalAbove);
    event TargetSet(address indexed target, bool allowed);
    event AgentSet(address indexed agent);
    event PausedSet(bool paused);
    event Proposed(uint256 indexed id, address indexed to, uint256 value, bytes4 selector);
    event Held(uint256 indexed id, uint8 reason);
    event Executed(uint256 indexed id, address indexed to, uint256 value, bool byOwner);
    event Rejected(uint256 indexed id);

    error NotOwner();
    error NotAgent();
    error IsPaused();
    error TargetNotAllowed(address target);
    error OverCap(uint256 value, uint256 cap);
    error TokenCallBlocked(bytes4 selector);
    error NotPending(uint256 id);
    error CallFailed(bytes reason);
    error Reentrant();
    error TransferFailed();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyAgent() { if (msg.sender != agent) revert NotAgent(); _; }
    modifier nonReentrant() { if (_lock != 1) revert Reentrant(); _lock = 2; _; _lock = 1; }

    constructor(address agent_, uint256 hourlyBudget_, uint256 perTxCap_, uint256 approvalAbove_, address[] memory targets) payable {
        owner = msg.sender;
        agent = agent_;
        hourlyBudget = hourlyBudget_;
        perTxCap = perTxCap_;
        approvalAbove = approvalAbove_;
        windowStart = block.timestamp;
        for (uint256 i = 0; i < targets.length; i++) {
            allowed[targets[i]] = true;
            emit TargetSet(targets[i], true);
        }
        emit AgentSet(agent_);
        emit PolicySet(hourlyBudget_, perTxCap_, approvalAbove_);
        if (msg.value > 0) emit Deposited(msg.sender, msg.value);
    }

    receive() external payable { emit Deposited(msg.sender, msg.value); }

    // ---------------------------------------------------------------- agent

    /// @notice The agent proposes a call. Returns the proposal id.
    ///         Reverts when a rule is broken; nothing is stored or sent then.
    function propose(address to, uint256 value, bytes calldata data) external onlyAgent nonReentrant returns (uint256 id) {
        _check(to, value, data);
        _roll();

        id = _proposals.length;
        _proposals.push(Proposal({ to: to, value: value, data: data, createdAt: uint64(block.timestamp), status: Status.Pending }));
        emit Proposed(id, to, value, _selector(data));

        if (value > approvalAbove) { emit Held(id, HOLD_APPROVAL); return id; }
        if (spentInWindow + value > hourlyBudget) { emit Held(id, HOLD_BUDGET); return id; }

        spentInWindow += value;
        _execute(id, false);
    }

    // ---------------------------------------------------------------- owner

    /// @notice The owner confirms a held proposal. The policy is checked again (it may have changed).
    function approve(uint256 id) external onlyOwner nonReentrant {
        Proposal storage p = _proposals[id];
        if (p.status != Status.Pending) revert NotPending(id);
        _check(p.to, p.value, p.data);
        _roll();
        spentInWindow += p.value;
        _execute(id, true);
    }

    function reject(uint256 id) external onlyOwner {
        Proposal storage p = _proposals[id];
        if (p.status != Status.Pending) revert NotPending(id);
        p.status = Status.Rejected;
        emit Rejected(id);
    }

    function setPolicy(uint256 hourlyBudget_, uint256 perTxCap_, uint256 approvalAbove_) external onlyOwner {
        hourlyBudget = hourlyBudget_;
        perTxCap = perTxCap_;
        approvalAbove = approvalAbove_;
        emit PolicySet(hourlyBudget_, perTxCap_, approvalAbove_);
    }

    function setTarget(address target, bool ok) external onlyOwner {
        allowed[target] = ok;
        emit TargetSet(target, ok);
    }

    function setAgent(address agent_) external onlyOwner {
        agent = agent_;
        emit AgentSet(agent_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice The owner can always take funds out, paused or not.
    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    /// @notice The owner can take out any ERC-20 token the vault holds (for example, the output of a swap).
    ///         Works with tokens that return nothing from transfer as well as ones that return a bool.
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token.code.length == 0) revert TransferFailed(); // not a token contract
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (ret.length > 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        emit TokenWithdrawn(token, to, amount);
    }

    // ---------------------------------------------------------------- views

    function proposalCount() external view returns (uint256) { return _proposals.length; }

    function getProposal(uint256 id) external view returns (address to, uint256 value, bytes memory data, uint64 createdAt, Status status) {
        Proposal storage p = _proposals[id];
        return (p.to, p.value, p.data, p.createdAt, p.status);
    }

    /// @notice What the budget allows right now, counting the window reset.
    function remainingBudget() external view returns (uint256) {
        uint256 spent = block.timestamp >= windowStart + 1 hours ? 0 : spentInWindow;
        return spent >= hourlyBudget ? 0 : hourlyBudget - spent;
    }

    // ---------------------------------------------------------------- internal

    function _check(address to, uint256 value, bytes memory data) private view {
        if (paused) revert IsPaused();
        if (!allowed[to]) revert TargetNotAllowed(to);
        if (value > perTxCap) revert OverCap(value, perTxCap);
        bytes4 s = _selector(data);
        if (_movesTokens(s)) revert TokenCallBlocked(s);
    }

    /// @dev Token and NFT functions the agent may never call: their amounts are not covered by the ETH budget.
    function _movesTokens(bytes4 s) private pure returns (bool) {
        return s == 0xa9059cbb  // transfer(address,uint256)
            || s == 0x23b872dd  // transferFrom(address,address,uint256)
            || s == 0x095ea7b3  // approve(address,uint256)
            || s == 0x39509351  // increaseAllowance(address,uint256)
            || s == 0xa22cb465  // setApprovalForAll(address,bool)
            || s == 0x42842e0e  // safeTransferFrom(address,address,uint256)
            || s == 0xb88d4fde  // safeTransferFrom(address,address,uint256,bytes)
            || s == 0xf242432a  // safeTransferFrom(address,address,uint256,uint256,bytes) ERC-1155
            || s == 0x2eb2c2d6  // safeBatchTransferFrom(...) ERC-1155
            || s == 0xd505accf; // permit(...) EIP-2612
    }

    function _roll() private {
        if (block.timestamp >= windowStart + 1 hours) {
            windowStart = block.timestamp;
            spentInWindow = 0;
        }
    }

    function _execute(uint256 id, bool byOwner) private {
        Proposal storage p = _proposals[id];
        p.status = Status.Executed;
        (bool ok, bytes memory ret) = p.to.call{ value: p.value }(p.data);
        if (!ok) revert CallFailed(ret);
        emit Executed(id, p.to, p.value, byOwner);
    }

    function _selector(bytes memory data) private pure returns (bytes4 s) {
        if (data.length < 4) return bytes4(0);
        assembly { s := mload(add(data, 32)) }
    }
}
