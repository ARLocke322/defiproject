import React, { useState, useEffect } from "react";
import { ethers } from "ethers";

const ConnectWallet: React.FC = () => {
  

  const [account, setAccount] = useState<string | null>(null);
  const [connButtonText, setConnButtonText] = useState("Connect Wallet");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setErrorMessage("MetaMask not detected");
      return;
    }

    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0]);
      setConnButtonText("Wallet Connected");
    } catch (err) {
      setErrorMessage("Failed to connect wallet");
    }
  };

  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts: string[]) => {
        setAccount(accounts[0]);
      });
    }
  }, []);

  return (
    <div>
      <button onClick={connectWallet}>{connButtonText}</button>
      {account && <p>Connected: {account}</p>}
      {errorMessage && <p style={{ color: "red" }}>{errorMessage}</p>}
    </div>
  );
};

export default ConnectWallet;
