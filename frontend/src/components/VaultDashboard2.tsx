"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { AlertTriangle, TrendingUp, Clock, Shield, Wallet, Plus, Minus, RefreshCw, DollarSign, Zap, Loader2 } from 'lucide-react'

import { toast } from "sonner";
import { useVaultManager } from "../context/VaultManagerContext";
import { ethers } from "ethers";


// Helper function to convert risk level to string
const getRiskLevelString = (riskLevel: number): string => {
    switch (riskLevel) {
        case 0: return "Low";
        case 1: return "Medium";
        case 2: return "High";
        case 3: return "Critical";
        default: return "Unknown";
    }
};

// Helper function to format time until rebalance
const formatTimeUntilRebalance = (seconds: number): string => {
    if (seconds === 0) return "Ready";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
};

const liquidationData = [
    {
        id: "0x1a2b...3c4d",
        owner: "0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t",
        collateralETH: "1.8",
        debtMyUSD: "2,850",
        collateralRatio: 142,
        liquidationReward: "85.50",
        timeToLiquidation: "12m",
        riskLevel: "High"
    },
    {
        id: "0x2b3c...4d5e",
        owner: "0x2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u",
        collateralETH: "3.2",
        debtMyUSD: "4,200",
        collateralRatio: 148,
        liquidationReward: "126.00",
        timeToLiquidation: "8m",
        riskLevel: "High"
    },
    {
        id: "0x3c4d...5e6f",
        owner: "0x3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v",
        collateralETH: "0.9",
        debtMyUSD: "1,180",
        collateralRatio: 146,
        liquidationReward: "35.40",
        timeToLiquidation: "15m",
        riskLevel: "High"
    },
    {
        id: "0x4d5e...6f7g",
        owner: "0x4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w",
        collateralETH: "5.1",
        debtMyUSD: "6,800",
        collateralRatio: 149,
        liquidationReward: "204.00",
        timeToLiquidation: "5m",
        riskLevel: "Critical"
    },
    {
        id: "0x5e6f...7g8h",
        owner: "0x5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x",
        collateralETH: "2.3",
        debtMyUSD: "3,100",
        collateralRatio: 144,
        liquidationReward: "93.00",
        timeToLiquidation: "18m",
        riskLevel: "High"
    }
]

