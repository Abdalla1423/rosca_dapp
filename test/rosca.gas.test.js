/**
 *  test/rosca.gas.test.js
 *
 *  Measure gas usage for a complete 4-round ROSCA game
 *  and show a per-member breakdown with names.
 */
const { deployFactory, spawnGroup, later, ETH } = require("./helpers");
const { BN } = require("@openzeppelin/test-helpers");
const ROSCA = artifacts.require("ROSCA");

contract("ROSCA – gas profile", (accounts) => {
  const [owner, alice, bob, carol, dan] = accounts;
  const roster   = [alice, bob, carol, dan];
  const nameOf   = {
    [owner]: "Factory owner",
    [alice]: "Alice",
    [bob]:   "Bob",
    [carol]: "Carol",
    [dan]:   "Dan",
  };

  it("prints per-member gas consumption (including deployment)", async () => {
    /* 1. Deploy factory + impl */
    const { factory } = await deployFactory();
    const fee = ETH(1);

    /* 2. Deploy group (clone) – capture gas */
    const txCreate = await factory.createGroup(
      fee,          // contribution
      1,            // interval
      roster.length,
      false,        // collateral
      owner,        // multisig/owner
      { from: owner }
    );
    const groupAddr = txCreate.logs.find(l => l.event === "GroupCreated").args.group;
    const group     = await ROSCA.at(groupAddr);

    /* gas bookkeeping */
    const gas = { [owner]: new BN(txCreate.receipt.gasUsed) };

    const addGas = (from, used) => {
      gas[from] = (gas[from] || new BN(0)).add(new BN(used));
    };

    /* 3. Members join */
    for (const p of roster) {
      const rec = await group.join(0, { from: p });         // value = 0 (no collateral)
      addGas(p, rec.receipt.gasUsed);
    }

    /* 4. Play 4 rounds */
    for (let round = 0; round < roster.length; round++) {
      /* contributions */
      for (const p of roster) {
        const rec = await group.contribute({ from: p, value: fee });
        addGas(p, rec.receipt.gasUsed);
      }
      await later();          // satisfy interval

      /* rotate who triggers payout */
      const caller = roster[round];
      const recP   = await group.triggerPayout({ from: caller });
      addGas(caller, recP.receipt.gasUsed);
    }

    /* 5. Pretty console output */
    const table = Object.entries(gas).map(([addr, bn]) => ({
      Actor: nameOf[addr] || addr.slice(0, 6) + "…",
      Gas:   bn.toString(),
    }));
    console.log("\nGas usage (deployment + full 4-round game):");
    console.table(table);

    /* sanity: every tracked account spent > 0 gas */
    for (const { Gas } of table) {
      assert(new BN(Gas).gt(new BN(0)), "unexpected zero-gas entry");
    }
  });
});
