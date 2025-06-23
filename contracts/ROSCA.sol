// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title ROSCA
 * @notice Upgradeable smart‑contract implementing a rotating savings and credit
 *         association.  Members contribute a fixed `contributionAmount` every
 *         cycle; once all have paid and `interval` seconds have passed, the
 *         entire pot is sent to the next recipient in `participants` order.
 */
contract ROSCA is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    /*//////////////////////////////////////////////////////////////
                             IMMUTABLE PARAMS
    //////////////////////////////////////////////////////////////*/
    uint256 public contributionAmount;   // fixed per‑round payment (wei)
    uint256 public interval;             // min seconds between payouts
    address[] public participants;       // payout order (static after start)

    /*//////////////////////////////////////////////////////////////
                                STATE
    //////////////////////////////////////////////////////////////*/
    uint256 public currentCycle;         // increments after every payout
    uint256 public nextPayoutTime;       // earliest ts when payout allowed

    // cycle  ⇒ (participant  ⇒ contributed?)
    mapping(uint256 => mapping(address => bool)) public hasContributed;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event Contributed(address indexed participant, uint256 indexed cycle, uint256 amount);
    event Payout(address indexed recipient, uint256 indexed cycle, uint256 amount);
    event ParticipantAdded(address indexed newParticipant);
    event CycleAdvanced(uint256 newCycle);

    /*//////////////////////////////////////////////////////////////
                           INITIALISATION / UPGRADE
    //////////////////////////////////////////////////////////////*/
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /// @notice Proxy initialiser (instead of constructor)
    function initialize(
        uint256 _amount,
        uint256 _interval,
        address[] calldata _members
    ) external initializer {
        require(_members.length > 1, "Need >= 2 participants");

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        contributionAmount = _amount;
        interval           = _interval;
        participants       = _members;
        currentCycle       = 0;
        nextPayoutTime     = block.timestamp + _interval;
    }

    /// @dev Authorises UUPS upgrades – owner only
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*//////////////////////////////////////////////////////////////
                               PARTICIPATION
    //////////////////////////////////////////////////////////////*/
    /// @notice Contribute for the current cycle (pay exactly `contributionAmount`)
    function contribute() external payable {
        require(isParticipant(msg.sender), "Not in group");
        require(msg.value == contributionAmount, "Wrong amount");
        require(!hasContributed[currentCycle][msg.sender], "Already paid");

        hasContributed[currentCycle][msg.sender] = true;
        emit Contributed(msg.sender, currentCycle, msg.value);

        if (allContributed() && block.timestamp >= nextPayoutTime) {
            _payout();
        }
    }

    /// @dev Internal payout + state advance; re‑entrancy protected by solidity 0.8 checks
    function _payout() internal {
        address recipient = participants[currentCycle % participants.length];
        uint256 pot       = address(this).balance;
        (bool ok, ) = recipient.call{value: pot}("");
        require(ok, "Transfer failed");

        emit Payout(recipient, currentCycle, pot);

        currentCycle  += 1;
        nextPayoutTime = block.timestamp + interval;
        emit CycleAdvanced(currentCycle);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/
    function isParticipant(address a) public view returns (bool) {
        for (uint256 i = 0; i < participants.length; ++i) if (participants[i] == a) return true;
        return false;
    }

    function allContributed() public view returns (bool) {
        for (uint256 i = 0; i < participants.length; ++i) {
            if (!hasContributed[currentCycle][participants[i]]) return false;
        }
        return true;
    }

    /*//////////////////////////////////////////////////////////////
                                ADMIN
    //////////////////////////////////////////////////////////////*/
    /// @notice Add a participant *before* the first round starts
    function addParticipant(address newP) external onlyOwner {
        require(currentCycle == 0, "Already running");
        require(!isParticipant(newP), "Duplicate");
        participants.push(newP);
        emit ParticipantAdded(newP);
    }

    /// @notice Emergency withdrawal (e.g. stuck funds) – group should multi‑sig owner in prod
    function emergencyWithdraw(address to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }

    /*//////////////////////////////////////////////////////////////
                             FALLBACK GUARDS
    //////////////////////////////////////////////////////////////*/
    receive() external payable { revert("Use contribute()"); }
    fallback() external payable { revert("Bad call"); }
}