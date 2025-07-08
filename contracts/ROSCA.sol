// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/*
 *  ┌────────────────────────────────────────────────────────────┐
 *  │  Rotating Savings & Credit Association (ROSCA) – v2.0     │
 *  └────────────────────────────────────────────────────────────┘
 *  Key fixes                                       
 *  ────────────────────────────────────────────────
 *  1. LIMITED ROUNDS
 *     - The group now terminates after exactly `participants.length` cycles.
 *     - Emits `GroupFinished` and blocks further contributions / payouts.
 *  2. RE‑ENTRANCY GUARD (C‑1)
 *     - Inherits `ReentrancyGuardUpgradeable` and marks external‑ETH functions `nonReentrant`.
 *     - State is advanced before the external transfer (checks‑effects‑interactions).
 *  3. DROPPED UUPS (C‑3)
 *     - `UUPSUpgradeable` inheritance and its authorize hook removed.
 *     - Contract is still Initializable for clone deployment but is *not* upgradeable.
 */

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract ROSCA is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using Address for address payable;

    /* ───────────────────────────────────────────── IMMUTABLE‑ish PARAMS ─────────────────────────────────────────── */
    uint256 public contributionAmount;   // fixed per‑round payment (wei)
    uint256 public interval;             // min seconds between payouts
    address[] public participants;       // roster (constant after start)
    uint256  public maxParticipants;     // hard cap == #rounds
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
    mapping(uint256 => mapping(address => bool)) public hasContributed; // cycle ⇒ member ⇒ paid?

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
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint256 _contribution,
        uint256 _interval,
        uint256 _maxParticipants,
        bool    _useCollateral
    ) external initializer {
        require(_maxParticipants > 1, "need => 2 participants");

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
        require(!hasContributed[currentCycle][msg.sender], "ROSCA: already paid");

        hasContributed[currentCycle][msg.sender] = true;
        emit Contributed(msg.sender, currentCycle, msg.value);
    }

    /* ─────────────────────────── CORE PAYOUT ─────────────────────────── */
    function triggerPayout() external nonReentrant {
        require(started,                   "ROSCA: not started");
        require(!finished,                 "ROSCA: finished");
        require(block.timestamp >= nextPayoutTime, "ROSCA: interval");

        // 1️⃣ cover or fail missing contributors
        for (uint256 i = 0; i < participants.length; ++i) {
            address p = participants[i];
            if (!hasContributed[currentCycle][p]) {
                if (collateralEnabled) {
                    // burn collateral one contribution worth
                    memberInfo[p].collateralRemaining -= contributionAmount; // underflow protected by Solidity 0.8
                    memberInfo[p].expelled = true;
                    hasContributed[currentCycle][p] = true;
                    emit CollateralUsed(p, currentCycle, contributionAmount);
                } else {
                    revert("ROSCA: unpaid member");
                }
            }
        }

        // double‑check all paid
        require(allContributed(), "ROSCA: unpaid after cover");

        // 2️⃣ compute new state *before* external interaction (checks‑effects‑interactions)
        address recipient = participants[currentCycle % participants.length];
        uint256 pot       = contributionAmount * participants.length;

        // advance cycle
        currentCycle += 1;
        if (currentCycle == participants.length) {
            finished = true;
            emit GroupFinished(block.timestamp);
        } else {
            nextPayoutTime = block.timestamp + interval;
            emit CycleAdvanced(currentCycle);
        }

        // 3️⃣ transfer pot – uses safe send (2300 gas) fallback to call with limited gas
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

    function allContributed() public view returns (bool) {
        for (uint256 i = 0; i < participants.length; ++i) {
            if (!hasContributed[currentCycle][participants[i]]) return false;
        }
        return true;
    }

    /* ─────────────────────────── FALLBACK GUARDS ─────────────────────────── */
    receive() external payable { revert("Use contribute()"); }
    fallback() external payable { revert("Bad call"); }
}
