const { deployFactory, ETH } = require("./helpers");
const { BN }                 = require("@openzeppelin/test-helpers");
const ROSCA                  = artifacts.require("ROSCA");

contract("ROSCA – deployment cost comparison", (accounts) => {
  const [owner] = accounts;

  it("Clone deployment costs less gas than full contract deploy", async () => {
    /* ───────────  set-up  ─────────── */
    const { factory } = await deployFactory();
    const fee = ETH(1);

    /* ─────────── 1. Clone via factory  ─────────── */
    const txClone = await factory.createGroup(
      fee, 1, 4, false, owner, { from: owner }
    );
    const gasClone = new BN(txClone.receipt.gasUsed);

    /* ─────────── 2. Full contract deploy  ─────────── */
    const impl   = await ROSCA.new({ from: owner });
    const deployRcpt = await web3.eth.getTransactionReceipt(impl.transactionHash);
    const gasFull = new BN(deployRcpt.gasUsed);

    /* ─────────── 3. Report & assert  ─────────── */
    console.log("\nROSCA deployment gas comparison:");
    console.table([
      { Method: "Clone (factory.createGroup)", Gas: gasClone.toString() },
      { Method: "Full ROSCA deployment",       Gas: gasFull.toString()  },
    ]);

    assert(
      gasClone.lt(gasFull),
      "Proxy-clone deployment should consume less gas than monolithic deploy"
    );
  });
});
