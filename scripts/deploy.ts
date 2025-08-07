import { ethers, artifacts } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. Deploy Mock Price Feed
  const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
  const mockPriceFeed = await MockV3Aggregator.deploy(2000e8);
  await mockPriceFeed.waitForDeployment();
  const priceFeedAddress = await mockPriceFeed.getAddress();
  console.log("MockV3Aggregator deployed to:", priceFeedAddress);

  // 2. Deploy USDToken with deployer as temporary minter/burner
  const USDToken = await ethers.getContractFactory("USDToken");
  const usd = await USDToken.deploy(
    deployer.address, // admin
    deployer.address, // temporary minter
    deployer.address  // temporary burner
  );
  await usd.waitForDeployment();
  const usdAddress = await usd.getAddress();
  console.log("USDToken deployed to:", usdAddress);

  // 3. Deploy VaultManager with USDToken address
  const VaultManager = await ethers.getContractFactory("VaultManager");
  const vault = await VaultManager.deploy(
    usdAddress,
    priceFeedAddress,
    deployer.address,
    deployer.address // treasury
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("VaultManager deployed to:", vaultAddress);

  // 4. Grant roles to VaultManager
  console.log("Setting up roles...");
  const MINTER_ROLE = await usd.MINTER_ROLE();
  const BURNER_ROLE = await usd.BURNER_ROLE();
  
  await usd.grantRole(MINTER_ROLE, vaultAddress);
  await usd.grantRole(BURNER_ROLE, vaultAddress);
  console.log("✅ Roles granted to VaultManager");

  // 5. Test the MockV3Aggregator
  try {
    const price = await mockPriceFeed.latestRoundData();
    console.log("✅ MockV3Aggregator test successful, price:", price[1].toString());
  } catch (error) {
    console.error("❌ MockV3Aggregator test failed:", error.message);
  }

  // Save frontend files
  saveFrontendFiles(usdAddress, vaultAddress, priceFeedAddress);
}

function saveFrontendFiles(usdAddress: string, vaultAddress: string, priceFeedAddress: string) {
  console.log("🔧 Starting to save frontend files...");
  console.log("📍 Current directory:", __dirname);
  
  const contractsDir = path.join(__dirname, "..", "frontend", "constants");
  console.log("📁 Target directory:", contractsDir);

  // Check if directory exists
  if (!fs.existsSync(contractsDir)) {
    console.log("📂 Directory doesn't exist, creating it...");
    fs.mkdirSync(contractsDir, { recursive: true });
    console.log("✅ Directory created");
  } else {
    console.log("📂 Directory already exists");
  }

  // Save addresses
  const addresses = {
    USDToken: usdAddress,
    VaultManager: vaultAddress,
    MockV3Aggregator: priceFeedAddress,
  };

  const addressesPath = path.join(contractsDir, "contract-addresses.json");
  console.log("💾 Saving addresses to:", addressesPath);

  try {
    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    console.log("✅ Addresses file saved successfully");
    
    // Verify it was written
    if (fs.existsSync(addressesPath)) {
      console.log("✅ File exists after write");
      const content = fs.readFileSync(addressesPath, 'utf8');
      console.log("📄 File content:", content.slice(0, 100) + "...");
    } else {
      console.error("❌ File does not exist after write!");
    }
  } catch (error) {
    console.error("❌ Error writing addresses file:", error);
  }

  // Save ABIs
  try {
    console.log("📝 Reading artifacts...");
    const usdArtifact = artifacts.readArtifactSync("USDToken");
    const vaultArtifact = artifacts.readArtifactSync("VaultManager");
    const mockArtifact = artifacts.readArtifactSync("MockV3Aggregator");
    console.log("✅ Artifacts loaded successfully");

    const usdPath = path.join(contractsDir, "USDToken.json");
    const vaultPath = path.join(contractsDir, "VaultManager.json");
    const mockPath = path.join(contractsDir, "MockV3Aggregator.json");

    fs.writeFileSync(usdPath, JSON.stringify(usdArtifact, null, 2));
    fs.writeFileSync(vaultPath, JSON.stringify(vaultArtifact, null, 2));
    fs.writeFileSync(mockPath, JSON.stringify(mockArtifact, null, 2));
    
    console.log("✅ ABI files saved successfully");
    console.log("📁 Files saved:", [usdPath, vaultPath, mockPath]);
  } catch (error) {
    console.error("❌ Error saving ABI files:", error);
  }

  console.log("🎉 saveFrontendFiles completed");
}


main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
