const { time } = require("@openzeppelin/test-helpers");
const ROSCA        = artifacts.require("ROSCA");
const ROSCAFactory = artifacts.require("ROSCAFactory");

const ETH  = (n) => web3.utils.toWei(n.toString(), "ether");
const toBN = web3.utils.toBN;

async function deployFactory() {
  const impl    = await ROSCA.new();
  const factory = await ROSCAFactory.new(impl.address);
  return { impl, factory };
}

async function spawnGroup(
  factory,
  members,
  {
    contribution = ETH(1),
    interval     = 1,
    collateral   = false,
    owner        = members[0],
  } = {}
) {
  const max = members.length;
  const tx  = await factory.createGroup(
    contribution, interval, max, collateral, owner
  );
  const addr  = tx.logs.find(l => l.event === "GroupCreated").args.group;
  const group = await ROSCA.at(addr);

  for (const m of members) {
    const val = collateral ? contribution * max : 0;
    await group.join({ from: m, value: val });
  }
  return { group, contribution };
}

const pay   = (g, from, amt) => g.contribute({ from, value: amt });
const later = (s = 2)        => time.increase(s);

module.exports = {
  ETH, toBN,
  deployFactory,
  spawnGroup,
  pay, later,
};
