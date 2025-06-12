
const hre = require("hardhat");
const { ethers } = hre;
const { expect } = require("chai");
const { exp } = require("prb-math");

describe("VaultManager", function () {
    let usdToken, vaultManager, admin, user1, user2;
    beforeEach(async function () {
        [admin, user1, user2] = await ethers.getSigners();

        const USDToken = await ethers.getContractFactory("USDToken");
        usdToken = await USDToken.deploy(
            admin.address,
            admin.address,
            admin.address
        );
        await usdToken.waitForDeployment();

        const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
        mockPriceFeed = await MockV3Aggregator.deploy(2000e8); // 8 decimals (e.g. $2000)

        const VaultManager = await ethers.getContractFactory("VaultManager");
        vaultManager = await VaultManager.deploy(
            usdToken.target,
            mockPriceFeed.target,
            admin.address // this sets `admin` as the owner
        );
        await vaultManager.waitForDeployment();

        const MINTER_ROLE = await usdToken.MINTER_ROLE();
        const BURNER_ROLE = await usdToken.BURNER_ROLE();

        await usdToken.grantRole(MINTER_ROLE, vaultManager.target);
        await usdToken.grantRole(BURNER_ROLE, vaultManager.target);

        await vaultManager.connect(admin).setInterestRate(ethers.parseUnits("1", 18));
        await vaultManager.connect(admin).setRebalancingEnabled(false);
    });
    describe("Standard Vaults", function () {

        describe("Depositing collateral", function () {
            it("should not be able to deposit under the collateral floor", async function() {
                await expect(
                    vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("0.000001") })
                ).to.be.revertedWith("Must be above collateral floor");
            });
            it("user should be able to deposit collateral in ETH", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                const vault = await vaultManager.getVault(user1.address);
                expect(vault.collateralETH).to.equal(ethers.parseEther("1"));
            });

            it("should emit CollateralDeposited event", async function () {
                await expect(
                    vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") })
                ).to.emit(vaultManager, "CollateralDeposited")
                    .withArgs(user1.address, ethers.parseEther("1"));
            });
        });

        describe("Withdrawing collateral", function () {
            it("user should not be able to withdraw 0 ETH", async function () {
                await expect(
                    vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("0"))
                ).to.be.revertedWith("Amount must be > 0");
            });
            it("should not be able to withdraw under the collateral floor", async function() {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                await expect(
                    vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("0.9999999"))
                ).to.be.revertedWith("Cannot go below collateral floor");
            });
            it("user should not be able to withdraw more collateral than there is in the vault", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                await expect(
                    vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("2"))
                ).to.be.revertedWith("Not enough collateral to withdraw");
            });
            it("user should not be able to withdraw collateral if it would cause their vault to become undercollateralised", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("4000", 18));
                await expect(
                    vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("1"))
                ).to.be.revertedWith("Withdrawing would cause debt to be undercollateralised");
            });
            it("user should be able to withdraw their collateral", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("6") });
                await vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("2"));
                const vault = await vaultManager.getVault(user1.address);

                expect(vault.collateralETH).to.equal(ethers.parseEther("4"));
            });
            it("should emit CollateralWithdrawn event", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("6") });
                await expect(

                    vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("2"))
                ).to.emit(vaultManager, "CollateralWithdrawn")
                    .withArgs(user1.address, ethers.parseEther("2"));
            });
        });

        describe("Minting", function () {
            it("user should not be able to mint 0 tokens", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await expect(
                    vaultManager.connect(user1).mint(ethers.parseUnits("0", 18))
                ).to.be.revertedWith("Amount must be > 0");
            });
            it("user should not be able to mint more tokens than their collateral allows", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await expect(
                    vaultManager.connect(user1).mint(ethers.parseUnits("5000", 18))
                ).to.be.revertedWith("Not enough collateral");
            });
            it("user should be able to mint tokens", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                const vault = await vaultManager.getVault(user1.address);

                expect(vault.debtMyUSD).to.equal(ethers.parseUnits("2000", 18));
                expect(await usdToken.balanceOf(user1.address)).to.equal(ethers.parseUnits("2000", 18));
            });
            it("should emit USDTokenMinted event", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await expect(
                    vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18))
                ).to.emit(vaultManager, "USDTokenMinted")
                    .withArgs(user1.address, ethers.parseUnits("2000", 18));
            });
        });

        describe("Burning", function () {
            it("user should not be able to burn 0 tokens", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                await expect(
                    vaultManager.connect(user1).burn(ethers.parseUnits("0", 18))
                ).to.be.revertedWith("Amount must be > 0");
            });
            it("user should not be able to burn more tokens than they have", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                await usdToken.connect(admin).burn(user1.address, ethers.parseUnits("1000", 18));
                await expect(
                    vaultManager.connect(user1).burn(ethers.parseUnits("1500", 18))
                ).to.be.revertedWith("Insufficient token balance");
            });
            it("user should not be able to burn more tokens than they owe", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                await expect(
                    vaultManager.connect(user1).burn(ethers.parseUnits("3000", 18))
                ).to.be.revertedWith("Not enough debt");
            });
            it("user should be able to burn tokens", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                await vaultManager.connect(user1).burn(ethers.parseUnits("1000", 18));
                const vault = await vaultManager.getVault(user1.address);

                expect(vault.debtMyUSD).to.equal(ethers.parseUnits("1000", 18));
                expect(await usdToken.balanceOf(user1.address)).to.equal(ethers.parseUnits("1000", 18));
            });
            it("should emit USDTokenBurned event", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                await expect(
                    vaultManager.connect(user1).burn(ethers.parseUnits("1000", 18))
                ).to.emit(vaultManager, "USDTokenBurned")
                    .withArgs(user1.address, ethers.parseUnits("1000", 18));
            });
        });

        describe("Liquidation", function () {
            it("user should not be able to liquidate overcollateralised vaults", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                await expect(
                    vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("1000", 18))
                ).to.be.revertedWith("Vault not undercollateralised");


                // run the liquidation test

            });
            it("user should not be able to liquidate vaults that do not have enough ETH to reward them", async function () {
                await vaultManager.test_setVault(user1.address, ethers.parseEther("1"), ethers.parseUnits("3000", 18));
                await expect(
                    vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("3000", 18))
                ).to.be.revertedWith("Not enough ETH in vault");
            });
            it("user should not be able to repay 0 tokens", async function () {
                await vaultManager.test_setVault(user1.address, ethers.parseEther("1"), ethers.parseUnits("3000", 18));
                await expect(
                    vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("0", 18))
                ).to.be.revertedWith("Amount must be > 0");
            });
            it("user should not be able to repay more tokens than are in debt (test path)", async function () {
                await vaultManager.test_setVault(user1.address, ethers.parseEther("0.25"), ethers.parseUnits("1000", 18));
                await expect(
                    vaultManager.connect(user2).test_liquidateWithoutRewardCheck(user1.address, ethers.parseUnits("1500", 18))
                ).to.be.revertedWith("Cannot repay more than debt");
            });
            it("user should be able to liquidate undercollateralised vaults", async function () {
                await vaultManager.connect(user2).depositCollateral({ value: ethers.parseEther("2") });
                await vaultManager.connect(user2).mint(ethers.parseUnits("2000", 18));

                await vaultManager.test_setVault(user1.address, ethers.parseEther("1"), ethers.parseUnits("3000", 18));

                const balanceBefore = await ethers.provider.getBalance(user2.address);

                await usdToken.connect(user2).approve(vaultManager.target, ethers.parseUnits("1500", 18));

                await vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("1500", 18));

                const vault = await vaultManager.getVault(user1.address);

                // check debt gone down
                const balanceAfter = await ethers.provider.getBalance(user2.address);

                expect(vault.debtMyUSD).to.equal(ethers.parseUnits("1500"));

                // check user2 eth gone up
                expect(balanceAfter).to.equal(balanceBefore + ethers.parseEther("0.7875"));


                // check user2 tokens gone down
                expect(await usdToken.balanceOf(user2.address)).to.equal(ethers.parseUnits("500", 18));
            });
            it("should emit CollateralLiquidated event", async function () {
                await vaultManager.connect(user2).depositCollateral({ value: ethers.parseEther("2") });
                await vaultManager.connect(user2).mint(ethers.parseUnits("2000", 18));

                await vaultManager.test_setVault(user1.address, ethers.parseEther("1"), ethers.parseUnits("3000", 18));

                await usdToken.connect(user2).approve(vaultManager.target, ethers.parseUnits("1500", 18));

                await expect(
                    vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("1500", 18))
                ).to.emit(vaultManager, "CollateralLiquidated")
                    .withArgs(user1.address, user2.address, ethers.parseUnits("1500", 18), ethers.parseEther("0.7875"));
            });
        });

        describe("Get vault", function () {
            it("user should be able to get the values of a vault", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("2") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));

                const vault = await vaultManager.getVault(user1.address);

                expect(vault.collateralETH).to.equal(ethers.parseEther("2"));
                expect(vault.debtMyUSD).to.equal(ethers.parseUnits("2000", 18));
            });
        });

        describe("Get collateral ratio", function () {
            it("user should be able to get the collateral ratio of a vault", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("2") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
                const collateralRatio = await vaultManager.getCollateralRatio(user1.address);
                expect(collateralRatio).to.equal(ethers.parseUnits("2", 18));

            });
            it("should return max uint if user has no debt", async function () {
                const collateralRatio = await vaultManager.getCollateralRatio(user1.address);

                expect(collateralRatio).to.equal(ethers.MaxUint256);
            });

        });
    });

    describe("Zero Liquidation Vaults", function () {
        describe("Minting", function () {
            it("should revert if collateral ratio is below 250%", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
                await vaultManager.connect(user1).enableZeroLiquidation();
                await expect(
                    vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18))
                ).to.be.revertedWith("Not enough collateral");
            });
            it("should succeed if collateral ratio is 250% or more", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
                await vaultManager.connect(user1).enableZeroLiquidation();

                await expect(
                    vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18))
                ).to.emit(vaultManager, "USDTokenMinted")
                    .withArgs(user1.address, ethers.parseUnits("1000", 18));

                const vault = await vaultManager.getVault(user1.address);
                
                expect(vault.debtMyUSD).to.equal(ethers.parseUnits("2000", 18));
                expect(await usdToken.balanceOf(user1.address)).to.equal(ethers.parseUnits("2000", 18));
            });
        });

        describe("Withdrawing collateral", function () {
            it("should revert if withdrawal causes collateral ratio to fall below 250%", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2400", 18));
                await vaultManager.connect(user1).enableZeroLiquidation();
                await expect(
                    vaultManager.connect(user1).withdrawCollateral(ethers.parseUnits("1", 18))
                ).to.be.revertedWith("Withdrawing would cause debt to be undercollateralised");
            });
            it("should succeed if withdrawal keeps collateral ratio at or above 250%", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1500", 18));
                await vaultManager.connect(user1).enableZeroLiquidation();

                await expect(
                    vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("1"))
                ).to.emit(vaultManager, "CollateralWithdrawn")
                    .withArgs(user1.address, ethers.parseEther("1"));

                const vault = await vaultManager.getVault(user1.address);
                expect(vault.collateralETH).to.equal(ethers.parseEther("2"));
            });
        });

        describe("Liquidation", function () {
            it("should revert if the vault is zero liquidation enabled", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("6") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));

                await vaultManager.connect(user2).depositCollateral({ value: ethers.parseEther("6") });
                await vaultManager.connect(user2).mint(ethers.parseUnits("2000", 18));

                await vaultManager.connect(user1).enableZeroLiquidation();

                await vaultManager.test_setZLVault(user1.address, ethers.parseEther("1"), ethers.parseUnits("3000", 18));

                await usdToken.connect(user2).approve(vaultManager.target, ethers.parseUnits("1500", 18));

                await expect(
                    vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("1500", 18))
                ).to.be.revertedWith("Zero Liquidation vault cannot be liquidated");
            });
        });

        describe("Enabling ZL", function () {
            it("should revert if collateral ratio is below 250%", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("3000", 18));

                await expect(
                    vaultManager.connect(user1).enableZeroLiquidation()
                ).to.be.revertedWith("Not enough collateral");
            });
            it("should succeed and set zeroLiquidation to true if collateral ratio is 250% or more", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));

                await expect(
                    vaultManager.connect(user1).enableZeroLiquidation()
                ).to.emit(vaultManager, "ZeroLiquidationEnabled")
                    .withArgs(user1.address);

                const vault = await vaultManager.getVault(user1.address);
                expect(vault.zeroLiquidation).to.equal(true);
            });
        });

        describe("Disabling ZL", function () {
            it("should revert if collateral ratio is below 150%", async function () {
                await vaultManager.connect(user1).test_setZLVault(user1.address, ethers.parseEther("3"), ethers.parseUnits("5000", 18))
                
                await expect(
                    vaultManager.connect(user1).disableZeroLiquidation()
                ).to.be.revertedWith("Not enough collateral");
            });
            it("should succeed and set zeroLiquidation to false if collateral ratio is 150% or more", async function () {
                await vaultManager.connect(user1).test_setZLVault(user1.address, ethers.parseEther("3"), ethers.parseUnits("2000", 18))
                
                await expect(
                    vaultManager.connect(user1).disableZeroLiquidation()
                ).to.emit(vaultManager, "ZeroLiquidationDisabled")
                    .withArgs(user1.address);

                const vault = await vaultManager.getVault(user1.address);
                expect(vault.zeroLiquidation).to.equal(false);
            });
        });

    });

    describe("Pausable", function () {
        it("should allow only owner to pause/unpause", async function() {
            await vaultManager.connect(admin).pause();
            await expect(vaultManager.connect(user1).unpause()).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
        });
        describe("Pausing", function () {
            it("should block minting when paused", async function() {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("6") });
                await vaultManager.connect(admin).pause();
                await expect(vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18))).to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
            });
            it("should block burning when paused", async function() {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("6") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
                await vaultManager.connect(admin).pause();
                await expect(vaultManager.connect(user1).burn(ethers.parseUnits("500", 18))).to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
            });
            it("should block deposits when paused", async function() {
                await vaultManager.connect(admin).pause();
                await expect(vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("6") })).to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
            });
            it("should block withdrawals when paused", async function() {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("6") });
                await vaultManager.connect(admin).pause();
                await expect(vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("2"))).to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
            });
            it("should block liquidation when paused", async function() {
                await vaultManager.connect(user2).depositCollateral({ value: ethers.parseEther("2") });
                await vaultManager.connect(user2).mint(ethers.parseUnits("2000", 18));

                await vaultManager.test_setVault(user1.address, ethers.parseEther("1"), ethers.parseUnits("3000", 18));

                await usdToken.connect(user2).approve(vaultManager.target, ethers.parseUnits("1500", 18));

                await vaultManager.connect(admin).pause();
                await expect(vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("1500", 18))).to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
            });
        });
        describe("Unpausing", function () {
            it("should allow minting again after unpausing", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("2") });
                await vaultManager.connect(admin).pause();
                await vaultManager.connect(admin).unpause();

                await expect(vaultManager.connect(user1).mint(ethers.parseUnits("500", 18)))
                    .to.emit(vaultManager, "USDTokenMinted");
            });

        });
    });

    describe("Setters", function () {
        describe("Collateral Floor", function () {
            it("only owner can set", async function () {
                await expect(
                    vaultManager.connect(user1).setCollateralFloor(ethers.parseUnits("20", 18))
                ).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
            });
            it("owner should be able to set a new floor", async function () {
                const newFloor = ethers.parseUnits("20", 18);
                await expect(vaultManager.connect(admin).setCollateralFloor(newFloor))
                    .to.emit(vaultManager, "CollateralFloorUpdated")
                    .withArgs(newFloor);
                expect(await vaultManager.COLLATERAL_FLOOR()).to.equal(newFloor);
                
            });
        });
        describe("Collateral Ratios", function () {
            it("standard ratio cannot be < 1", async function () {
                await expect(
                    vaultManager.connect(admin).setCollateralRatios(ethers.parseUnits("90", 16), ethers.parseUnits("250", 16))
                ).to.be.revertedWith("Too low");
            });
            it("ZL ratio must be greater than standard", async function () {
                await expect(
                    vaultManager.connect(admin).setCollateralRatios(ethers.parseUnits("250", 16), ethers.parseUnits("150", 16))
                ).to.be.revertedWith("ZL must be stricter");
            });
            it("only owner can set", async function () {
                await expect(
                    vaultManager.connect(user1).setCollateralRatios(ethers.parseUnits("150", 16), ethers.parseUnits("250", 16))
                ).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
            });
            it("owner should be able to set a new collateral ratio", async function () {
                const newStandardRatio = ethers.parseUnits("150", 16);
                const newZeroRatio = ethers.parseUnits("250", 16);
                await expect(vaultManager.connect(admin).setCollateralRatios(newStandardRatio, newZeroRatio))
                    .to.emit(vaultManager, "CollateralRatiosUpdated")
                    .withArgs(newStandardRatio, newZeroRatio);
                expect(await vaultManager.STANDARD_COLLATERAL_RATIO()).to.equal(newStandardRatio);
                expect(await vaultManager.ZERO_LIQUIDATION_COLLATERAL_RATIO()).to.equal(newZeroRatio);
            });
        });
        describe("Bonus Percent", function () {
            it("bonus percent must be greater than 100", async function () {
                await expect(
                    vaultManager.connect(admin).setBonusPercent(ethers.parseUnits("90", 16))
                ).to.be.revertedWith("Must be >= 100");
            });
            it("only owner can set", async function () {
                await expect(
                    vaultManager.connect(user1).setBonusPercent(ethers.parseUnits("110", 16))
                ).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
            });
            it("owner should be able to set a new bonus percent", async function () {
                const newBonus = ethers.parseUnits("110", 16);
                await expect(vaultManager.connect(admin).setBonusPercent(newBonus))
                    .to.emit(vaultManager, "BonusPercentUpdated")
                    .withArgs(newBonus);
                expect(await vaultManager.BONUS_PERCENT()).to.equal(newBonus);
            });
        });
        describe("Interest Rate", function () {
            it("Interest Rate must be <= 100%", async function () {
                await expect(
                    vaultManager.connect(admin).setInterestRate(ethers.parseUnits("3", 18))
                ).to.be.revertedWith("Rate must be <= 2.0");
            });
            it("Interest Rate must be >= 0%", async function () {
                await expect(
                    vaultManager.connect(admin).setInterestRate(ethers.parseUnits("0.5", 18))
                ).to.be.revertedWith("Rate must be >= 1.0");
            });
            it("only owner can set", async function () {
                await expect(
                    vaultManager.connect(user1).setInterestRate(ethers.parseUnits("1.01", 18))
                ).to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
            });
            it("owner should be able to set a new Interest Rate", async function () {
                const newFee = ethers.parseUnits("1.01", 18);
                await expect(vaultManager.connect(admin).setInterestRate(newFee))
                    .to.emit(vaultManager, "InterestRateUpdated")
                    .withArgs(newFee);
                expect(await vaultManager.INTEREST_RATE()).to.equal(newFee);
            });
        });

    });

    describe("Interest Rate", function () {
        let YEAR;
        beforeEach(async function () {
            await vaultManager.connect(admin).setInterestRate(ethers.parseUnits("1.000000001547125957", 18));
            YEAR = 31536000
        });
  
        it("should not accrue interest if no time has passed", async function () {
            // Mint, immediately mint again — debt should remain unchanged
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            const vault = await vaultManager.getVault(user1.address);
            expect(vault.debtMyUSD).to.be.closeTo(ethers.parseUnits("2000", 18), 2e15);

        });
      
        it("should accrue correct interest after 1 year", async function () {
            // Mint 1000, wait 1 year, expect debt ≈ 1050 
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.be.closeTo(ethers.parseUnits("1050", 18), 2e15);
        });
      
        it("should accrue interest before minting", async function () {
            // Mint, wait, mint again — ensure interest applied first
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.be.closeTo(ethers.parseUnits("2050", 18), 2e15);
        });
      
        it("should accrue interest before burning", async function () {
            // Mint, wait, burn — check debt reflects interest first
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            await vaultManager.connect(user1).burn(ethers.parseUnits("1000", 18));
            
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.be.closeTo(ethers.parseUnits("50", 18), 2e15);
        });
      
        it("should accrue interest before withdrawing collateral", async function () {
            // Mint, wait, withdraw — ensure interest is considered in checks
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            expect(await vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("1.5"))).to.be.revertedWith("Withdrawing would cause debt to be undercollateralised");
            
        });
      
        it("should accrue interest before enabling Zero Liquidation", async function () {
            // Mint, wait, try enabling ZL — debt should reflect interest
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            await vaultManager.connect(user1).enableZeroLiquidation();
            
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.be.closeTo(ethers.parseUnits("1050", 18), 2e15);
        });
      
        it("should accrue interest before disabling Zero Liquidation", async function () {
            // Enable ZL, wait, disable — debt should reflect interest
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
            await vaultManager.connect(user1).enableZeroLiquidation();
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            await vaultManager.connect(user1).disableZeroLiquidation();
            
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.be.closeTo(ethers.parseUnits("1050", 18), 2e15);
        });
      
        it("should not accrue interest if debt is 0", async function () {
            // Deposit collateral but don’t mint — wait, trigger accrue — expect no change
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.equal(ethers.parseUnits("0", 18));
        });
      
        it("should allow fee to be set to 1", async function () {
            // Set fee to zero, wait, accrue — debt should not change
            await vaultManager.connect(admin).setInterestRate(ethers.parseUnits("1", 18));

            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));

            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR],
            });
            await network.provider.request({ method: 'evm_mine' });
            
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.equal(ethers.parseUnits("1000", 18), 2e15);
            
        });

        it("should accrue correct interest after 2 years", async function () {
            await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
            await vaultManager.connect(user1).mint(ethers.parseUnits("1000", 18));
        
            await network.provider.request({
                method: 'evm_increaseTime',
                params: [YEAR * 2],
            });
            await network.provider.request({ method: 'evm_mine' });
        
            const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
            expect(vaultDebt).to.be.closeTo(ethers.parseUnits("1102.5", 18), 2e15);
        });
      });
      
    describe("Rebalancing Logic", function () {
        
        const REBALANCE_INTERVAL = 43200; // 12 hours 
        const YEAR = 31536000

        beforeEach(async function () {
            await vaultManager.connect(admin).setRebalancingEnabled(true);
            await vaultManager.connect(admin).setInterestRate(ethers.parseUnits("1.000000001547125957", 18));
        });

        describe("Interval Control", function () {
            it("should NOT rebalance before REBALANCE_INTERVAL has passed", async function () {
                const lastRate = await vaultManager.INTEREST_RATE();
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                const newRate = await vaultManager.INTEREST_RATE();
                expect(newRate).to.equal(lastRate);
            });

            it("should rebalance AFTER REBALANCE_INTERVAL has passed", async function () {
                // Simulate enough time passing
                // Trigger user action and check INTEREST_RATE is updated
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("100") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18));
                const lastRate = await vaultManager.INTEREST_RATE();

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                // Check event emitted
                await expect(await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18))).to.emit(vaultManager, "InterestRateUpdated");

                // Check that the rate changed
                const newRate = await vaultManager.INTEREST_RATE();
                expect(newRate).to.not.equal(lastRate);
            });
        });

        describe("Collateral Ratio Thresholds", function () {
            it("should set interest rate to 0.296% if CR >= 200%", async function () {
            // Manipulate ETH collateral and price to simulate CR >= 200%
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("500", 18));
                

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000000937303470", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.03", 18), ethers.parseUnits("0.0001", 18));

            });

            it("should set interest rate to 0.39% if 180% <= CR < 200%", async function () {
            // Manipulate to simulate 180% <= CR < 200%
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1050", 18));

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000001243680656", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.04", 18), ethers.parseUnits("0.0001", 18));
            });

            it("should set interest rate to 0.46% if 160% <= CR < 180%", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1175", 18));

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000001395766281", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.045", 18), ethers.parseUnits("0.0001", 18));
            });

            it("should set interest rate to 0.54% if 140% <= CR < 160%", async function () {
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("1300", 18));
                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000001547125957", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.05", 18), ethers.parseUnits("0.0001", 18));
            });
