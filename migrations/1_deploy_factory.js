const ROSCA        = artifacts.require("ROSCA");
const ROSCAFactory = artifacts.require("ROSCAFactory");

module.exports = async function (deployer) {
  // step 1 – deploy the master implementation (one-time cost)
  await deployer.deploy(ROSCA);
  const implAddr = ROSCA.address;

  // step 2 – deploy the factory, feeding it the implementation address
  await deployer.deploy(ROSCAFactory, implAddr);
};