export default function VaultDashboard() {
    const [zeroLiquidation, setZeroLiquidation] = useState(false)
    const [activeTab, setActiveTab] = useState<"dashboard" | "liquidation">("dashboard")
    const [isConnected, setIsConnected] = useState(false)
    const [isConnecting, setIsConnecting] = useState(false)
    const [walletAddress, setWalletAddress] = useState("")
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // Updated vault data state with all required fields
    const [vaultData, setVaultData] = useState({
        collateral: "0",
        debt: "0",
        updatedDebt: "0",
        zeroLiquidation: false,
        collateralRatio: 0,
        liquidationPrice: "0",
        safetyBuffer: 0,
        maxMintable: "0",
        accruedInterest: "0",
        liquidationRisk: 0, // 0=Low, 1=Medium, 2=High, 3=Critical
        ethPrice: "0",
        annualInterestRate: 0,
        timeUntilRebalance: 0,
        loading: true
    });

    // Additional state for wallet balances
    const [walletBalances, setWalletBalances] = useState({
        ethBalance: "0",
        usdBalance: "0",
        loading: true
    });

    // Get contract instance
    const vaultManager = useVaultManager()

    const [actionLoading, setActionLoading] = useState({
        deposit: false,
        withdraw: false,
        mint: false,
        repay: false
    });

    const [actionAmounts, setActionAmounts] = useState({
        depositAmount: "",
        withdrawAmount: "",
        mintAmount: "",
        repayAmount: ""
    });

    const handleTransactionError = (error: any, action: string) => {
        console.error(`❌ ${action} failed:`, error);

        let errorMessage = `${action} failed`;

        if (error.reason) {
            errorMessage = error.reason;
        } else if (error.data?.message) {
            errorMessage = error.data.message;
        } else if (error.message) {
            if (error.message.includes("user rejected")) {
                errorMessage = "Transaction cancelled by user";
            } else if (error.message.includes("insufficient funds")) {
                errorMessage = "Insufficient funds";
            } else {
                errorMessage = error.message;
            }
        }

        toast.error(errorMessage);
    };

    const getUSDTokenAddress = async () => {
        try {
            const contractAddresses = await import("../../constants/contract-addresses.json");
            return contractAddresses.USDToken;
        } catch (error) {
            console.error("Could not load contract addresses:", error);
            return null;
        }
    };

    
    const depositCollateral = async (amount: string) => {
        if (!vaultManager || !walletAddress || !amount || parseFloat(amount) <= 0) {
            toast.error("Please enter a valid amount");
            return;
        }

        setActionLoading(prev => ({ ...prev, deposit: true }));

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contractWithSigner = vaultManager.connect(signer);

            console.log(`📥 Depositing ${amount} ETH as collateral...`);

            // Convert amount to Wei
            const amountWei = ethers.parseEther(amount);

            // Check if user has enough ETH
            const balance = await provider.getBalance(walletAddress);
            if (balance < amountWei) {
                throw new Error("Insufficient ETH balance");
            }

            // Send transaction
            const tx = await contractWithSigner.depositCollateral({
                value: amountWei,
                gasLimit: 300000 // Set reasonable gas limit
            });

            toast.loading("Transaction pending...", { id: "deposit" });

            // Wait for confirmation
            const receipt = await tx.wait();

            if (receipt.status === 1) {
                toast.success(`Successfully deposited ${amount} ETH`, { id: "deposit" });

                // Clear input and refresh data
                setActionAmounts(prev => ({ ...prev, depositAmount: "" }));

                // Refresh vault data
                setTimeout(() => {
                    window.location.reload(); // Simple refresh, you could make this more elegant
                }, 2000);

            } else {
                throw new Error("Transaction failed");
            }

        } catch (error: any) {
            toast.dismiss("deposit");
            handleTransactionError(error, "Deposit");
        } finally {
            setActionLoading(prev => ({ ...prev, deposit: false }));
        }
    };

    // 2. WITHDRAW COLLATERAL
    const withdrawCollateral = async (amount: string) => {
        if (!vaultManager || !walletAddress || !amount || parseFloat(amount) <= 0) {
            toast.error("Please enter a valid amount");
            return;
        }

        setActionLoading(prev => ({ ...prev, withdraw: true }));

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contractWithSigner = vaultManager.connect(signer);

            console.log(`📤 Withdrawing ${amount} ETH collateral...`);

            const amountWei = ethers.parseEther(amount);

            // Check if user has enough collateral
            if (parseFloat(amount) > parseFloat(vaultData.collateral)) {
                throw new Error("Insufficient collateral to withdraw");
            }

            const tx = await contractWithSigner.withdrawCollateral(amountWei, {
                gasLimit: 300000
            });

            toast.loading("Transaction pending...", { id: "withdraw" });

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                toast.success(`Successfully withdrew ${amount} ETH`, { id: "withdraw" });
                setActionAmounts(prev => ({ ...prev, withdrawAmount: "" }));

                setTimeout(() => {
                    window.location.reload();
                }, 2000);

            } else {
                throw new Error("Transaction failed");
            }

        } catch (error: any) {
            toast.dismiss("withdraw");
            handleTransactionError(error, "Withdraw");
        } finally {
            setActionLoading(prev => ({ ...prev, withdraw: false }));
        }
    };

    // 3. MINT MyUSD
    const mintMyUSD = async (amount: string) => {
        if (!vaultManager || !walletAddress || !amount || parseFloat(amount) <= 0) {
            toast.error("Please enter a valid amount");
            return;
        }

        setActionLoading(prev => ({ ...prev, mint: true }));

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contractWithSigner = vaultManager.connect(signer);

            console.log(`💰 Minting ${amount} MyUSD...`);

            const amountWei = ethers.parseUnits(amount, 18); // MyUSD has 18 decimals

            // Check if user has enough collateral to maintain ratio
            const maxMintable = parseFloat(vaultData.maxMintable);
            if (parseFloat(amount) > maxMintable) {
                throw new Error(`Can only mint up to $${maxMintable.toFixed(2)} MyUSD with current collateral`);
            }

            const tx = await contractWithSigner.mint(amountWei, {
                gasLimit: 400000
            });

            toast.loading("Transaction pending...", { id: "mint" });

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                toast.success(`Successfully minted $${amount} MyUSD`, { id: "mint" });
                setActionAmounts(prev => ({ ...prev, mintAmount: "" }));

                setTimeout(() => {
                    window.location.reload();
                }, 2000);

            } else {
                throw new Error("Transaction failed");
            }

        } catch (error: any) {
            toast.dismiss("mint");
            handleTransactionError(error, "Mint");
        } finally {
            setActionLoading(prev => ({ ...prev, mint: false }));
        }
    };

    // 4. REPAY DEBT
    const repayDebt = async (amount: string) => {
        if (!vaultManager || !walletAddress || !amount || parseFloat(amount) <= 0) {
            toast.error("Please enter a valid amount");
            return;
        }

        setActionLoading(prev => ({ ...prev, repay: true }));

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const contractWithSigner = vaultManager.connect(signer);

            console.log(`💸 Repaying ${amount} MyUSD debt...`);

            const amountWei = ethers.parseUnits(amount, 18);

            // Check if user has enough MyUSD to repay
            if (parseFloat(amount) > parseFloat(walletBalances.usdBalance)) {
                throw new Error("Insufficient MyUSD balance to repay");
            }

            // Check if trying to repay more than owed
            if (parseFloat(amount) > parseFloat(vaultData.updatedDebt)) {
                throw new Error(`Cannot repay more than debt amount: ${parseFloat(vaultData.updatedDebt).toFixed(2)}`);
            }

            // First approve the contract to spend MyUSD tokens
            // Update the repayDebt function to use dynamic USD token address:
            // Replace "YOUR_USD_TOKEN_ADDRESS" with:
            const usdTokenAddress = await getUSDTokenAddress();
            if (!usdTokenAddress) {
                throw new Error("USD Token contract address not found");
            }
            const usdTokenABI = [
                "function approve(address spender, uint256 amount) external returns (bool)",
                "function allowance(address owner, address spender) external view returns (uint256)"
            ];

            const usdToken = new ethers.Contract(usdTokenAddress, usdTokenABI, signer);

            // Check current allowance
            const currentAllowance = await usdToken.allowance(walletAddress, vaultManager.target);

            if (currentAllowance < amountWei) {
                console.log("🔐 Approving MyUSD spending...");
                const approveTx = await usdToken.approve(vaultManager.target, amountWei);
                await approveTx.wait();
                console.log("✅ Approval confirmed");
            }

            const tx = await contractWithSigner.repay(amountWei, {
                gasLimit: 400000
            });

            toast.loading("Transaction pending...", { id: "repay" });

            const receipt = await tx.wait();

            if (receipt.status === 1) {
                toast.success(`Successfully repaid ${amount} MyUSD`, { id: "repay" });
                setActionAmounts(prev => ({ ...prev, repayAmount: "" }));

                setTimeout(() => {
                    window.location.reload();
                }, 2000);

            } else {
                throw new Error("Transaction failed");
            }

        } catch (error: any) {
            toast.dismiss("repay");
            handleTransactionError(error, "Repay");
        } finally {
            setActionLoading(prev => ({ ...prev, repay: false }));
        }
    };

    const validateDepositAmount = (amount: string): boolean => {
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) return false;

        // Check if user has enough ETH (leave some for gas)
        const maxDeposit = parseFloat(walletBalances.ethBalance) - 0.01; // Reserve 0.01 ETH for gas
        return numAmount <= maxDeposit;
    };

    const validateWithdrawAmount = (amount: string): boolean => {
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) return false;

        // Check if user has enough collateral
        return numAmount <= parseFloat(vaultData.collateral);
    };

    const validateMintAmount = (amount: string): boolean => {
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) return false;

        // Check against max mintable
        return numAmount <= parseFloat(vaultData.maxMintable);
    };

    const validateRepayAmount = (amount: string): boolean => {
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) return false;

        // Check if user has enough MyUSD and not repaying more than owed
        return numAmount <= parseFloat(walletBalances.usdBalance) &&
            numAmount <= parseFloat(vaultData.updatedDebt);
    };

    // MODAL COMPONENT FOR ACTIONS
    const ActionModal = ({
        isOpen,
        onClose,
        title,
        action,
        amount,
        setAmount,
        onSubmit,
        isLoading,
        maxAmount,
        unit,
        validateAmount
    }: {
        isOpen: boolean;
        onClose: () => void;
        title: string;
        action: string;
        amount: string;
        setAmount: (amount: string) => void;
        onSubmit: () => void;
        isLoading: boolean;
        maxAmount: string;
        unit: string;
        validateAmount: (amount: string) => boolean;
    }) => {
        if (!isOpen) return null;

        const isValid = validateAmount(amount);

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
                <div className="relative z-10 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 max-w-md w-full mx-4">
                    <div className="space-y-4">
                        <div className="text-center">
                            <h3 className="text-xl font-bold text-white">{title}</h3>
                            <p className="text-gray-400 text-sm mt-1">
                                Available: {parseFloat(maxAmount).toFixed(4)} {unit}
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-gray-300">Amount</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder={`Enter amount in ${unit}`}
                                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                                    step="0.0001"
                                    min="0"
                                />
                                <button
                                    onClick={() => setAmount(maxAmount)}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded"
                                >
                                    MAX
                                </button>
                            </div>
                            {amount && !isValid && (
                                <p className="text-red-400 text-xs">Invalid amount</p>
                            )}
                        </div>

                        <div className="flex gap-3 pt-4">
                            <Button
                                onClick={onClose}
                                variant="outline"
                                className="flex-1 bg-gray-600 hover:bg-gray-700 border-gray-600"
                                disabled={isLoading}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={onSubmit}
                                className="flex-1 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600"
                                disabled={!isValid || isLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        {action}...
                                    </>
                                ) : (
                                    action
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // MODAL STATE MANAGEMENT
    const [activeModal, setActiveModal] = useState<string | null>(null);

    // MODAL FUNCTIONS
    const openDepositModal = () => setActiveModal("deposit");
    const openWithdrawModal = () => setActiveModal("withdraw");
    const openMintModal = () => setActiveModal("mint");
    const openRepayModal = () => setActiveModal("repay");
    const closeModal = () => setActiveModal(null);



    // Real MetaMask connection function
    const connectWallet = async () => {
        if (!window.ethereum) {
            setErrorMessage("MetaMask not detected");
            return;
        }

        setIsConnecting(true);
        setErrorMessage(null);

        try {
            const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
            setIsConnected(true);
            setWalletAddress(accounts[0]);
        } catch (err) {
            setErrorMessage("Failed to connect wallet");
            console.error("Connection error:", err);
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnectWallet = () => {
        setIsConnected(false);
        setWalletAddress("");
        setErrorMessage(null);
    };

    // Add account change listener
    useEffect(() => {
        if (window.ethereum) {
            const handleAccountsChanged = (accounts: string[]) => {
                if (accounts.length === 0) {
                    setIsConnected(false);
                    setWalletAddress("");
                } else {
                    setWalletAddress(accounts[0]);
                    setIsConnected(true);
                }
            };

            window.ethereum.on("accountsChanged", handleAccountsChanged);

            const checkConnection = async () => {
                try {
                    const accounts = await window.ethereum.request({ method: "eth_accounts" });
                    if (accounts.length > 0) {
                        setIsConnected(true);
                        setWalletAddress(accounts[0]);
                    }
                } catch (error) {
                    console.error("Error checking connection:", error);
                }
            };

            checkConnection();

            return () => {
                window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
            };
        }
    }, []);

    // Load vault data
    useEffect(() => {
        const loadAllVaultData = async () => {
            if (!vaultManager || !walletAddress) {
                console.log("Waiting for:", {
                    vaultManager: !!vaultManager,
                    walletAddress: walletAddress || "empty"
                });
                return;
            }

            console.log("🎯 Both vaultManager and wallet ready - loading data...");
            setVaultData(prev => ({ ...prev, loading: true }));
            setWalletBalances(prev => ({ ...prev, loading: true }));

            try {
                const provider = new ethers.BrowserProvider(window.ethereum);
                const network = await provider.getNetwork();
                console.log("🌐 Connected to network:", network.name, "Chain ID:", network.chainId);

                // Check if contract exists
                const contractCode = await provider.getCode(vaultManager.target);
                if (contractCode === "0x") {
                    throw new Error("Contract not deployed on this network");
                }

                const contractWithProvider = vaultManager.connect(provider);

                // Try getDashboardData first, fallback to individual calls
                try {
                    const dashboardData = await contractWithProvider.getDashboardData(walletAddress);

                    setVaultData({
                        collateral: ethers.formatEther(dashboardData.collateralETH || 0),
                        debt: ethers.formatEther(dashboardData.debtMyUSD || 0),
                        updatedDebt: ethers.formatEther(dashboardData.updatedDebt || 0),
                        zeroLiquidation: dashboardData.zeroLiquidation || false,
                        collateralRatio: Number(ethers.formatUnits(dashboardData.collateralRatio, 16)),
                        liquidationPrice: ethers.formatUnits(dashboardData.liquidationPrice, 8),
                        safetyBuffer: Number(dashboardData.safetyBuffer) / 100,
                        maxMintable: ethers.formatEther(dashboardData.maxMintable || 0),
                        accruedInterest: ethers.formatEther(dashboardData.accruedInterest || 0),
                        liquidationRisk: Number(dashboardData.liquidationRisk),
                        ethPrice: ethers.formatUnits(dashboardData.ethPrice, 8),
                        annualInterestRate: Number(dashboardData.annualInterestRate) / 100,
                        timeUntilRebalance: Number(dashboardData.timeUntilRebalance),
                        loading: false
                    });
                } catch (error) {
                    console.log("getDashboardData not available, using individual calls...");

                    // Fallback to individual calls
                    const [
                        vaultInfo,
                        updatedDebt,
                        collateralRatio,
                        ethPrice,
                    ] = await Promise.all([
                        contractWithProvider.getVault(walletAddress),
                        contractWithProvider.getUpdatedDebt(walletAddress),
                        contractWithProvider.getCollateralRatio(walletAddress),
                        contractWithProvider.getLatestPrice(),
                    ]);

                    console.log("✅ Individual vault data loaded");

                    setVaultData({
                        collateral: ethers.formatEther(vaultInfo[0] || 0),
                        debt: ethers.formatEther(vaultInfo[1] || 0),
                        updatedDebt: ethers.formatEther(updatedDebt || 0),
                        zeroLiquidation: vaultInfo[2] || false,
                        collateralRatio: collateralRatio === ethers.MaxUint256 ? 0 : Number(ethers.formatUnits(collateralRatio, 16)),
                        liquidationPrice: "0", // Will need new functions
                        safetyBuffer: 0,
                        maxMintable: "0",
                        accruedInterest: "0",
                        liquidationRisk: 0,
                        ethPrice: ethers.formatUnits(ethPrice, 8),
                        annualInterestRate: 0,
                        timeUntilRebalance: 0,
                        loading: false
                    });
                }

                // Load wallet balances
                const ethBalance = await provider.getBalance(walletAddress);
                
                // Load USD token balance
                let usdBalance = "0";
                try {
                    const usdTokenAddress = await getUSDTokenAddress();
                    if (usdTokenAddress) {
                        const usdTokenABI = [
                            "function balanceOf(address owner) external view returns (uint256)"
                        ];
                        const usdToken = new ethers.Contract(usdTokenAddress, usdTokenABI, provider);
                        const balance = await usdToken.balanceOf(walletAddress);
                        usdBalance = ethers.formatEther(balance);
                        console.log("💰 USD Balance loaded:", usdBalance, "MyUSD");
                    } else {
                        console.log("⚠️ USD Token address not found");
                    }
                } catch (error) {
                    console.log("⚠️ Could not load USD balance:", error);
                    // Keep usdBalance as "0" if there's an error
                }

                setWalletBalances({
                    ethBalance: ethers.formatEther(ethBalance),
                    usdBalance: usdBalance,
                    loading: false
                });
            } catch (error) {
                console.error("❌ Error loading vault data:", error);

                setVaultData({
                    collateral: "0",
                    debt: "0",
                    updatedDebt: "0",
                    zeroLiquidation: false,
                    collateralRatio: 0,
                    liquidationPrice: "0",
                    safetyBuffer: 0,
                    maxMintable: "0",
                    accruedInterest: "0",
                    liquidationRisk: 0,
                    ethPrice: "0",
                    annualInterestRate: 0,
                    timeUntilRebalance: 0,
                    loading: false
                });

                setWalletBalances({
                    ethBalance: "0",
                    usdBalance: "0",
                    loading: false
                });
            }
        };

        loadAllVaultData();
    }, [vaultManager, walletAddress]);

    const getRiskColor = (ratio: number) => {
        if (ratio >= 200) return "text-green-400"
        if (ratio >= 150) return "text-yellow-400"
        return "text-red-400"
    }

    const getRiskBadgeColor = (risk: string) => {
        switch (risk.toLowerCase()) {
            case "low":
                return "bg-green-500/20 text-green-400 border-green-500/30"
            case "medium":
                return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
            case "high":
                return "bg-red-500/20 text-red-400 border-red-500/30"
            case "critical":
                return "bg-red-600/30 text-red-300 border-red-600/50"
            default:
                return "bg-gray-500/20 text-gray-400 border-gray-500/30"
        }
    }

    const getProgressColor = (ratio: number) => {
        if (ratio >= 200) return "bg-green-500"
        if (ratio >= 150) return "bg-yellow-500"
        return "bg-red-500"
    }

    const truncateAddress = (address: string) => {
        if (!address) return ""
        return `${address.slice(0, 6)}...${address.slice(-4)}`
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 relative">
            {/* Wallet Connection Overlay */}
            {!isConnected && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-lg" />
                    <div className="relative z-10 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
                        <div className="text-center space-y-6">
                            <div className="flex justify-center">
                                <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
                                    <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-2xl font-bold text-white">Connect Your Wallet</h2>
                                <p className="text-gray-300">Connect MetaMask to access your vault dashboard</p>
                            </div>
                            <Button
                                onClick={connectWallet}
                                disabled={isConnecting}
                                className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-semibold py-4 text-lg rounded-xl shadow-lg transition-all duration-300 transform hover:scale-105"
                            >
                                {isConnecting ? (
                                    <>
                                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                        Connecting...
                                    </>
                                ) : (
                                    "Connect Wallet"
                                )}
                            </Button>
                            <p className="text-sm text-gray-400">
                                MetaMask required to interact with DeFi protocol
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Dashboard Content */}
            <div className={`w-full px-4 space-y-6 transition-all duration-500 ${!isConnected ? 'blur-lg pointer-events-none' : ''}`}>
                {/* Header */}
                <div className="text-center space-y-4">
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                        YOUR VAULT DASHBOARD
                    </h1>
                    <div className="flex items-center justify-center gap-2 text-gray-300">
                        <Wallet className="h-4 w-4" />
                        <span className="font-mono text-sm">{truncateAddress(walletAddress)}</span>
                    </div>
                </div>

                {/* Wallet Status Indicator */}
                {isConnected && (
                    <div className="fixed top-4 right-4 z-40">
                        <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-lg p-3 group hover:bg-white/20 transition-all duration-200">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <span className="text-sm font-mono text-white">{truncateAddress(walletAddress)}</span>
                            </div>
                            <div className="absolute top-full right-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                <Button
                                    onClick={disconnectWallet}
                                    size="sm"
                                    variant="destructive"
                                    className="bg-red-500/90 hover:bg-red-600 text-white text-xs"
                                >
                                    Disconnect
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Tab Navigation */}
                <div className="flex justify-center">
                    <div className="bg-white/5 backdrop-blur-lg border border-white/10 rounded-lg p-1">
                        <div className="flex gap-1">
                            <button
                                onClick={() => setActiveTab("dashboard")}
                                className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${activeTab === "dashboard"
                                    ? "bg-blue-500 text-white shadow-lg"
                                    : "text-gray-400 hover:text-white hover:bg-white/10"
                                    }`}
                            >
                                My Vault
                            </button>
                            <button
                                onClick={() => setActiveTab("liquidation")}
                                className={`px-6 py-2 rounded-md font-medium transition-all duration-200 ${activeTab === "liquidation"
                                    ? "bg-red-500 text-white shadow-lg"
                                    : "text-gray-400 hover:text-white hover:bg-white/10"
                                    }`}
                            >
                                Liquidation Market
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tab Content */}
                {activeTab === "dashboard" ? (
                    <>
                        {/* Vault Overview Panel */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
                            <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-400">Current Collateral</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-white">{vaultData.collateral} ETH</div>
                                    <div className="text-sm text-gray-400 mt-1">
                                        ≈ ${(Number.parseFloat(vaultData.collateral) * Number.parseFloat(vaultData.ethPrice)).toLocaleString()}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-400">Current Debt</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-white">
                                        {vaultData.loading ? "Loading..." : `$${Number.parseFloat(vaultData.updatedDebt).toFixed(2)} MyUSD`}
                                    </div>
                                    <div className="text-sm text-gray-400 mt-1">Stable value</div>
                                </CardContent>
                            </Card>

                            <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-400">Collateral Ratio</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className={`text-2xl font-bold ${getRiskColor(vaultData.collateralRatio)}`}>
                                        {vaultData.collateralRatio.toFixed(0)}%
                                    </div>
                                    <Progress value={Math.min(vaultData.collateralRatio, 300)} max={300} className="mt-2 h-2" />
                                    <div className="text-xs text-gray-400 mt-1">Min: 150%</div>
                                </CardContent>
                            </Card>

                            <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-400">Liquidation Risk</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Badge className={`${getRiskBadgeColor(getRiskLevelString(vaultData.liquidationRisk))} mb-2`}>
                                        <AlertTriangle className="h-3 w-3 mr-1" />
                                        {getRiskLevelString(vaultData.liquidationRisk)}
                                    </Badge>
                                    <div className="text-sm text-gray-400">Monitor closely</div>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                            {/* Market Information Panel */}
                            <div className="xl:col-span-1">
                                <div className="grid grid-cols-1 gap-4">
                                    <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
                                                <TrendingUp className="h-4 w-4" />
                                                ETH/USD Price
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-xl font-bold text-green-400">${Number.parseFloat(vaultData.ethPrice).toLocaleString()}</div>
                                        </CardContent>
                                    </Card>

                                    <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
                                                <DollarSign className="h-4 w-4" />
                                                Interest Rate
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-xl font-bold text-blue-400">{vaultData.annualInterestRate.toFixed(1)}%</div>
                                        </CardContent>
                                    </Card>

                                    <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                        <CardHeader className="pb-2">
                                            <CardTitle className="text-sm font-medium text-gray-400 flex items-center gap-2">
                                                <Clock className="h-4 w-4" />
                                                Next Rebalance
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-xl font-bold text-purple-400">{formatTimeUntilRebalance(vaultData.timeUntilRebalance)}</div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </div>

                            {/* Action Buttons Panel */}
                            <div className="xl:col-span-2">
                                <Card className="bg-white/5 backdrop-blur-lg border-white/10 h-full">
                                    <CardHeader>
                                        <CardTitle className="text-lg font-semibold text-white">Vault Actions</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        {vaultData.loading ? (
                                            <div className="text-center py-4">
                                                <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-400" />
                                                <p className="text-gray-400 mt-2">Loading vault data...</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <Button
                                                    onClick={openDepositModal}
                                                    className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold py-3 h-auto"
                                                >
                                                    <Plus className="h-4 w-4 mr-2" />
                                                    Deposit Collateral
                                                </Button>
                                                <Button
                                                    onClick={openMintModal}
                                                    className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold py-3 h-auto"
                                                >
                                                    <DollarSign className="h-4 w-4 mr-2" />
                                                    Mint MyUSD
                                                </Button>

                                                <Button
                                                    onClick={openWithdrawModal}
                                                    className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold py-3 h-auto"
                                                    disabled={parseFloat(vaultData.collateral) === 0}
                                                >
                                                    <Minus className="h-4 w-4 mr-2" />
                                                    Withdraw Collateral
                                                </Button>
                                                <Button
                                                    onClick={openRepayModal}
                                                    className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold py-3 h-auto"
                                                    disabled={parseFloat(vaultData.updatedDebt) === 0}
                                                >
                                                    <RefreshCw className="h-4 w-4 mr-2" />
                                                    Repay Debt
                                                </Button>
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                                            <div className="flex items-center gap-3">
                                                <Shield className="h-5 w-5 text-blue-400" />
                                                <div>
                                                    <div className="font-medium text-white">Zero-Liquidation Mode</div>
                                                    <div className="text-sm text-gray-400">Automatic collateral management</div>
                                                </div>
                                            </div>
                                            <Switch
                                                checked={vaultData.zeroLiquidation}
                                                onCheckedChange={setZeroLiquidation}
                                                className="data-[state=checked]:bg-blue-500"
                                                disabled={vaultData.loading}
                                            />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>

                        {/* Risk Management Panel */}
                        <Card className="bg-white/5 backdrop-blur-lg border-white/10">
                            <CardHeader>
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Shield className="h-5 w-5 text-yellow-400" />
                                    Risk Management
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-gray-400">Liquidation Price</div>
                                        <div className="text-xl font-bold text-red-400">${Number.parseFloat(vaultData.liquidationPrice).toLocaleString()}</div>
                                        <div className="text-xs text-gray-500">ETH price threshold</div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-gray-400">Safety Buffer</div>
                                        <div className="text-xl font-bold text-green-400">{vaultData.safetyBuffer.toFixed(1)}%</div>
                                        <div className="text-xs text-gray-500">Above liquidation</div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-gray-400">Required vs Current</div>
                                        <div className="text-xl font-bold">
                                            <span className="text-red-400">150%</span>
                                            <span className="text-gray-500 mx-2">vs</span>
                                            <span className={getRiskColor(vaultData.collateralRatio)}>{vaultData.collateralRatio.toFixed(0)}%</span>
                                        </div>
                                        <div className="text-xs text-gray-500">Collateral ratio</div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-sm font-medium text-gray-400">Max Mintable</div>
                                        <div className="text-xl font-bold text-blue-400">${Number.parseFloat(vaultData.maxMintable).toLocaleString()}</div>
                                        <div className="text-xs text-gray-500">Additional MyUSD</div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Account Balances Panel */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-400">Wallet ETH Balance</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-white">
                                        {walletBalances.loading ? "Loading..." : `${Number.parseFloat(walletBalances.ethBalance).toFixed(4)} ETH`}
                                    </div>
                                    <div className="text-sm text-gray-400 mt-1">Available for deposit</div>
                                </CardContent>
                            </Card>

                            <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-400">MyUSD Balance</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-white">
                                        {walletBalances.loading ? "Loading..." : `${Number.parseFloat(walletBalances.usdBalance).toFixed(2)}`}
                                    </div>
                                    <div className="text-sm text-gray-400 mt-1">Liquid stablecoin</div>
                                </CardContent>
                            </Card>

                            <Card className="bg-white/5 backdrop-blur-lg border-white/10 hover:bg-white/10 transition-all duration-300">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-gray-400">Accrued Interest</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-yellow-400">${Number.parseFloat(vaultData.accruedInterest).toFixed(2)}</div>
                                    <div className="text-sm text-gray-400 mt-1">Pending charges</div>
                                </CardContent>
                            </Card>
                        </div>
                    </>
                ) : (
                    /* Liquidation Market Tab */
                    <div className="space-y-6">
                        {/* Market Stats */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Card className="bg-white/5 backdrop-blur-lg border-white/10">
                                <CardContent className="p-4">
                                    <div className="text-sm text-gray-400">Total Liquidatable</div>
                                    <div className="text-2xl font-bold text-red-400">{liquidationData.length}</div>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 backdrop-blur-lg border-white/10">
                                <CardContent className="p-4">
                                    <div className="text-sm text-gray-400">Total Collateral</div>
                                    <div className="text-2xl font-bold text-white">
                                        {liquidationData.reduce((sum, vault) => sum + parseFloat(vault.collateralETH), 0).toFixed(1)} ETH
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 backdrop-blur-lg border-white/10">
                                <CardContent className="p-4">
                                    <div className="text-sm text-gray-400">Total Rewards</div>
                                    <div className="text-2xl font-bold text-green-400">
                                        ${liquidationData.reduce((sum, vault) => sum + parseFloat(vault.liquidationReward), 0).toFixed(2)}
                                    </div>
                                </CardContent>
                            </Card>
                            <Card className="bg-white/5 backdrop-blur-lg border-white/10">
                                <CardContent className="p-4">
                                    <div className="text-sm text-gray-400">Avg. Ratio</div>
                                    <div className="text-2xl font-bold text-yellow-400">
                                        {Math.round(liquidationData.reduce((sum, vault) => sum + vault.collateralRatio, 0) / liquidationData.length)}%
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Liquidation Table */}
                        <Card className="bg-white/5 backdrop-blur-lg border-white/10">
                            <CardHeader>
                                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                                    <AlertTriangle className="h-5 w-5 text-red-400" />
                                    Liquidatable Vaults
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-white/10">
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Vault ID</th>
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Owner</th>
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Collateral</th>
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Debt</th>
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Ratio</th>
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Reward</th>
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Time Left</th>
                                                <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {liquidationData.map((vault) => (
                                                <tr key={vault.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                    <td className="py-4 px-4">
                                                        <div className="font-mono text-sm text-blue-400">{vault.id}</div>
                                                    </td>
                                                    <td className="py-4 px-4">
                                                        <div className="font-mono text-xs text-gray-400">
                                                            {vault.owner.slice(0, 6)}...{vault.owner.slice(-4)}
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4">
                                                        <div className="text-white font-medium">{vault.collateralETH} ETH</div>
                                                        <div className="text-xs text-gray-400">
                                                            ≈ ${(parseFloat(vault.collateralETH) * parseFloat(vaultData.ethPrice || "2450")).toLocaleString()}
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4">
                                                        <div className="text-white font-medium">${vault.debtMyUSD}</div>
                                                    </td>
                                                    <td className="py-4 px-4">
                                                        <div className={`font-bold ${getRiskColor(vault.collateralRatio)}`}>
                                                            {vault.collateralRatio}%
                                                        </div>
                                                        <div className="w-16 mt-1">
                                                            <Progress
                                                                value={Math.min(vault.collateralRatio, 200)}
                                                                max={200}
                                                                className="h-1"
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4">
                                                        <div className="text-green-400 font-bold">${vault.liquidationReward}</div>
                                                        <div className="text-xs text-gray-400">
                                                            {((parseFloat(vault.liquidationReward) / parseFloat(vault.debtMyUSD.replace(",", ""))) * 100).toFixed(1)}%
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-4">
                                                        <div className="text-red-400 font-medium">{vault.timeToLiquidation}</div>
                                                        <Badge className={`${getRiskBadgeColor(vault.riskLevel)} text-xs mt-1`}>
                                                            {vault.riskLevel}
                                                        </Badge>
                                                    </td>
                                                    <td className="py-4 px-4">
                                                        <Button
                                                            size="sm"
                                                            className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white font-semibold"
                                                        >
                                                            Liquidate
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
            {/* Action Modals - ADD THESE AT THE END */}
            <ActionModal
                isOpen={activeModal === "deposit"}
                onClose={closeModal}
                title="Deposit Collateral"
                action="Deposit"
                amount={actionAmounts.depositAmount}
                setAmount={(amount) => setActionAmounts(prev => ({ ...prev, depositAmount: amount }))}
                onSubmit={() => depositCollateral(actionAmounts.depositAmount)}
                isLoading={actionLoading.deposit}
                maxAmount={(parseFloat(walletBalances.ethBalance) - 0.01).toFixed(4)}
                unit="ETH"
                validateAmount={validateDepositAmount}
            />

            <ActionModal
                isOpen={activeModal === "withdraw"}
                onClose={closeModal}
                title="Withdraw Collateral"
                action="Withdraw"
                amount={actionAmounts.withdrawAmount}
                setAmount={(amount) => setActionAmounts(prev => ({ ...prev, withdrawAmount: amount }))}
                onSubmit={() => withdrawCollateral(actionAmounts.withdrawAmount)}
                isLoading={actionLoading.withdraw}
                maxAmount={vaultData.collateral}
                unit="ETH"
                validateAmount={validateWithdrawAmount}
            />

            <ActionModal
                isOpen={activeModal === "mint"}
                onClose={closeModal}
                title="Mint MyUSD"
                action="Mint"
                amount={actionAmounts.mintAmount}
                setAmount={(amount) => setActionAmounts(prev => ({ ...prev, mintAmount: amount }))}
                onSubmit={() => mintMyUSD(actionAmounts.mintAmount)}
                isLoading={actionLoading.mint}
                maxAmount={vaultData.maxMintable}
                unit="MyUSD"
                validateAmount={validateMintAmount}
            />

            <ActionModal
                isOpen={activeModal === "repay"}
                onClose={closeModal}
                title="Repay Debt"
                action="Repay"
                amount={actionAmounts.repayAmount}
                setAmount={(amount) => setActionAmounts(prev => ({ ...prev, repayAmount: amount }))}
                onSubmit={() => repayDebt(actionAmounts.repayAmount)}
                isLoading={actionLoading.repay}
                maxAmount={Math.min(parseFloat(walletBalances.usdBalance), parseFloat(vaultData.updatedDebt)).toFixed(2)}
                unit="MyUSD"
                validateAmount={validateRepayAmount}
            />
        </div>
    )
}