// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ROSCA.sol";

contract ROSCAFactory is Ownable {
    using Clones for address;

    address public immutable implementation;
    address[] public allGroups;
    mapping(address => address[]) public groupsByCreator;

    event GroupCreated(address indexed group, address indexed creator);

    constructor(address _implementation) Ownable(msg.sender) {
        require(_implementation != address(0), "impl = 0");
        implementation = _implementation;
    }

    /*──────────────────────────
      External API
    ──────────────────────────*/
    /**
     * @param _amount   Contribution per round (wei)
     * @param _interval Min seconds between payouts
    * @param _maxMembers Maximum number of members in the group
    */
    function createGroup(
        uint256 _amount,
        uint256 _interval,
        uint256 _maxMembers,     // instead of _members[]
        bool    _useCollateral
    ) external returns (address group) {
        group = implementation.clone();
        ROSCA(payable(group)).initialize(_amount, _interval, _maxMembers, _useCollateral);

        // 3. Book-keeping
        allGroups.push(group);
        groupsByCreator[msg.sender].push(group);

        emit GroupCreated(group, msg.sender);
    }

    /* View helpers */
    function allGroupsLength() external view returns (uint256) {
        return allGroups.length;
    }

    function groupsOf(address creator) external view returns (address[] memory) {
        return groupsByCreator[creator];
    }
}
