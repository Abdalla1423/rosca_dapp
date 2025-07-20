// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  ROSCA (Rotating Savings & Credit Association) smart‑contract          │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ Purpose                                                                │
 * │ ▸ A group of N members contributes a fixed amount every cycle.         │
 * │ ▸ Once every member has paid and a user‑defined time‑interval passes,  │
 * │   the whole pot is paid out to **one** recipient.                      │
 * │ ▸ The recipient rotates each cycle according to `payoutOrder[]`.       │
 * │ ▸ Optionally members deposit a full‑pot collateral that can be tapped  │
 * │   if they fail to contribute (and they get expelled).                  │
 * │ ▸ The contract is clone‑friendly (EIP‑1167) and fully upgrade‑safe.    │
 * │                                                                       │
 * │ Key features                                                           │
 * │  ✔ **Deadline‑aware scheduling** – On join a member may state the      │
 * │    *latest* cycle they need their payout; an EDF‑based algorithm       │
 * │    produces a schedule that satisfies as many wishes as possible.      │
 * │  ✔ **Emergency pause**             – Multisig owner can halt all state │
 * │    changes; replaces the legacy `emergencyWithdraw`.                   │
 * │  ✔ **Collateral option**           – Groups may run with or without a  │
 * │    payout‑sized security deposit.                                      │
 * │  ✔ Gas‑bounded loops (max 100 members) so every call is L1‑safe.       │
 * │                                                                       │
 * │ Upgrade notes                                                          │
 * │  • Storage layout is append‑only; new vars go below old ones.          │
 * │  • The implementation is meant to be cloned via a factory; existing    │
 * │    clones are immutable after deployment.                              │
 * └─────────────────────────────────────────────────────────────────────────┘
 */