////
            it("should set interest rate to 0.62% if 120% <= CR < 140%", async function () {
                await vaultManager.test_setVault(user1, ethers.parseEther("1"), ethers.parseUnits("1538", 18))

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user2).depositCollateral({ value: ethers.parseEther("0.01") })
                await vaultManager.connect(user2).mint(ethers.parseUnits("10", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000001697766583", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.055", 18), ethers.parseUnits("0.0001", 18));
            });

            it("should set interest rate to 0.70% if 100% <= CR < 120%", async function () {
                await vaultManager.test_setVault(user1, ethers.parseEther("1"), ethers.parseUnits("1818", 18))

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user2).depositCollateral({ value: ethers.parseEther("0.01") })
                await vaultManager.connect(user2).mint(ethers.parseUnits("10", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000001847694957", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.06", 18), ethers.parseUnits("0.0001", 18));
            });

            it("should set interest rate to 1.01% if CR < 100%", async function () {
                await vaultManager.test_setVault(user1, ethers.parseEther("1"), ethers.parseUnits("4000", 18))

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user2).depositCollateral({ value: ethers.parseEther("0.01") })
                await vaultManager.connect(user2).mint(ethers.parseUnits("10", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000002145441671", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.07", 18), ethers.parseUnits("0.0001", 18));
            });
        });

        describe("Correct Interest Application After Rebalancing", function () {
            it("new interest rate should affect debt growth", async function () {
            // Rebalance to a higher rate
            // Wait 1 year and compare calculated vs expected debt
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("999", 18));

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18));
                
                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [YEAR-REBALANCE_INTERVAL],
                });
                await network.provider.request({ method: 'evm_mine' });


                
                const vaultDebt = await vaultManager.getUpdatedDebt(user1.address);
                expect(vaultDebt).to.be.closeTo(ethers.parseUnits("1030", 18), 2e15);
            });
        });

        describe("Edge Cases", function () {
            it("should not revert if total debt is 0 (infinite CR)", async function () {
            // Set totalDebtMyUSD to 0, call rebalance and ensure no revert
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("3") });
                await expect( // _rebalanceInterestRate called
                    vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") })
                ).to.emit(vaultManager, "CollateralDeposited")
                    .withArgs(user1.address, ethers.parseEther("1"));
            });

            it("should skip rebalancing if interval not reached", async function () {
            // Manually check INTEREST_RATE doesn't change
                await vaultManager.connect(user1).depositCollateral({ value: ethers.parseEther("1") });
                await vaultManager.connect(user1).mint(ethers.parseUnits("500", 18));

                await network.provider.request({
                    method: 'evm_increaseTime',
                    params: [REBALANCE_INTERVAL/2],
                });
                await network.provider.request({ method: 'evm_mine' });

                await vaultManager.connect(user1).mint(ethers.parseUnits("1", 18));

                expect(await vaultManager.INTEREST_RATE()).to.equal(ethers.parseUnits("1.000000001547125957", 18));
                expect(await vaultManager.getAnnualRate()).to.be.closeTo(ethers.parseUnits("1.05", 18), ethers.parseUnits("0.0001", 18));
            });
        });
    });
});
    
