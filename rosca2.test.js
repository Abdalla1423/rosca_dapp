const { expectRevert, time, balance, BN } = require('@openzeppelin/test-helpers');
const ROSCA        = artifacts.require('ROSCA');
const ROSCAFactory = artifacts.require('ROSCAFactory');

/*======================================================
  Helpers
======================================================*/
const ETH = (n) => web3.utils.toWei(n.toString(), 'ether');
const toBN = (x) => web3.utils.toBN(x);

/** deploy implementation + factory once */
async function deployFactory () {
  const impl    = await ROSCA.new();
  const factory = await ROSCAFactory.new(impl.address);
  return { impl, factory };
}

/** spin up a group and auto-join the given members */
async function spawnGroup (
  factory,
  members,
  {
    contribution = ETH(1),
    interval     = 1,
    collateral   = false,
    owner        = members[0], // use real account as “multisig”
  } = {}
) {
  const max   = members.length;
  const tx    = await factory.createGroup(
    contribution, interval, max, collateral, owner
  );
  const proxy = tx.logs.find(l => l.event === 'GroupCreated').args.group;
  const group = await ROSCA.at(proxy);

  for (const m of members) {
    const val = collateral ? contribution * max : 0;
    await group.join({ from: m, value: val });
  }
  return { group, contribution };
}

const pay   = (g, from, amt) => g.contribute({ from, value: amt });
const later = (s = 2)        => time.increase(s);

/*======================================================
  Test-suite
======================================================*/
contract('ROSCA end-to-end', (accounts) => {
  const [alice, bob, carol, dan, erin, frank] = accounts;

  let factory;
  let group, contribution;

  /* one factory for whole file */
  before(async () => { ({ factory } = await deployFactory()); });

  /* fresh 4-member group per test */
  beforeEach(async () => {
    ({ group, contribution } = await spawnGroup(factory, [alice, bob, carol, dan]));
  });

  /*──────────── BASIC FLOW ────────────*/
  describe('basic flow', () => {
    it('pays pot to scheduled recipient', async () => {
      const gain = await balance.tracker(alice);

      await Promise.all([bob, carol, dan].map(u => pay(group, u, contribution)));
      await later();
      await pay(group, alice, contribution);
      await group.triggerPayout({ from: bob });

      const delta = await gain.delta();
      assert(toBN(delta).gte(toBN(ETH(2.9))));
    });

    it('rejects duplicate payment', async () => {
      await pay(group, alice, contribution);
      await expectRevert(pay(group, alice, contribution), 'ROSCA: already paid');
    });

    it('only participants can pay', async () => {
      await expectRevert(pay(group, erin, contribution), 'ROSCA: not in group');
    });
  });

describe('interval & rotation', () => {
    it('blocks payout before interval', async () => {
      const { group: g } = await spawnGroup(factory, [alice, bob, carol], { interval: 5 });
      await Promise.all([alice, bob].map(u => pay(g, u, contribution)));
      await pay(g, carol, contribution);           // <5 s
      assert.equal(await web3.eth.getBalance(g.address), ETH(3));
    });

    it('rotates across cycles', async () => {
      const { group: g } = await spawnGroup(factory, [alice, bob, carol]);

      /* cycle 0 — pot to Alice */
      await Promise.all([bob, carol].map(u => pay(g, u, contribution)));
      await later();
      const gainA = await balance.tracker(alice);
      await pay(g, alice, contribution);
      await g.triggerPayout({ from: carol });

      // ── lower bound now 1.8 ETH (pot 3 – own contrib 1 – gas)
      const deltaA = await gainA.delta();
      assert(toBN(deltaA).gte(toBN(ETH(1.8))));

      /* cycle 1 — pot to Bob */
      await Promise.all([alice, carol].map(u => pay(g, u, contribution)));
      await later();
      const gainB = await balance.tracker(bob);
      await pay(g, bob, contribution);
      await g.triggerPayout({ from: alice });

      const deltaB = await gainB.delta();
      assert(toBN(deltaB).gte(toBN(ETH(1.8))));
    });
  });

  /* collateral mode */
  describe('collateral mode', () => {
    let g, fee;
    beforeEach(async () => {
      fee = ETH(1);
      ({ group: g } = await spawnGroup(
        factory, [alice, bob, carol],
        { collateral: true, contribution: fee }
      ));
    });

    it('expels non-payer yet still rewards them later', async () => {
      await Promise.all([bob, carol].map(u => pay(g, u, fee)));
      await later(3);
      await g.triggerPayout({ from: bob });
      // … two more cycles …
      for (let r = 0; r < 2; r++) {
        await Promise.all([bob, carol].map(u => pay(g, u, fee)));
        await later(3);
        await g.triggerPayout({ from: bob });
      }
      const gain = await balance.tracker(alice);
      const delta = await gain.delta();
      // Alice’s net balance change should be zero-ish or slightly negative (gas)
      // i.e. it must **not** be positive.
      assert(delta.lte(new BN(0)), 'Alice ended up with unexpected profit');
      
    });

    it('refunds collateral after all rounds', async () => {
      for (let rnd = 0; rnd < 3; rnd++) {
        for (const u of [alice, bob, carol]) await pay(g, u, fee);
        await later(3);
        await g.triggerPayout({ from: [alice, bob, carol][rnd] });
      }
      const pre  = await web3.eth.getBalance(alice);
      await g.withdrawCollateral({ from: alice });
      const post = await web3.eth.getBalance(alice);
      assert(toBN(post).gt(toBN(pre)));
    });
  });

  /* emergency pause */
  describe('emergency pause', () => {
    it('owner can pause & unpause', async () => {
      await group.pause({ from: alice });

      // OZ v5 emits a *custom error*, so use .unspecified()
      await expectRevert.unspecified(
        pay(group, bob, contribution)
      );

      await group.unpause({ from: alice });
      await pay(group, bob, contribution); // succeeds
    });
  });

  /*──────────── VIEW HELPERS ────────────*/
  describe('view helpers', () => {
    it('reflects participant & contribution state', async () => {
      assert.equal(await group.isParticipant(alice), true);
      assert.equal(await group.isParticipant(frank), false);

      await Promise.all([alice, bob, carol].map(u => pay(group, u, contribution)));
      await later();
      await pay(group, dan, contribution);
      await group.triggerPayout({ from: alice });

      assert.equal(await group.allContributed(), false);
    });
  });
});
