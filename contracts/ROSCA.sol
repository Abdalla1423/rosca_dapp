// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/*
 *  Rotating Savings & Credit Association (ROSCA) – v2.3
 *  ─────────────────────────────────────────────────────────────
 *  New feature: **Emergency Pause**
 *  • Inherits OpenZeppelin `PausableUpgradeable`.
 *  • Owner (ideally a multisig) can `pause()` and `unpause()`.
 *  • Core state‑changing functions are guarded with `whenNotPaused`.
 *  • `emergencyWithdraw` removed – pause is the new safety lever.
 */

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract ROSCA is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using Address for address payable;

    /* ─────────── CONSTANTS ─────────── */
    uint256 public constant MAX_PARTICIPANTS = 100;

    /* ───────────────────────────────────────── PARAMS ───────────────────────────────────────── */
    uint256 public contributionAmount;
    uint256 public interval;
    address[] public participants;
    uint256  public maxParticipants;
    bool     public started;
    bool     public finished;
    bool     public collateralEnabled;

    struct MemberInfo {
        uint256 collateralRemaining;
        bool    expelled;
    }
    mapping(address => MemberInfo) public memberInfo;

    uint256 public payoutSize;
    uint256 public collateralRequirement;

    /* ───────────────────────────────────────── STATE ───────────────────────────────────────── */
    uint256 public currentCycle;
    uint256 public nextPayoutTime;

    mapping(address => bool) public hasContributed; // bitmap current cycle
    uint256 public contributedCount;
    uint256 public expelledCount; // count of members expelled for non‑payment

    /* ───────────────────────────────────────── EVENTS ───────────────────────────────────────── */
    event Contributed(address indexed participant, uint256 indexed cycle, uint256 amount);
    event Payout(address indexed recipient,   uint256 indexed cycle, uint256 amount);
    event ParticipantJoined(address indexed who, uint256 indexed index);
    event GroupStarted(uint256 startTime);
    event CycleAdvanced(uint256 newCycle);
    event GroupFinished(uint256 finishedAt);
    event CollateralUsed(address indexed debtor, uint256 indexed cycle, uint256 amount);
    event CollateralRefunded(address indexed member, uint256 amount);

    /* ───────────────────────── INTERNAL HELPERS ───────────────────────── */
    function _safeTransfer(address payable to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount, gas: 2_300}("");
        if (!success) {
            (success, ) = to.call{value: amount}("");
            require(success, "ROSCA: transfer failed");
        }
    }

    /* ───────────────────────── INITIALISATION ───────────────────────── */
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 _contribution,
        uint256 _interval,
        uint256 _maxParticipants,
        bool    _useCollateral,
        address _ownerMultisig
    ) external initializer {
        require(_maxParticipants > 1 && _maxParticipants <= MAX_PARTICIPANTS, "participants out of bounds");
        require(_ownerMultisig != address(0), "owner = 0");

        __Ownable_init(_ownerMultisig);
        __ReentrancyGuard_init();
        __Pausable_init();

        contributionAmount  = _contribution;
        interval            = _interval;
        maxParticipants     = _maxParticipants;
        payoutSize          = _contribution * _maxParticipants;

        collateralEnabled      = _useCollateral;
        collateralRequirement  = _useCollateral ? payoutSize : 0;

        started = false;
        finished = false;
        currentCycle = 0;
        nextPayoutTime = 0;
    }

    /* ───────────────────────── PAUSE CONTROL ───────────────────────── */
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /* ─────────────────────────── PARTICIPATION ─────────────────────────── */
    function join() external payable whenNotPaused {
        require(!started,              "ROSCA: already started");
        require(!finished,             "ROSCA: finished");
        require(!isParticipant(msg.sender), "ROSCA: already joined");
        require(participants.length < maxParticipants, "ROSCA: full");

        if (collateralEnabled) {
            require(msg.value == collateralRequirement, "ROSCA: bad collateral");
            memberInfo[msg.sender] = MemberInfo(msg.value, false);
        } else {
            require(msg.value == 0, "ROSCA: collateral off");
        }

        participants.push(msg.sender);
        emit ParticipantJoined(msg.sender, participants.length - 1);

        if (participants.length == maxParticipants) {
            started = true;
            nextPayoutTime = block.timestamp + interval;
            emit GroupStarted(block.timestamp);
        }
    }

    function contribute() external payable whenNotPaused {
        require(started, "ROSCA: not started");
        require(!finished, "ROSCA: finished");
        require(isParticipant(msg.sender), "ROSCA: not in group");
        require(msg.value == contributionAmount, "ROSCA: wrong amount");
        require(!hasContributed[msg.sender], "ROSCA: already paid");

        hasContributed[msg.sender] = true;
        contributedCount += 1;
        emit Contributed(msg.sender, currentCycle, msg.value);
    }

    /* ───────────────────────── CORE PAYOUT ───────────────────────── */
    function triggerPayout() external nonReentrant whenNotPaused {
        require(started, "ROSCA: not started");
        require(!finished, "ROSCA: finished");
        require(block.timestamp >= nextPayoutTime, "ROSCA: interval");

        for (uint256 i = 0; i < participants.length; ++i) {
            address p = participants[i];
            if (!hasContributed[p]) {
                if (collateralEnabled) {
                    if (!memberInfo[p].expelled) {
                        memberInfo[p].expelled = true;
                        expelledCount += 1;
                    }
                    require(memberInfo[p].collateralRemaining >= contributionAmount, "ROSCA: collateral empty");
                    memberInfo[p].collateralRemaining -= contributionAmount;
                    
                    emit CollateralUsed(p, currentCycle, contributionAmount);
                } else {
                    revert("ROSCA: unpaid member");
                }
            }
            // reset bitmap for next cycle
            hasContributed[p] = false;
        }

        // verify total paid (counter + collateral path == participants)
        require(contributedCount + expelledCount == participants.length, "ROSCA: contributions mismatch");
        contributedCount = 0; // reset counter for next cycle

        address recipient = participants[currentCycle % participants.length];
        uint256 pot       = contributionAmount * participants.length;

        currentCycle += 1;
        if (currentCycle == participants.length) {
            finished = true;
            emit GroupFinished(block.timestamp);
        } else {
            nextPayoutTime = block.timestamp + interval;
            emit CycleAdvanced(currentCycle);
        }

        // 3️⃣ transfer pot
        payable(recipient).sendValue(pot);
        emit Payout(recipient, currentCycle - 1, pot);
    }

    function withdrawCollateral() external nonReentrant whenNotPaused {
        require(collateralEnabled, "ROSCA: collateral off");
        require(finished, "ROSCA: rounds ongoing");

        uint256 amt = memberInfo[msg.sender].collateralRemaining;
        require(amt > 0, "ROSCA: none");

        memberInfo[msg.sender].collateralRemaining = 0;
        payable(msg.sender).sendValue(amt);
        emit CollateralRefunded(msg.sender, amt);
    }

    /* ─────────────────────────── VIEW HELPERS ─────────────────────────── */
    function isParticipant(address a) public view returns (bool) {
        for (uint256 i = 0; i < participants.length; ++i) {
            if (participants[i] == a) return true;
        }
        return false;
    }

    function allContributed() external view returns (bool) {
        return contributedCount == participants.length;
    }

    /* ───────────────────────── FALLBACK GUARDS ───────────────────────── */
    receive() external payable { revert("Use contribute()"); }
    fallback() external payable { revert("Bad call"); }
}
