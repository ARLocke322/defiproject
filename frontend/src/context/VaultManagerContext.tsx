// context/VaultManagerContext.tsx
import { createContext, useContext, useEffect, useState } from "react";
import { ethers } from "ethers";
import VaultManagerArtifact from "../../constants/VaultManager.json";
import contractAddresses from "../../constants/contract-addresses.json";

const VaultManagerContext = createContext(null);

export const VaultManagerProvider = ({ children }) => {
  const [vaultManager, setVaultManager] = useState(null);
  const vaultAddress = contractAddresses.VaultManager;
  const vaultAbi = VaultManagerArtifact.abi;

  useEffect(() => {
    async function initContract() {
      console.log("🚀 Initializing contract...");
      console.log("📋 Contract address:", vaultAddress);
      console.log("📝 ABI exists:", !!vaultAbi);

      if (!window.ethereum) {
        console.error("❌ MetaMask not detected");
        return;
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const contract = new ethers.Contract(vaultAddress, vaultAbi, provider);
        setVaultManager(contract);
        console.log("✅ VaultManager set successfully");
      } catch (error) {
        console.error("❌ Error initializing contract:", error);
      }
    }

    initContract();
  }, [vaultAddress, vaultAbi]);

  console.log("🔗 Current vaultManager state:", !!vaultManager);

  return (
    <VaultManagerContext.Provider value={vaultManager}>
      {children}
    </VaultManagerContext.Provider>
  );
};

export const useVaultManager = () => useContext(VaultManagerContext);