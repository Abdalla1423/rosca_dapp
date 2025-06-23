# ROSCA – Decentralised Rotating Savings Circle

A fully‑upgradeable smart‑contract DApp that replicates the time‑honoured rotating savings and credit association on Ethereum.  Tested with Ganache + Truffle.

## Quick start
```bash
# clone & install deps
$ git clone <repo>
$ cd rosca-dapp && npm install

# start local chain
$ npm run ganache

# compile & deploy
$ npm run compile && npm run migrate

# run tests
$ npm test