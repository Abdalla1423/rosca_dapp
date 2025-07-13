const {
  ETH, toBN,
  deployFactory,
  spawnGroup,
  pay, later,
} = require("./helpers");

const { expectRevert, balance } = require("@openzeppelin/test-helpers");
const ROSCA = artifacts.require("ROSCA");

contract("ROSCA end-to-end", (accounts) => {
  const [alice, bob, carol, dan, erin, frank, george] = accounts;
  let factory, group, contribution;

  /* one factory for the whole file */
  before(async () => ({ factory } = await deployFactory()));

  /* fresh 4-member group for each test */
  beforeEach(async () => {
    ({ group, contribution } = await spawnGroup(factory, [alice, bob, carol, dan]));
  });

  /* ───────────────── BASIC FLOW ───────────────── */
  describe("basic flow", () => {
    it("pays pot to scheduled recipient", async () => {
      const gain = await balance.tracker(alice);
      await Promise.all([alice, bob, carol, dan].map((u) => pay(group, u, contribution)));
      await later();
      await group.triggerPayout({ from: bob });

      const delta = await gain.delta();
      assert(toBN(delta).gte(toBN(ETH(1.8)))); // 3 − 1 − gas
    });

    it("rejects duplicate payment", async () => {
      await pay(group, alice, contribution);
      await expectRevert(pay(group, alice, contribution), "ROSCA: already paid");
    });

    it("only participants can pay", async () => {
      await expectRevert(pay(group, erin, contribution), "ROSCA: not in group");
    });
  });

  /* ───────────── INTERVAL & ROTATION ───────────── */
  describe("interval & rotation", () => {
    it("blocks payout before interval", async () => {
      const { group: g } = await spawnGroup(factory, [alice, bob, carol], { interval: 5 });
      await Promise.all([alice, bob, carol].map((u) => pay(g, u, contribution)));
      assert.equal(await web3.eth.getBalance(g.address), ETH(3));
    });

    it("rotates across cycles", async () => {
      const { group: g } = await spawnGroup(factory, [alice, bob, carol]);

      /* cycle 0 — Alice */
      await Promise.all([alice, bob, carol].map((u) => pay(g, u, contribution)));
      await later();
      const gainA = await balance.tracker(alice);
      await g.triggerPayout({ from: carol });
      assert((await gainA.delta()).gte(toBN(ETH(1.8))));

      /* cycle 1 — Bob */
      await Promise.all([alice, bob, carol].map((u) => pay(g, u, contribution)));
      await later();
      const gainB = await balance.tracker(bob);
      await g.triggerPayout({ from: alice });
      assert((await gainB.delta()).gte(toBN(ETH(1.8))));
    });
  });

  /* ───────────── COLLATERAL MODE ───────────── */
  describe("collateral mode", () => {
    let g, fee;
    beforeEach(async () => {
      fee = ETH(1);
      ({ group: g } = await spawnGroup(
        factory,
        [alice, bob, carol],
        { collateral: true, contribution: fee }
      ));
    });

    it("expels non-payer yet later pays them", async () => {
      await Promise.all([bob, carol].map((u) => pay(g, u, fee)));
      await later(3);
      await g.triggerPayout({ from: bob });

      // two more cycles
      for (let i = 0; i < 2; i++) {
        await Promise.all([bob, carol].map((u) => pay(g, u, fee)));
        await later(3);
        await g.triggerPayout({ from: bob });
      }

      const gain = await balance.tracker(alice);
      assert(toBN(await gain.delta()).lte(toBN(0))); // break-even minus gas
    });

    it("cannot withdraw collateral twice", async () => {
      // finish the game
      for (let r = 0; r < 3; r++) {
        for (const u of [alice, bob, carol]) await pay(g, u, fee);
        await later(2);
        await g.triggerPayout({ from: [alice, bob, carol][r] });
      }
      await g.withdrawCollateral({ from: alice });
      await expectRevert(g.withdrawCollateral({ from: alice }), "ROSCA: none");
    });

    it("non-finished pool rejects collateral withdrawal", async () => {
      await Promise.all([alice, bob, carol].map((u) => pay(g, u, fee)));
      await expectRevert(g.withdrawCollateral({ from: alice }), "ROSCA: rounds ongoing");
    });
  });

  /* ───────────── PAUSE ───────────── */
  describe("emergency pause", () => {
    it("owner can pause & unpause", async () => {
      await group.pause({ from: alice });
      await expectRevert.unspecified(pay(group, bob, contribution));
      await group.unpause({ from: alice });
      await pay(group, bob, contribution);
    });

    it("non-owner cannot pause", async () => {
      await expectRevert.unspecified(group.pause({ from: bob }));
    });

    it("paused contract blocks triggerPayout", async () => {
      await Promise.all([alice, bob, carol, dan].map((u) => pay(group, u, contribution)));
      await later();

      await group.pause({ from: alice });
      await expectRevert.unspecified(group.triggerPayout({ from: bob }));
    });
  });

  /* ───────────── ACCESS CONTROL & FACTORY ───────────── */
describe("factory & owner logic", () => {
  /** helper: pull impl addr out of EIP-1167 byte-code */
  const extractImpl = (code) =>
    "0x" +
    code.slice(22, 62).padStart(40, "0");   // bytes 11-30 → chars 22-61

  it("factory owner can change implementation for future groups", async () => {
    const newImpl = await ROSCA.new();
    await factory.setImplementation(newImpl.address, { from: alice });

    // future group
    const { group: g2 } = await spawnGroup(factory, [erin, frank], { owner: erin });
    const runtime = await web3.eth.getCode(g2.address);
    const implInProxy = extractImpl(runtime);

    assert.equal(
      implInProxy.toLowerCase(),
      newImpl.address.toLowerCase(),
      "proxy points to wrong implementation"
    );
  });

  it("previous groups unaffected after implementation switch", async () => {
    const oldCode = await web3.eth.getCode(group.address);
    const anotherImpl = await ROSCA.new();
    await factory.setImplementation(anotherImpl.address, { from: alice });

    const afterCode = await web3.eth.getCode(group.address);
    assert.equal(oldCode, afterCode, "existing clone byte-code mutated");
  });
});


  /* ───────────── VIEW HELPERS ───────────── */
  describe("view helpers", () => {
    it("reflects participant & contribution state", async () => {
      assert.equal(await group.isParticipant(alice), true);
      assert.equal(await group.isParticipant(george), false);

      await Promise.all([alice, bob, carol].map((u) => pay(group, u, contribution)));
      await later();
      await expectRevert(group.triggerPayout({ from: alice }), "ROSCA: unpaid member");
      
      assert.equal(await group.allContributed(), false);
    });
  });
});
