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