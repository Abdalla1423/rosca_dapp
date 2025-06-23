/**
 * Quick‑and‑dirty gas profiler – run with `npm run gas`.
 * Logs gas used per participant for a single round.
 */
const ROSCA = artifacts.require('ROSCA');

module.exports = async function (callback) {
  const accounts = await web3.eth.getAccounts();
  const inst = await ROSCA.deployed();

  const gasUsed = {};
  for (const a of accounts.slice(0, 4)) {
    const tx = await inst.contribute({ from: a, value: web3.utils.toWei('0.1', 'ether') });
    gasUsed[a] = tx.receipt.gasUsed;
  }

  console.table(gasUsed);
  callback();
};