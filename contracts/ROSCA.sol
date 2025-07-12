// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/*
 *  ┌────────────────────────────────────────────────────────────┐
 *  │  Rotating Savings & Credit Association (ROSCA) – v2.1     │
 *  └────────────────────────────────────────────────────────────┘
 *  Incremental fixes
 *  ─────────────────────────────────────────────────────────────
 *  • **D‑1 Unbounded loops**
 *      – Hard‑cap `maxParticipants` at 100 (safe gas on L1).
 *  • **D‑2 Storage bloat**
 *      – Track contributions only for the *current* cycle with
 *        `mapping(address ⇒ bool) hasContributed` **plus** a
 *        `contributedCount` counter, then reset both each round.
 */

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "truffle/console.sol";


contract ROSCA is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using Address for address payable;

    /* ─────────── CONSTANTS ─────────── */
    uint256 public constant MAX_PARTICIPANTS = 100; // D‑1 gas‑safe cap

    /* ───────────────────────────────────────────── IMMUTABLE‑ish PARAMS ─────────────────────────────────────────── */
    uint256 public contributionAmount;   // fixed per‑round payment (wei)
    uint256 public interval;             // min seconds between payouts
    address[] public participants;       // roster (constant after start)
    uint256  public maxParticipants;     // hard cap == #rounds ≤ 100
    bool     public started;             // set true once roster full
    bool     public finished;            // becomes true when all rounds complete
    bool     public collateralEnabled;   // true ⇒ deposit full‑payout bond

    struct MemberInfo {
        uint256 collateralRemaining;
        bool    expelled;
    }
    mapping(address => MemberInfo) public memberInfo;

    uint256 public payoutSize;            // contribution * maxParticipants
    uint256 public collateralRequirement; // == payoutSize when collateral on

    /* ─────────────────────────────────────────────────── STATE ─────────────────────────────────────────────────── */
    uint256 public currentCycle;          // 0‑based index
    uint256 public nextPayoutTime;        // unix ts

    // D‑2: current‑cycle contribution bitmap + counter
    mapping(address => bool) public hasContributed; // participant ⇒ paid?
    uint256 public contributedCount;
    uint256 public expelledCount; // count of members expelled for non‑payment

    /* ─────────────────────────────────────────────────── EVENTS ────────────────────────────────────────────────── */
    event Contributed(address indexed participant, uint256 indexed cycle, uint256 amount);
    event Payout(address indexed recipient,   uint256 indexed cycle, uint256 amount);
    event ParticipantJoined(address indexed who, uint256 indexed index);
    event GroupStarted(uint256 startTime);
    event CycleAdvanced(uint256 newCycle);
    event GroupFinished(uint256 finishedAt);
    event CollateralUsed(address indexed debtor, uint256 indexed cycle, uint256 amount);
    event CollateralRefunded(address indexed member, uint256 amount);

    /* ─────────────────────────── INITIALISATION ─────────────────────────── */
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 _contribution,
        uint256 _interval,
        uint256 _maxParticipants,
        bool    _useCollateral
    ) external initializer {
        require(_maxParticipants > 1 && _maxParticipants <= MAX_PARTICIPANTS, "participants out of bounds");

        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();

        contributionAmount  = _contribution;
        interval            = _interval;
        maxParticipants     = _maxParticipants;
        payoutSize          = _contribution * _maxParticipants;

        started             = false;
        finished            = false;

        collateralEnabled      = _useCollateral;
        collateralRequirement  = _useCollateral ? payoutSize : 0;

        currentCycle        = 0;
        nextPayoutTime      = 0;
    }

    /* ─────────────────────────── PARTICIPATION ─────────────────────────── */
    function join() external payable {
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
            started        = true;
            nextPayoutTime = block.timestamp + interval;
            emit GroupStarted(block.timestamp);
        }
    }

    function contribute() external payable {
        require(started,          "ROSCA: not started");
        require(!finished,        "ROSCA: finished");
        require(isParticipant(msg.sender),   "ROSCA: not in group");
        require(msg.value == contributionAmount, "ROSCA: wrong amount");
        require(!hasContributed[msg.sender], "ROSCA: already paid");

        hasContributed[msg.sender] = true;
        contributedCount += 1;
        emit Contributed(msg.sender, currentCycle, msg.value);
    }

    /* ─────────────────────────── CORE PAYOUT ─────────────────────────── */
    function triggerPayout() external nonReentrant {
        require(started,                   "ROSCA: not started");
        require(!finished,                 "ROSCA: finished");
        require(block.timestamp >= nextPayoutTime, "ROSCA: interval");

        // 1️⃣ cover or fail missing contributors – also prepare for next cycle (reset flags)
        for (uint256 i = 0; i < participants.length; ++i) {
            address p = participants[i];
            if (!hasContributed[p]) {
                if (collateralEnabled) {
                    if (!memberInfo[p].expelled) {
                        memberInfo[p].expelled = true;
                        expelledCount += 1;
                    }
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

        // 2️⃣ state update first (CEI)
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

    function withdrawCollateral() external nonReentrant {
        require(collateralEnabled, "ROSCA: collateral off");
        require(finished,          "ROSCA: rounds ongoing");

        uint256 amt = memberInfo[msg.sender].collateralRemaining;
        require(amt > 0, "ROSCA: nothing");

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

    /* ─────────────────────────── ADMIN ─────────────────────────── */
    function emergencyWithdraw(address to) external onlyOwner {
        require(!started, "ROSCA: already started");
        payable(to).sendValue(address(this).balance);
    }

    /* ─────────────────────────── FALLBACK GUARDS ─────────────────────────── */
    receive() external payable { revert("Use contribute()"); }
    fallback() external payable { revert("Bad call"); }
    
    function getParticipants() public view returns (address[] memory) {
    return participants;
}

}

