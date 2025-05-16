pragma solidity ^0.8.28;
import { USDToken } from "./USDToken.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract VaultManager is ReentrancyGuard {
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
        require((vaults[msg.sender].collateralETH * ethPrice / 1e18) >= ((vaults[msg.sender].debtMyUSD + amount) * 150 / 100), "Not enough collateral");

        usdToken.mint(msg.sender, amount);
        vaults[msg.sender].debtMyUSD += amount;
        emit USDTokenMinted(msg.sender, amount);

    }

    function burn(uint256 amount) public {
        require(amount > 0, "Amount must be > 0");
        require(vaults[msg.sender].debtMyUSD >= amount, "Not enough debt");
        require((usdToken.balanceOf(msg.sender) >= amount), "Insufficient token balance");
        
   
        usdToken.burn(msg.sender, amount);
        vaults[msg.sender].debtMyUSD -= amount;
        emit USDTokenBurned(msg.sender, amount);

    }

    function withdrawCollateral(uint256 amount) public nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(vaults[msg.sender].collateralETH >= amount, "Not enough collateral to withdraw");
        require(((vaults[msg.sender].collateralETH - amount) * ethPrice / 1e18) >= (vaults[msg.sender].debtMyUSD * 150 / 100), "Withdrawing would cause debt to be undercollateralised");

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");

        vaults[msg.sender].collateralETH -= amount;
        emit CollateralWithdrawn(msg.sender, amount);
    

    }

    function liquidate(address user, uint256 repayAmount) public nonReentrant { // repayAmount in USDTKN
        uint256 ethReward = repayAmount * bonusPercent * 1e18 / ethPrice / 100;

        require(((vaults[user].collateralETH * ethPrice / 1e18) < (vaults[user].debtMyUSD * 150 / 100)), "Vault not undercollateralised");
        require(ethReward <= vaults[user].collateralETH, "Not enough ETH in vault");
        require(repayAmount > 0, "Amount must be > 0");
        require(repayAmount <= vaults[user].debtMyUSD, "Cannot repay more than debt");

        usdToken.transferFrom(msg.sender, address(this), repayAmount);
    
        (bool ethTransferSuccess, ) = msg.sender.call{value: ethReward}("");
        require(ethTransferSuccess, "ETH transfer failed");

        usdToken.burn(address(this), repayAmount);
        vaults[user].collateralETH -= ethReward;
        vaults[user].debtMyUSD -= repayAmount;
        emit CollateralLiquidated(user, msg.sender, repayAmount, ethReward);

   
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