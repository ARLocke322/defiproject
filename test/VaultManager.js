
const hre = require("hardhat");
const { ethers } = hre;
const { expect } = require("chai");

describe("VaultManager", function () {
    let usdToken, vaultManager, admin, user1, user2;
    beforeEach(async function () {
        [admin, user1, user2] = await ethers.getSigners();
        const USDToken = await ethers.getContractFactory("USDToken");
        
        usdToken = await USDToken.deploy(
            admin.address,
            admin.address,
            admin.address
        )
        await usdToken.waitForDeployment();

        const VaultManager = await ethers.getContractFactory("VaultManager");
        vaultManager = await VaultManager.deploy(usdToken.target)
        await vaultManager.waitForDeployment();

        const MINTER_ROLE = await usdToken.MINTER_ROLE();
        const BURNER_ROLE = await usdToken.BURNER_ROLE();

        await usdToken.grantRole(MINTER_ROLE, vaultManager.target)
        await usdToken.grantRole(BURNER_ROLE, vaultManager.target)
      });
    describe("Depositing collateral", function () {
        it("user should be able to deposit collateral in ETH", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("1")});
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
        it("user should not be able to withdraw more collateral than there is in the vault", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("1")});
            await expect(
                vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("2"))
              ).to.be.revertedWith("Not enough collateral to withdraw");
        });
        it("user should not be able to withdraw collateral if it would cause their vault to become undercollateralised", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("4000", 18));
            await expect(
                vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("1"))
              ).to.be.revertedWith("Withdrawing would cause debt to be undercollateralised");
        });
        it("user should be able to withdraw their collateral", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("6")});
            await vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("2"));
            const vault = await vaultManager.getVault(user1.address);

            expect(vault.collateralETH).to.equal(ethers.parseEther("4"));
        });
        it("should emit CollateralWithdrawn event", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("6")});
            await expect(
                
                vaultManager.connect(user1).withdrawCollateral(ethers.parseEther("2"))
              ).to.emit(vaultManager, "CollateralWithdrawn")
                .withArgs(user1.address, ethers.parseEther("2"));
        });
    });

    describe("Minting", function () {
        it("user should not be able to mint 0 tokens", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await expect(
                vaultManager.connect(user1).mint(ethers.parseUnits("0", 18))
              ).to.be.revertedWith("Amount must be > 0");
        });
        it("user should not be able to mint more tokens than their collateral allows", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await expect(
                vaultManager.connect(user1).mint(ethers.parseUnits("5000", 18))
              ).to.be.revertedWith("Not enough collateral");
        });
        it("user should be able to mint tokens", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
            const vault = await vaultManager.getVault(user1.address);

            expect(vault.debtMyUSD).to.equal(ethers.parseUnits("2000", 18));
            expect(await usdToken.balanceOf(user1.address)).to.equal(ethers.parseUnits("2000", 18));
        });
        it("should emit USDTokenMinted event", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await expect(      
                vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18))
              ).to.emit(vaultManager, "USDTokenMinted")
                .withArgs(user1.address, ethers.parseUnits("2000", 18));
        });
    });

    describe("Burning", function () {
        it("user should not be able to burn 0 tokens", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
            await expect(
                vaultManager.connect(user1).burn(ethers.parseUnits("0", 18))
              ).to.be.revertedWith("Amount must be > 0");
        });
        it("user should not be able to burn more tokens than they have", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
            await usdToken.connect(admin).burn(user1.address, ethers.parseUnits("1000", 18));
            await expect(
                vaultManager.connect(user1).burn(ethers.parseUnits("1500", 18))
              ).to.be.revertedWith("Insufficient token balance");
        });
        it("user should not be able to burn more tokens than they owe", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
            await expect(
                vaultManager.connect(user1).burn(ethers.parseUnits("3000", 18))
              ).to.be.revertedWith("Not enough debt");
        });
        it("user should be able to burn tokens", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
            await vaultManager.connect(user1).burn(ethers.parseUnits("1000", 18));
            const vault = await vaultManager.getVault(user1.address);

            expect(vault.debtMyUSD).to.equal(ethers.parseUnits("1000", 18));
            expect(await usdToken.balanceOf(user1.address)).to.equal(ethers.parseUnits("1000", 18));
        });
        it("should emit USDTokenBurned event", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));
            await expect(      
                vaultManager.connect(user1).burn(ethers.parseUnits("1000", 18))
              ).to.emit(vaultManager, "USDTokenBurned")
                .withArgs(user1.address, ethers.parseUnits("1000", 18));
        });
    });

    describe("Liquidation", function () {
        it("user should not be able to liquidate overcollateralised vaults", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("3")});
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
            await vaultManager.connect(user2).depositCollateral({value: ethers.parseEther("2")});
            await vaultManager.connect(user2).mint(ethers.parseUnits("2000", 18));

            await vaultManager.test_setVault(user1.address, ethers.parseEther("1"), ethers.parseUnits("3000", 18));

            const balanceBefore = await ethers.provider.getBalance(user2.address);

            await usdToken.connect(user2).approve(vaultManager.target, ethers.parseUnits("1500", 18));
            
            await vaultManager.connect(user2).liquidate(user1.address, ethers.parseUnits("1500", 18))

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
            await vaultManager.connect(user2).depositCollateral({value: ethers.parseEther("2")});
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
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("2")});
            await vaultManager.connect(user1).mint(ethers.parseUnits("2000", 18));

            const vault = await vaultManager.getVault(user1.address);

            expect(vault.collateralETH).to.equal(ethers.parseEther("2"));
            expect(vault.debtMyUSD).to.equal(ethers.parseUnits("2000", 18));
        });
    });

    describe("Get collateral ratio", function () {
        it("user should be able to get the collateral ratio of a vault", async function () {
            await vaultManager.connect(user1).depositCollateral({value: ethers.parseEther("2")});
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