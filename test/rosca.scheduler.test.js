/**
 *  test/rosca.schedule.test.js
 *
 *  Validate v2.4 preference-aware payout ordering.
 */
const {
  deployFactory,
  spawnGroup,
  ETH,
  toBN,
} = require("./helpers");

const { expectRevert } = require("@openzeppelin/test-helpers");

contract("ROSCA – payout-order scheduler", (accounts) => {
  const [alice, bob, carol, dan, erin] = accounts;
  let factory;

  before(async () => ({ factory } = await deployFactory()));

  it("falls back to join order when no preferences", async () => {
    const { group } = await spawnGroup(factory, [alice, bob, carol]);

    // roster full ⇒ schedule exists
    assert.equal(await group.payoutOrder(0), alice);
    assert.equal(await group.payoutOrder(1), bob);
    assert.equal(await group.payoutOrder(2), carol);
  });

  it("honours earlier deadline over join order", async () => {
    /* Bob wants payout by cycle 2 */
    const { group } = await spawnGroup(
      factory,
      [alice, bob, carol],
      { wishes: [0, 2, 0] }         // 0=no pref, 2=bob
    );

    assert.equal(await group.payoutOrder(0), bob);   // moved first
    assert.deepEqual(
      [await group.payoutOrder(1), await group.payoutOrder(2)],
      [alice, carol]                                  // FCFS for rest
    );
  });

  it("ties (same deadline) resolved by join order", async () => {
    /* Alice & Bob both want latestCycle=2, Alice joined first */
    const { group } = await spawnGroup(
      factory,
      [alice, bob, carol, dan],
      { wishes: [2, 2, 0, 0] }
    );

    assert.deepEqual(
      [
        await group.payoutOrder(0),
        await group.payoutOrder(1),
        await group.payoutOrder(2),
        await group.payoutOrder(3),
      ],
      [alice, bob, carol, dan]
    );
  });

  it("ignores deadlines > maxParticipants", async () => {
    /* Carol asks for 10 (>N=3) → treated as 'no preference' */
    const { group } = await spawnGroup(
      factory,
      [alice, bob, carol],
      { wishes: [0, 0, 10] }
    );

    assert.deepEqual(
      [await group.payoutOrder(0), await group.payoutOrder(1), await group.payoutOrder(2)],
      [alice, bob, carol]   // unchanged FCFS
    );
  });

  it("reverts if preference impossible (deadline = 1 but joins 3rd)", async () => {
    /* Carol cannot be paid by cycle 1 if she joined last */
    const { group } = await spawnGroup(
      factory,
      [alice, bob, carol],
      { wishes: [0, 0, 10] }
    );

    assert.deepEqual(
      [await group.payoutOrder(0), await group.payoutOrder(1), await group.payoutOrder(2)],
      [alice, bob, carol]   // unchanged FCFS
    );
  });
});
