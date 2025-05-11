
const hre = require("hardhat");
const { ethers } = hre;
const { expect } = require("chai");


describe("USDToken", function () {
    let token, deployer, minter, burner, random;
    beforeEach(async function () {
        [deployer, minter, burner, random] = await ethers.getSigners();
        const USDToken = await ethers.getContractFactory("USDToken");
        token = await USDToken.deploy(
            deployer.address,
            minter.address,
            burner.address
        )
        await token.waitForDeployment();
      });
    it("minter should be able to mint", async function () {
        const amount = ethers.parseUnits("1", 18);
        const balanceBefore = await token.balanceOf(random.address)
        await token.connect(minter).mint(random.address, amount);
        const balanceAfter = await token.balanceOf(random.address)
        expect(balanceAfter).to.equal(balanceBefore+amount);
      });
    it("burner should not be able to mint", async function () {
        await expect(
            token.connect(burner).mint(random.address, 1)
          ).to.be.revertedWithCustomError(token, "CallerNotMinter");
      });
    it("burner should be able to burn", async function () {
        const amount = ethers.parseUnits("1", 18);
        await token.connect(minter).mint(random.address, amount)
        const balanceBefore = await token.balanceOf(random.address)
        await token.connect(burner).burn(random.address, amount);
        const balanceAfter = await token.balanceOf(random.address)
        expect(balanceAfter).to.equal(balanceBefore-amount);
      });
    it("minter should not be able to burn", async function () {
        await expect(
            token.connect(minter).burn(random.address, 1)
          ).to.be.revertedWithCustomError(token, "CallerNotBurner");
      });

    it("random user should not be able to mint or burn", async function () {
        await expect(
            token.connect(random).mint(random.address, 1)
          ).to.be.revertedWithCustomError(token, "CallerNotMinter");

        await expect(
            token.connect(random).burn(random.address, 1)
          ).to.be.revertedWithCustomError(token, "CallerNotBurner");

      });
  });