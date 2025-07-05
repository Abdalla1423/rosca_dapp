const { expectRevert, balance, time } = require('@openzeppelin/test-helpers');

const ROSCA        = artifacts.require('ROSCA');
const ROSCAFactory = artifacts.require('ROSCAFactory');

contract('ROSCA – multi-pool flow', (accounts) => {
  const [alice, bob, carol, dan, erin] = accounts;

  let implementation;   // master copy
  let factory;          // ROSCAFactory instance
  let group;            // first clone
  let contribution;     // 1 ether

  /*────────────── helper ──────────────*/
  async function newGroup(members, _contribution = contribution, _interval = 1) {
    const tx  = await factory.createGroup(_contribution, _interval, members, { from: alice });
    const evt = tx.logs.find((l) => l.event === 'GroupCreated');
    return ROSCA.at(evt.args.group);
  }

  function pay(c, from) {
    return c.contribute({ from, value: contribution });
  }

  /*──────────── beforeEach ────────────*/
  beforeEach(async () => {
    implementation = await ROSCA.new();                    // 1️⃣
    factory        = await ROSCAFactory.new(implementation.address); // 2️⃣

    contribution   = web3.utils.toWei('1', 'ether');
    group          = await newGroup([alice, bob, carol, dan]);
  });

  /*──────────── tests (unchanged) ───────────*/
  it('collects contributions then pays pot to first recipient', async () => {
    const tracker = await balance.tracker(alice);

    await pay(group, alice);
    await pay(group, bob);
    await pay(group, carol);

    await time.increase(2);   // interval = 1 s

    await pay(group, dan);    // triggers payout

    const gain = await tracker.delta();
    const min  = web3.utils.toBN(web3.utils.toWei('2.9', 'ether'));
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
    const contrib2 = web3.utils.toWei('0.5', 'ether');
    const group2   = await newGroup([erin, bob], contrib2);

    await pay(group, alice);                                   // pool #1
    await group2.contribute({ from: erin, value: contrib2 });  // pool #2

    assert.equal(await group.currentCycle(),  0);
    assert.equal(await group2.currentCycle(), 0);

    const bal1 = await web3.eth.getBalance(group.address);
    const bal2 = await web3.eth.getBalance(group2.address);

    assert.equal(bal1.toString(), contribution);
    assert.equal(bal2.toString(), contrib2);
  });

  it('factory lists groups by creator', async () => {
    const group2 = await newGroup([alice, bob]);
    const list   = await factory.groupsOf(alice);
    assert.deepEqual(list, [group.address, group2.address]);
  });
});
