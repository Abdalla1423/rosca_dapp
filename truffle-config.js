const ganache = require("ganache");


// create exactly one provider for the whole session
const devProvider = ganache.provider({
  hardfork: "shanghai", // use Istanbul hardfork
  wallet: { totalAccounts: 10, unlockedAccounts: [] }, // defaults are fine
});

/** Truffle config – tuned for local Ganache. */
module.exports = {
  networks: {
    development: {
      host: '127.0.0.1',
      port: 8545,
      network_id: '*',
    },
  },

  compilers: {
    solc: {
      version: '0.8.22',
      settings: {
        optimizer: { enabled: true, runs: 200 },
      },
    },
  },

  plugins: ['truffle-upgrade-plugin'],
};