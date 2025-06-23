// Deploys an upgradeable ROSCA proxy with demo parameters.
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const ROSCA = artifacts.require('ROSCA');

module.exports = async function (deployer, network, accounts) {
  // Example: 0.1 ETH per round, 1‑week interval, first 5 Ganache accounts
  const amount  = web3.utils.toWei('0.1', 'ether');
  const oneWeek = 60 * 60 * 24 * 7;
  const members = accounts.slice(0, 5);

  await deployProxy(ROSCA, [amount, oneWeek, members], {
    deployer,
    initializer: 'initialize',
  });
};