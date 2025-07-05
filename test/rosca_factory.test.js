// roscha_factory.test.js - merged comprehensive test suite for multi-pool ROSCA

const { expectRevert, balance, time } = require('@openzeppelin/test-helpers');

const ROSCA        = artifacts.require('ROSCA');
const ROSCAFactory = artifacts.require('ROSCAFactory');

// Use Truffle's `contract` wrapper so the accounts array is injected.
contract('ROSCA – multi-pool flow & edge cases', (accounts) => {
  const [alice, bob, carol, dan, erin, frank] = accounts;

  let implementation;   // master copy
  let factory;          // factory instance
  let group;            // primary test clone
  let contribution;     // 1 ether in wei

  /*────────────────── helpers ──────────────────*/
  const ETH = (v) => web3.utils.toWei(v.toString(), 'ether');

  /** Deploy new factory (and implementation) fresh for each test */
  async function freshFactory() {
    implementation = await ROSCA.new();
    factory        = await ROSCAFactory.new(implementation.address);
  }

  /** Create a pool with `members.length` capacity and auto-join them */
  async function newGroup(members, _contribution = contribution, _interval = 1) {
    const max = members.length;
    const tx  = await factory.createGroup(_contribution, _interval, max, { from: alice });
    const addr = tx.logs.find((l) => l.event === 'GroupCreated').args.group;
    const pool = await ROSCA.at(addr);

    for (const m of members) {
      await pool.join({ from: m });
    }
    return pool;
  }

  /** Pay exact contribution into a given pool */
  const pay = (pool, from, amount = contribution) =>
    pool.contribute({ from, value: amount });

  /*────────────────── beforeEach ──────────────────*/
  beforeEach(async () => {
    await freshFactory();
    contribution = ETH(1);
    // default 4-slot group started
    group = await newGroup([alice, bob, carol, dan]);
  });

  /*────────────── BASIC FLOW TESTS ──────────────*/
  it('collects contributions then pays pot to first recipient', async () => {
    const tracker = await balance.tracker(alice);

    await pay(group, alice);
    await pay(group, bob);
    await pay(group, carol);
    await time.increase(2); // interval = 1s
    await pay(group, dan);  // triggers payout

    const gain = await tracker.delta();
    const min  = web3.utils.toBN(ETH(2.9));
    assert(gain.gte(min), 'Alice did not receive expected pot');
  });

  it('only participants can contribute', async () => {
    await expectRevert(
      group.contribute({ from: erin, value: contribution }),
      'Not in group'
    );
  });

  it('rejects duplicate payment', async () => {
    await pay(group, alice);
    await expectRevert(pay(group, alice), 'Already paid');
  });

  it('independent pools do not share state', async () => {
    const contrib2 = ETH(0.5);
    const group2   = await newGroup([erin, bob], contrib2);

    await pay(group, alice);
    await group2.contribute({ from: erin, value: contrib2 });

    assert.equal(await group.currentCycle(),  0);
    assert.equal(await group2.currentCycle(), 0);

    const bal1 = await web3.eth.getBalance(group.address);
    const bal2 = await web3.eth.getBalance(group2.address);
    assert.equal(bal1.toString(), contribution);
    assert.equal(bal2.toString(), contrib2);
  });

  it('factory lists groups by creator', async () => {
    const g2 = await newGroup([alice, bob]);
    const list = await factory.groupsOf(alice);
    assert.deepEqual(list, [group.address, g2.address]);
  });

  it("won't accept joins after start", async () => {
    await expectRevert(group.join({ from: erin }), 'ROSCA: already started');
  });

  /*────────────── EDGE-CASE TESTS ──────────────*/
  it('rejects duplicate join before start', async () => {
    // capacity 2 pool (not started)
    const tx   = await factory.createGroup(contribution, 1, 2, { from: alice });
    const addr = tx.logs[1].args.group;
    const pool = await ROSCA.at(addr);

    await pool.join({ from: alice });
    await expectRevert(pool.join({ from: alice }), 'ROSCA: already joined');
  });

  it('rejects join when pool is full', async () => {
    const tx   = await factory.createGroup(contribution, 1, 2, { from: alice });
    const pool = await ROSCA.at(tx.logs[1].args.group);
    await pool.join({ from: alice });
    await pool.join({ from: bob });
    await expectRevert(pool.join({ from: carol }), 'ROSCA: already started');
  });

  it('rejects contribution before pool started', async () => {
    const tx   = await factory.createGroup(contribution, 1, 2, { from: alice });
    const pool = await ROSCA.at(tx.logs[1].args.group);
    await pool.join({ from: alice }); // one short
    await expectRevert(pool.contribute({ from: alice, value: contribution }), 'ROSCA: not started');
  });

  it('rejects wrong contribution amount', async () => {
    await expectRevert(
      group.contribute({ from: alice, value: ETH(0.5) }),
      'Wrong amount'
    );
  });

    /*──────── Timing guard ───────*/
  it('does not pay out if interval not reached before last payment', async () => {
    // create 3‑member group with 5‑second interval
    const pool = await newGroup([alice, bob, carol], contribution, 5);

    // Alice and Bob contribute quickly (<5s)
    await pay(pool, alice);
    await pay(pool, bob);

    // Last contributor also comes in fast (<5s) – should NOT trigger payout
    await pay(pool, carol);
    const bal = await web3.eth.getBalance(pool.address);
    assert.equal(bal, ETH(3));
  });

  it('rotates payout correctly across cycles', async () => {
    const pool = await newGroup([alice, bob, carol]);

    // Cycle 0: pay first two, wait, pay last (Carol) so pot -> Alice
    await pay(pool, bob);
    await pay(pool, carol);
    await time.increase(2);
    const trackerA = await balance.tracker(alice);
    await pay(pool, alice); // last payment triggers payout to Alice
    const deltaA = await trackerA.delta();
    assert(deltaA.gte(ETH(2.9)));

    // Cycle 1: start fresh, pay Bob last after interval
    await pay(pool, carol);
    await pay(pool, alice);
    await time.increase(2);
    const trackerB = await balance.tracker(bob);
    await pay(pool, bob);
    const deltaB = await trackerB.delta();
    assert(deltaB.gte(ETH(2.9)));
  });

    /*──────── triggerPayout() tests ───────*/
  it('allows anyone to trigger payout once time elapsed', async () => {
    // create small pool for clarity
    const pool = await newGroup([alice, bob], contribution, 3);

    // Alice pays early
    await pay(pool, alice);
    // Bob pays just BEFORE interval → no payout yet
    await time.increase(1);
    await pay(pool, bob);

    // contract is now stuck until interval passes
    await time.increase(3);

    const trackA = await balance.tracker(alice);
    await pool.triggerPayout({ from: erin }); // third party triggers
    const deltaA = await trackA.delta();
    assert(deltaA.gte(ETH(1.9))); // Alice received ~2 ETH (minus gas)
  });

  it('reverts triggerPayout if not all contributed', async () => {
    const pool = await newGroup([alice, bob], contribution, 1);
    await pay(pool, alice); // Bob missing
    await time.increase(2);
    await expectRevert(pool.triggerPayout(), 'ROSCA: contributions missing');
  });

  it('reverts triggerPayout if interval not elapsed', async () => {
    const pool = await newGroup([alice, bob], contribution, 5);
    await pay(pool, alice);
    await pay(pool, bob);
    // interval not done
    await expectRevert(pool.triggerPayout(), 'ROSCA: interval not elapsed');
  });

  it('reverts triggerPayout if pool not started', async () => {
    // deploy but do not join
    const tx = await factory.createGroup(contribution, 5, 2, { from: alice });
    const addr = tx.logs[1].args.group;
    const pool = await ROSCA.at(addr);
    await expectRevert(pool.triggerPayout(), 'ROSCA: not started');
  });

  it('view helpers behave correctly', async () => {
    assert.equal(await group.isParticipant(alice), true);
    assert.equal(await group.isParticipant(frank), false);

    await pay(group, alice);
    await pay(group, bob);
    await pay(group, carol);
    await time.increase(2);
    await pay(group, dan); // payout to Alice, cycle++

    assert.equal(await group.allContributed(), false); // new cycle
  });
});
