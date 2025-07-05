
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { expectRevert, balance, time } = require('@openzeppelin/test-helpers');
const ROSCA = artifacts.require('ROSCA');

contract('ROSCA basic flow', (accounts) => {
  const [alice, bob, carol, dan] = accounts;
  let rosca;

  beforeEach(async () => {
    // 1 ETH contribution, 1‑second interval to avoid sleeps in tests
    rosca = await deployProxy(
      ROSCA,
      [web3.utils.toWei('1', 'ether'), 1, [alice, bob, carol, dan]],
      { initializer: 'initialize' }
    );
  });

  it('collects contributions then pays pot to first recipient', async () => {
    const contribution = await rosca.contributionAmount();
    const pay = (from) => rosca.contribute({ from, value: contribution });

    const tracker = await balance.tracker(alice);

    await pay(alice);
    await pay(bob);
    await pay(carol);

    // Fast‑forward ≥ interval secs so nextPayoutTime is reached
    await time.increase(2);

    await pay(dan); // triggers payout to Alice

    const delta = await tracker.delta();
    const minimumGain = web3.utils.toBN(web3.utils.toWei('2.9', 'ether'));
    assert(delta.gte(minimumGain),
      `Alice balance increase (${web3.utils.fromWei(delta)}) ETH < expected >2.9 ETH`);
  });

  it('rejects duplicate payment', async () => {
    await rosca.contribute({ from: alice, value: web3.utils.toWei('1', 'ether') });
    await expectRevert(
      rosca.contribute({ from: alice, value: web3.utils.toWei('1', 'ether') }),
      'Already paid'
    );
  });
});