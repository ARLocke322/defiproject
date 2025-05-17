require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0, // disables EIP-1559 base fee for tests
      gasPrice: 0              // set fixed gas price to zero
    }
  }
};
