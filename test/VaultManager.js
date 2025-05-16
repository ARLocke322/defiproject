
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
        it("user should only be able to liquidate undercollateralised vaults", async function () {});
        it("user should only be able to liquidate vaults that have enough ETH to reward them", async function () {});
        it("user should not be able to repay 0 tokens", async function () {});
        it("user should not be able to repay more tokens than are in debt", async function () {});
        it("user should be able to liquidate undercollateralised vaults", async function () {});
        it("should emit CollateralLiquidated event", async function () {});
    });

    describe("Get vault", function () {
        it("user should be able to get the values of a vault", async function () {});
    });

    describe("Get collateral ratio", function () {
        it("user should be able to get the collateral ratio of a vault", async function () {});
        it("should return max uint if user has no debt", async function () {});

    });
});