import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract ROSCA
    is Initializable, OwnableUpgradeable,
       ReentrancyGuardUpgradeable, PausableUpgradeable
{
    using Address for address payable;

    /*//////////////////////////////////////////////////////////////////////////
                                  CONFIG CONSTANTS
    //////////////////////////////////////////////////////////////////////////*/

    /// Hard cap so any `for` loop is ≤100 iterations → safe on main‑net gas
    uint256 public constant MAX_PARTICIPANTS = 100;

    /*//////////////////////////////////////////////////////////////////////////
                               IMMUTABLE‑AFTER‑INIT
    //////////////////////////////////////////////////////////////////////////*/

    uint256 public contributionAmount;      // ETH each member pays per round
    uint256 public interval;                // min seconds between payouts
    uint256 public maxParticipants;         // == number of rounds
    bool    public collateralEnabled;       // true → members post a bond

    // Once group starts `participants` never changes length or order.
    // join() pushes addresses here; _finaliseSchedule() copies into payoutOrder
    address[] public participants;

    // Final payout schedule length == maxParticipants.  Never modified after start.
    address[] public payoutOrder;

    /*//////////////////////////////////////////////////////////////////////////
                                  STATE MACHINE
    //////////////////////////////////////////////////////////////////////////*/

    bool public started;                    // becomes true when roster full
    bool public finished;                   // true after last payout

    uint256 public payoutSize;              // == contribution * maxParticipants
    uint256 public collateralRequirement;   // == payoutSize when collateral on

    /* Current‑cycle bookkeeping */
    uint256 public currentCycle;            // 0‑indexed
    uint256 public nextPayoutTime;          // unix timestamp
    mapping(address => bool) public hasContributed;
    uint256 public contributedCount;

    /* Collateral / expulsion */
    struct MemberInfo { uint256 collateralRemaining; bool expelled; }
    mapping(address => MemberInfo) public memberInfo;

    /*──────────────────────────── Preference feature (v2.4) ───────────────────*/
    /// latestDesiredCycle: 1‑indexed deadline; 0 or >maxParticipants ⇒ no pref
    mapping(address => uint256) public latestDesiredCycle;

    /*//////////////////////////////////////////////////////////////////////////
                                      EVENTS
    //////////////////////////////////////////////////////////////////////////*/
    event ParticipantJoined(address indexed who, uint256 index);
    event ScheduleFinalised(address[] order);

    event GroupStarted(uint256 startTime);
    event CycleAdvanced(uint256 newCycle);
    event GroupFinished(uint256 finishedAt);

    event Contributed(address indexed who, uint256 indexed cycle, uint256 amount);
    event Payout(address indexed recipient,uint256 indexed cycle, uint256 amount);

    event CollateralUsed(address indexed debtor,uint256 indexed cycle,uint256 share);
    event CollateralRefunded(address indexed member,uint256 amount);

    /*//////////////////////////////////////////////////////////////////////////
                                     INITIALISE
    //////////////////////////////////////////////////////////////////////////*/

    constructor() { _disableInitializers(); }

    /**
     * @param _contribution  ETH each member pays per cycle
     * @param _interval      Seconds between payout opportunities
     * @param _maxParticipants Also == number of cycles/payouts
     * @param _useCollateral true → members deposit one full‑payout as bond
     * @param _ownerMultisig Address that can pause/unpause; likely a Safe
     */
    function initialize(
        uint256 _contribution,
        uint256 _interval,
        uint256 _maxParticipants,
        bool    _useCollateral,
        address _ownerMultisig
    ) external initializer {
        require(_maxParticipants > 1 && _maxParticipants <= MAX_PARTICIPANTS,
                "participants out of bounds");
        require(_ownerMultisig != address(0), "owner = 0");

        __Ownable_init(_ownerMultisig);
        __ReentrancyGuard_init();
        __Pausable_init();

        contributionAmount = _contribution;
        interval           = _interval;
        maxParticipants    = _maxParticipants;
        payoutSize         = _contribution * _maxParticipants;

        collateralEnabled      = _useCollateral;
        collateralRequirement  = _useCollateral ? payoutSize : 0;

        started = false;
        finished = false;
        currentCycle = 0;
        nextPayoutTime = 0;
    }

    /*//////////////////////////////////////////////////////////////////////////
                                      PAUSING
    //////////////////////////////////////////////////////////////////////////*/
    /// Multisig can halt all state‑changes in emergencies (re‑entrancy, bug, etc.)
    function pause()   external onlyOwner { _pause();   }
    function unpause() external onlyOwner { _unpause(); }

    /*//////////////////////////////////////////////////////////////////////////
                                   JOIN & SCHEDULER
    //////////////////////////////////////////////////////////////////////////*/

    /**
     * Join the group.  Once `participants.length == maxParticipants`
     * we compute `payoutOrder` and flip `started = true`.
     *
     * @param _latestCycle 1‑indexed “latest round I must be paid by”.
     *                     0 or > N == no preference.
     */
    function join(uint256 _latestCycle) external payable whenNotPaused {
        require(!started,              "ROSCA: already started");
        require(!finished,             "ROSCA: finished");
        require(!isParticipant(msg.sender), "ROSCA: already joined");
        require(participants.length < maxParticipants, "ROSCA: full");

        /* Collateral deposit */
        if (collateralEnabled) {
            require(msg.value == collateralRequirement, "ROSCA: bad collateral");
            memberInfo[msg.sender] = MemberInfo(msg.value, false);
        } else {
            require(msg.value == 0, "ROSCA: collateral off");
        }

        participants.push(msg.sender);
        latestDesiredCycle[msg.sender] = _latestCycle;
        emit ParticipantJoined(msg.sender, participants.length - 1);

        if (participants.length == maxParticipants) {
            started        = true;
            _finaliseSchedule(); // compute payoutOrder[]
            nextPayoutTime = block.timestamp + interval;
            emit GroupStarted(block.timestamp);
        }
    }

    /* ---------------- scheduler: earliest‑deadline‑first ------------------ */

    /// Greedy EDF: 1) sort by deadline, 2) place each at earliest free slot,
    /// 3) fill blank slots with no‑preference joiners in FCFS order.
    function _finaliseSchedule() internal {
        uint256 n = participants.length;
        address[] memory order = new address[](n);
        bool[]   memory taken = new bool[](n);

        /* 1. Collect preference list sorted by deadline (insertion sort – n<=100) */
        address[] memory prefs = new address[](n);
        uint256 prefCount = 0;
        for (uint i = 0; i < n; ++i) {
            address p = participants[i];
            uint256 d = latestDesiredCycle[p];
            if (d != 0 && d <= n) {
                // insertion into prefs by ascending d
                uint j = prefCount;
                while (j > 0 && latestDesiredCycle[prefs[j-1]] > d) {
                    prefs[j] = prefs[j-1];
                    j--;
                }
                prefs[j] = p;
                prefCount++;
            }
        }

        /* 2. Place preferred participants greedily */
        for (uint i = 0; i < prefCount; ++i) {
            address p = prefs[i];
            uint256 deadline = latestDesiredCycle[p];
            for (uint slot = 0; slot < deadline; ++slot) {
                if (!taken[slot]) { order[slot] = p; taken[slot] = true; break; }
            }
        }

        /* 3. Fill remaining slots with no‑preference members (FCFS) */
        uint slotIdx = 0;
        for (uint i = 0; i < n; ++i) {
            address p = participants[i];
            uint256 d = latestDesiredCycle[p];
            if (d == 0 || d > n) {
                while (slotIdx < n && taken[slotIdx]) slotIdx++;
                if (slotIdx < n) { order[slotIdx] = p; taken[slotIdx] = true; slotIdx++; }
            }
        }

        payoutOrder = order;
        emit ScheduleFinalised(order);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                CONTRIBUTIONS & PAYOUT
    //////////////////////////////////////////////////////////////////////////*/

    /**
     * Members call once per cycle with exactly `contributionAmount` ETH.
     * If everyone has paid and `interval` passed, anyone may later call
     * `triggerPayout()` (or the first payer of the next round auto‑calls it).
     */
    function contribute() external payable whenNotPaused {
        require(started, "ROSCA: not started");
        require(!finished, "ROSCA: finished");
        require(isParticipant(msg.sender), "ROSCA: not in group");
        require(msg.value == contributionAmount, "ROSCA: wrong amount");
        require(!memberInfo[msg.sender].expelled, "ROSCA: user expelled");


        /* This makes it easier for participants with automated contributions as triggerPayout()
        is called automatically by the first contributor of the next cycle, so it never blocks. */
        if (block.timestamp >= nextPayoutTime && hasContributed[msg.sender]) {
            triggerPayout();
        }

        require(!hasContributed[msg.sender], "ROSCA: already paid");
        hasContributed[msg.sender] = true;
        contributedCount += 1;
        emit Contributed(msg.sender, currentCycle, msg.value);
    }

    /* ------------------------- main payout entry ------------------------- */
    function triggerPayout() public nonReentrant whenNotPaused {
        require(started, "ROSCA: not started");
        require(!finished, "ROSCA: finished");
        require(block.timestamp >= nextPayoutTime, "ROSCA: interval");

        _coverOrExpelDefaulters();  

        require(contributedCount == participants.length,
                "ROSCA: contributions mismatch");
        contributedCount = 0;               // reset for next cycle

        /* --- send pot --- */
        address recipient = payoutOrder[currentCycle];
        
        currentCycle += 1;
        if (currentCycle == participants.length) {
            finished = true;
            emit GroupFinished(block.timestamp);
        } else {
            nextPayoutTime = block.timestamp + interval;
            emit CycleAdvanced(currentCycle);
        }

        payable(recipient).sendValue(payoutSize);
        emit Payout(recipient, currentCycle - 1, payoutSize);
    }

    /**
     * Iterate participants once:
     *   • if not paid, either cover via collateral+expel or revert (no‑collateral mode)
     *   • clear `hasContributed[..]` bitmap for next cycle
     */
    function _coverOrExpelDefaulters() internal {
        for (uint i = 0; i < participants.length; ++i) {
            address p = participants[i];
            if (!hasContributed[p]) {
                if (collateralEnabled) {
                    if (!memberInfo[p].expelled) {
                        memberInfo[p].expelled = true;
                    }
                    deductFromCollateral(p ,contributionAmount);
                    contributedCount += 1;
                } else {
                    revert("ROSCA: unpaid member");
                }
            }
            hasContributed[p] = false;   // reset bitmap
        }
    }

    /*//////////////////////////////////////////////////////////////////////////
                                 COLLATERAL MANAGEMENT
    //////////////////////////////////////////////////////////////////////////*/
    function deductFromCollateral(address member, uint256 _amount) internal whenNotPaused {
        require(collateralEnabled, "ROSCA: collateral off");
        require(isParticipant(member), "ROSCA: not in group");
        require(memberInfo[member].expelled, "ROSCA: user not expelled");
        require(memberInfo[member].collateralRemaining >= _amount, "ROSCA: not enough collateral");

        memberInfo[member].collateralRemaining -= _amount;
        emit CollateralUsed(member, currentCycle, _amount);
    }

    function refundCollateral() external nonReentrant whenNotPaused {
        require(collateralEnabled, "ROSCA: collateral off");
        require(finished, "ROSCA: rounds ongoing");

        uint256 amt = memberInfo[msg.sender].collateralRemaining;
        require(amt > 0, "ROSCA: none");

        memberInfo[msg.sender].collateralRemaining = 0;
        payable(msg.sender).sendValue(amt);
        emit CollateralRefunded(msg.sender, amt);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                    VIEW HELPERS
    //////////////////////////////////////////////////////////////////////////*/
    function isParticipant(address a) public view returns (bool) {
        for (uint256 i = 0; i < participants.length; ++i) {
            if (participants[i] == a) return true;
        }
        return false;
    }

    function allContributed() external view returns (bool) {
        return contributedCount == participants.length;
    }

    /*//////////////////////////////////////////////////////////////////////////
                                   FALLBACK GUARDS
    //////////////////////////////////////////////////////////////////////////*/
    receive() external payable { revert("Use contribute()"); }
    fallback() external payable { revert("Bad call"); }
}
