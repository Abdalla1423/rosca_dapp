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
    address[] public participants;     // unchanged
    uint256  public maxParticipants;   // NEW
    bool     public started;           // NEW – false until roster full
    bool public collateralEnabled;   // true → each member deposits payout-sized bond

    struct MemberInfo {
        uint256 collateralRemaining;
        bool    expelled;
    }
    mapping(address => MemberInfo) public memberInfo;

    uint256 public payoutSize;            // fixed pot size == contribution * maxParticipants
    uint256 public collateralRequirement; // == payoutSize

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
    event CollateralUsed(address indexed debtor, uint256 indexed cycle, uint256 amount);
    event CollateralRefunded(address indexed member, uint256 amount);


    /*//////////////////////////////////////////////////////////////
                           INITIALISATION / UPGRADE
    //////////////////////////////////////////////////////////////*/
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /// @notice Proxy initialiser (instead of constructor)
    function initialize(
        uint256 _contribution,
        uint256 _interval,
        uint256 _maxParticipants,
        bool _useCollateral
    ) external initializer {
        require(_maxParticipants > 1, "Need >= 2 participants");

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        contributionAmount      = _contribution;
        payoutSize              = _contribution * _maxParticipants;

        interval           = _interval;
        maxParticipants    = _maxParticipants;
        started            = false;               // NEW
        currentCycle       = 0;
        nextPayoutTime     = 0;                   // will be set on start
        collateralEnabled     = _useCollateral;
        collateralRequirement = _useCollateral ? payoutSize : 0;


    }

    /// @dev Authorises UUPS upgrades – owner only
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*//////////////////////////////////////////////////////////////
                               PARTICIPATION
    //////////////////////////////////////////////////////////////*/

    event ParticipantJoined(address indexed who, uint256 indexed index);
    event GroupStarted(uint256 startTime);
    /// @notice Join the group (if not full) – can be called by anyone
    function join() external payable {
        require(!started,                 "ROSCA: already started");
        require(!isParticipant(msg.sender), "ROSCA: already joined");
        require(participants.length < maxParticipants, "ROSCA: full");

        if (collateralEnabled) {
            require(msg.value >= collateralRequirement, "ROSCA: collateral required");
            memberInfo[msg.sender] = MemberInfo(msg.value, false);
        } else {
            require(msg.value == 0, "ROSCA: no collateral");
        }

        participants.push(msg.sender);
        emit ParticipantJoined(msg.sender, participants.length - 1);

        if (participants.length == maxParticipants) {
            started         = true;
            nextPayoutTime  = block.timestamp + interval;
            emit GroupStarted(block.timestamp);
        }
    }

    /// @notice Contribute for the current cycle (pay exactly `contributionAmount`)
    function contribute() external payable {
        require(started, "ROSCA: not started");
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

    function triggerPayout() external {
        require(started, "ROSCA: not started");
        require(block.timestamp >= nextPayoutTime, "ROSCA: interval not elapsed");

        // 1️⃣ cover / expel any missing contributors
        for (uint i = 0; i < participants.length; ++i) {
            address p = participants[i];

            // only act if not contributed yet for this cycle
            if (!hasContributed[currentCycle][p]) {

                if (collateralEnabled) {
                    // if collateral is enabled, use it to cover the missing contribution
                    if (!memberInfo[p].expelled) memberInfo[p].expelled = true;
                    uint256 share = contributionAmount;
                    memberInfo[p].collateralRemaining -= share;   // will revert if impossible
                    hasContributed[currentCycle][p] = true;       // mark as paid this round
                    emit CollateralUsed(p, currentCycle, share);
                } else {
                    require(allContributed(), "ROSCA: contributions missing");
                }
                
            }
        }
        require(allContributed(), "still missing");

        // 2️⃣ pay scheduled recipient (even if expelled)
        address recipient = participants[currentCycle % participants.length];
        uint256 pot       = contributionAmount * participants.length;
        (bool ok, ) = recipient.call{value: pot}("");
        require(ok, "pot transfer failed");
        emit Payout(recipient, currentCycle, pot);

        // 3️⃣ advance state
        currentCycle  += 1;
        nextPayoutTime = block.timestamp + interval;
        emit CycleAdvanced(currentCycle);
    }

    function withdrawCollateral() external {
        require(collateralEnabled, "ROSCA: collateral off");
        require(currentCycle >= participants.length, "Rounds ongoing");
        uint256 amt = memberInfo[msg.sender].collateralRemaining;
        require(amt > 0, "Nothing to withdraw");
        memberInfo[msg.sender].collateralRemaining = 0;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "refund failed");
        emit CollateralRefunded(msg.sender, amt);
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
    
    function getParticipants() public view returns (address[] memory) {
    return participants;
}

}
