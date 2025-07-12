// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IROSCAInit {
    function initialize(
        uint256, uint256, uint256, bool, address
    ) external;
}
/*
 *  ┌────────────────────────────────────────────────────────────┐
 *  │  Rotating Savings & Credit Association (ROSCA) Factory     │
 *  └────────────────────────────────────────────────────────────┘
 *  Factory contract to deploy new ROSCA groups.
 *  ─────────────────────────────────────────────────────────────
 *  • Clones the ROSCA implementation for each new group.
 *  • Allows setting a new implementation for future groups.
 */
contract ROSCAFactory is Ownable {
    using Clones for address;

    /* ─────────────────────────────────────────
       STORAGE
    ───────────────────────────────────────── */
    /// Current implementation that new groups will clone
    address public implementation;

    /// List of every group ever created
    address[] public allGroups;

    /// Creator ⇒ their groups
    mapping(address => address[]) public groupsByCreator;

    /* ─────────────────────────────────────────
       EVENTS
    ───────────────────────────────────────── */
    event GroupCreated(address indexed group, address indexed creator);
    event ImplementationUpdated(address indexed oldImpl, address indexed newImpl);

    /* ─────────────────────────────────────────
       CONSTRUCTOR
    ───────────────────────────────────────── */
    constructor(address _implementation) Ownable(msg.sender) {
        require(_implementation != address(0), "impl = 0");
        implementation = _implementation;
    }

    /* ─────────────────────────────────────────
       ADMIN – update logic for **future** groups
    ───────────────────────────────────────── */
    /// @notice Change the template all *new* groups will clone.
    ///         Has no effect on groups that already exist.
    function setImplementation(address _newImpl) external onlyOwner {
        require(_newImpl != address(0), "impl = 0");
        address old = implementation;
        implementation = _newImpl;
        emit ImplementationUpdated(old, _newImpl);
    }

    /* ─────────────────────────────────────────
       EXTERNAL API
    ───────────────────────────────────────── */
    /**
     * @param _amount      Contribution per round (wei)
     * @param _interval    Minimum seconds between payouts
     * @param _maxMembers  Maximum number of members in the group
     * @param _useCollateral Whether collateral is enforced
     */
    function createGroup(
        uint256 _amount,
        uint256 _interval,
        uint256 _maxMembers,
        bool    _useCollateral,
        address _multisig
    ) external returns (address group) {
        // 1. Clone the current implementation
        group = implementation.clone();

        // 2. Initialise proxy state
        IROSCAInit(payable(group)).initialize(
            _amount,
            _interval,
            _maxMembers,
            _useCollateral,
            _multisig
        );

        // 3. Book-keeping
        allGroups.push(group);
        groupsByCreator[msg.sender].push(group);

        emit GroupCreated(group, msg.sender);
    }

    /* ─────────────────────────────────────────
       VIEW HELPERS
    ───────────────────────────────────────── */
    function allGroupsLength() external view returns (uint256) {
        return allGroups.length;
    }

    function groupsOf(address creator) external view returns (address[] memory) {
        return groupsByCreator[creator];
    }

    function getAllGroups() external view returns (address[] memory) {
        return allGroups;
    }
}
