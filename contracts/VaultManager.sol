pragma solidity ^0.8.28;
import { USDToken } from "./USDToken.sol";



contract VaultManager {
    struct Vault {
    uint256 collateralETH; // ETH locked by user (in wei)
    uint256 debtMyUSD;     // MyUSD minted by user (18 decimals)
    }
    uint256 public constant ethPrice = 2000e18;
    uint256 public constant bonusPercent = 105;

    mapping(address => Vault) public vaults;
    event CollateralDeposited(address indexed _to, uint256 amount);
    event CollateralWithdrawn(address indexed _from, uint256 amount);
    event CollateralLiquidated(address indexed user, address indexed liquidator, uint256 repayAmount, uint256 ethReward);

    event USDTokenMinted(address indexed _from, uint256 amount);
    event USDTokenBurned(address indexed _from, uint256 amount);

    error NotEnoughCollateral(address caller);
    error NotEnoughDebt(address caller);
    error InsufficientTokenBalance(address caller);

    error WithdrawFailed(address caller);
    error LiquidateFailed(address caller);
    error TokenTransferFailed(address caller);
    error EthTransferFailed(address caller);


    USDToken public immutable usdToken;

    constructor(address _usdToken) {
        usdToken = USDToken(_usdToken);
    }

    function depositCollateral() public payable {
        vaults[msg.sender].collateralETH += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    function mint(uint256 amount) public {
        require(amount > 0, "Amount must be > 0");
        if ((vaults[msg.sender].collateralETH * ethPrice / 1e18) >= ((vaults[msg.sender].debtMyUSD + amount) * 150 / 100)) {
            usdToken.mint(msg.sender, amount);
            vaults[msg.sender].debtMyUSD += amount;
            emit USDTokenMinted(msg.sender, amount);
        } else {
            revert NotEnoughCollateral(msg.sender);
        }
    }

    function burn(uint256 amount) public {
        if (usdToken.balanceOf(msg.sender) < amount) {
            revert InsufficientTokenBalance(msg.sender);
        }

        require(amount > 0, "Amount must be > 0");
        if (vaults[msg.sender].debtMyUSD >= amount) {
            usdToken.burn(msg.sender, amount);
            vaults[msg.sender].debtMyUSD -= amount;
            emit USDTokenBurned(msg.sender, amount);
        } else {
            revert NotEnoughDebt(msg.sender);
        }
    }

    function withdrawCollateral(uint256 amount) public {
        require(amount > 0, "Amount must be > 0");
        require(vaults[msg.sender].collateralETH >= amount, "Not enough collateral to withdraw");

        if (((vaults[msg.sender].collateralETH - amount) * ethPrice / 1e18) >= (vaults[msg.sender].debtMyUSD * 150 / 100)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            if (!success) {
                revert WithdrawFailed(msg.sender);
            } else {
                vaults[msg.sender].collateralETH -= amount;
                emit CollateralWithdrawn(msg.sender, amount);
            }
        } else {
            revert NotEnoughCollateral(msg.sender);
        }
    }

    function liquidate(address user, uint256 repayAmount) public payable { // repayAmount in USDTKN
        uint256 ethReward = repayAmount * bonusPercent * 1e18 / ethPrice / 100;

        require(((vaults[user].collateralETH * ethPrice / 1e18) < (vaults[user].debtMyUSD * 150 / 100)), "Vault not undercollateralised");
        require(ethReward <= vaults[user].collateralETH, "Not enough ETH in vault");
        require(repayAmount > 0, "Amount must be > 0");
        require(repayAmount <= vaults[user].debtMyUSD, "Cannot repay more than debt");


        usdToken.transferFrom(msg.sender, address(this), repayAmount);
    
        (bool ethTransferSuccess, ) = msg.sender.call{value: ethReward}("");
        if (!ethTransferSuccess) {
            revert EthTransferFailed(msg.sender);
        } else {
            usdToken.burn(address(this), repayAmount);
            vaults[user].collateralETH -= ethReward;
            vaults[user].debtMyUSD -= repayAmount;
            emit CollateralLiquidated(user, msg.sender, repayAmount, ethReward);

        }  
    }

    function getVault(address user) external view returns (uint256 collateralETH, uint256 debtMyUSD) {
        Vault memory vault = vaults[user];
        return (vault.collateralETH, vault.debtMyUSD);
    }       

    function getCollateralRatio(address user) external view returns (uint256 ratio) {
        Vault memory vault = vaults[user];
        if (vault.debtMyUSD == 0) return type(uint256).max;
        uint256 collateralUSD = vault.collateralETH * ethPrice / 1e18;
        return collateralUSD * 1e18 / vault.debtMyUSD;
    }


}