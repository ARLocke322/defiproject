import React, { useState, useEffect } from "react";
import { useVaultManager } from "../context/VaultManagerContext";
import { ethers } from "ethers";

const VaultDashboard = () => {
  const vaultManager = useVaultManager();
  const [userAddress, setUserAddress] = useState<string>("");
  const [vaultData, setVaultData] = useState({
    collateral: "0",
    debt: "0",
    zeroLiquidation: false,
    loading: true
  });

  useEffect(() => {
    const getUserAddress = async () => {
      if (window.ethereum) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          const address = await signer.getAddress();
          setUserAddress(address);
          console.log("User address set:", address); // Debug log
        } catch (error) {
          console.error("Error getting user address:", error);
        }
      }
    };
    getUserAddress();
  }, []);

  // Load vault data when both vaultManager and userAddress are available
  useEffect(() => {
    const loadAllVaultData = async () => {
      if (!vaultManager || !userAddress) {
        console.log("Missing:", { vaultManager: !!vaultManager, userAddress }); // Debug log
        return;
      }
      
      console.log("Loading vault data for:", userAddress); // Debug log
      
      try {
        const [vault, updatedDebt, ethPrice] = await Promise.all([
          vaultManager.vaults(userAddress),
          vaultManager.getUpdatedDebt(userAddress),
          vaultManager.getLatestPrice()
        ]);

        console.log("Vault data loaded:", { vault, updatedDebt }); // Debug log

        setVaultData({
          collateral: ethers.formatEther(vault.collateralETH),
          debt: ethers.formatEther(updatedDebt),
          zeroLiquidation: vault.zeroLiquidation,
          loading: false
        });
      } catch (error) {
        console.error("Error loading vault data:", error);
        setVaultData(prev => ({ ...prev, loading: false }));
      }
    };

    loadAllVaultData();
  }, [vaultManager, userAddress]);

  return (
    <div>
      <h1>---YOUR VAULT---</h1>
      <p>User Address: {userAddress || "Not connected"}</p> {/* Debug display */}
      {vaultData.loading ? (
        <p>Loading vault data...</p>
      ) : (
        <>
          <h1>Collateral: {vaultData.collateral} ETH</h1>
          <h1>Debt: {vaultData.debt} MyUSD</h1>
          <h1>Zero Liquidation: {vaultData.zeroLiquidation ? "Enabled" : "Disabled"}</h1>
        </>
      )}
    </div>
  );
};

export default VaultDashboard;