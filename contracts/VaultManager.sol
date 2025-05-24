pragma solidity ^0.8.28;
import { USDToken } from "./USDToken.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract VaultManager is ReentrancyGuard {
    struct Vault {
    uint256 collateralETH; // ETH locked by user (in wei)
    uint256 debtMyUSD;     // MyUSD minted by user (18 decimals)
    bool zeroLiquidation; // is zero liquidation toggled
    }

    AggregatorV3Interface internal priceFeed;


    
    uint256 public constant bonusPercent = 105;

    mapping(address => Vault) public vaults;

    event CollateralDeposited(address indexed _to, uint256 amount);
    event CollateralWithdrawn(address indexed _from, uint256 amount);
    event CollateralLiquidated(address indexed user, address indexed liquidator, uint256 repayAmount, uint256 ethReward);

    event USDTokenMinted(address indexed _from, uint256 amount);
    event USDTokenBurned(address indexed _from, uint256 amount);

    event ZeroLiquidationEnabled(address indexed user);
    event ZeroLiquidationDisabled(address indexed user);

    USDToken public immutable usdToken;
    uint256 public constant STANDARD_COLLATERAL_RATIO = 150e16; // 150%
    uint256 public constant ZERO_LIQUIDATION_COLLATERAL_RATIO = 250e16; // 250%

    uint8 public priceDecimals;




    constructor(address _usdToken, address _priceFeed) {
        usdToken = USDToken(_usdToken);
        priceFeed = AggregatorV3Interface(_priceFeed);
        priceDecimals = priceFeed.decimals();
    }


    function getLatestPrice() public view returns (uint256) {
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        return uint256(price);
    }

    function depositCollateral() public payable {
        vaults[msg.sender].collateralETH += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    function mint(uint256 amount) public {
        require(amount > 0, "Amount must be > 0");

        Vault storage vault = vaults[msg.sender];
        uint256 ethPrice = getLatestPrice();
        // uint256 collateralValue = vault.collateralETH * ethPrice / 1e18;
        uint256 collateralValue = vault.collateralETH * ethPrice / 10 ** priceDecimals;

        uint256 newDebt = vault.debtMyUSD + amount;
        uint256 collateralRatio = vault.zeroLiquidation ? ZERO_LIQUIDATION_COLLATERAL_RATIO : STANDARD_COLLATERAL_RATIO;
        require((collateralValue * 1e18) / newDebt >= collateralRatio, "Not enough collateral"); // Ensure collateral ratio (scaled by 1e18) meets required minimum

        usdToken.mint(msg.sender, amount);
        vault.debtMyUSD += amount;
        emit USDTokenMinted(msg.sender, amount);
    }

    function burn(uint256 amount) public {
        Vault storage vault = vaults[msg.sender];
        require(amount > 0, "Amount must be > 0");
        require(vault.debtMyUSD >= amount, "Not enough debt");
        require((usdToken.balanceOf(msg.sender) >= amount), "Insufficient token balance");
        
   
        usdToken.burn(msg.sender, amount);
        vault.debtMyUSD -= amount;
        emit USDTokenBurned(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) public nonReentrant {
        Vault storage vault = vaults[msg.sender];
        uint256 ethPrice = getLatestPrice();
        require(amount > 0, "Amount must be > 0");
        require(vault.collateralETH >= amount, "Not enough collateral to withdraw");

        uint256 newCollateral = vault.collateralETH - amount;
        uint256 newCollateralValue = newCollateral * ethPrice / 10 ** priceDecimals;
        uint256 collateralRatio = vault.zeroLiquidation ? ZERO_LIQUIDATION_COLLATERAL_RATIO : STANDARD_COLLATERAL_RATIO;
        
        if (vault.debtMyUSD > 0) {
            require((newCollateralValue * 1e18) / vault.debtMyUSD >= collateralRatio, "Withdrawing would cause debt to be undercollateralised");
        }

        vault.collateralETH -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit CollateralWithdrawn(msg.sender, amount);  
    }

    function liquidate(address user, uint256 repayAmount) public nonReentrant { // repayAmount in USDTKN
        Vault storage vault = vaults[user];
        uint256 ethPrice = getLatestPrice();
        require(!vault.zeroLiquidation, "Zero Liquidation vault cannot be liquidated");

        uint256 ethReward = repayAmount * bonusPercent * 10 ** priceDecimals / ethPrice / 100;
        uint256 collateralValue = vault.collateralETH * ethPrice / 10 ** priceDecimals;

        require(vault.debtMyUSD > 0, "Vault has no debt");
        require(((collateralValue * 1e18) / vault.debtMyUSD < STANDARD_COLLATERAL_RATIO), "Vault not undercollateralised");
        require(ethReward <= vault.collateralETH, "Not enough ETH in vault");
        require(repayAmount > 0, "Amount must be > 0");
        require(repayAmount <= vault.debtMyUSD, "Cannot repay more than debt");

        usdToken.transferFrom(msg.sender, address(this), repayAmount);
    
        (bool ethTransferSuccess, ) = msg.sender.call{value: ethReward}("");
        require(ethTransferSuccess, "ETH transfer failed");

        usdToken.burn(address(this), repayAmount);
        vault.collateralETH -= ethReward;
        vault.debtMyUSD -= repayAmount;
        emit CollateralLiquidated(user, msg.sender, repayAmount, ethReward);

   
    }

    function getVault(address user) external view returns (uint256 collateralETH, uint256 debtMyUSD, bool zeroLiquidation) {
        Vault memory vault = vaults[user];
        return (vault.collateralETH, vault.debtMyUSD, vault.zeroLiquidation);
    }       

    function getCollateralRatio(address user) public view returns (uint256 ratio) {
        // returns current collateral ratio of vault
        Vault memory vault = vaults[user];
        uint256 ethPrice = getLatestPrice();
        if (vault.debtMyUSD == 0) return type(uint256).max;
        uint256 collateralUSD = vault.collateralETH * ethPrice / 10 ** priceDecimals;
        return collateralUSD * 1e18 / vault.debtMyUSD;
    }

    function enableZeroLiquidation() public {
        Vault storage vault = vaults[msg.sender];
        uint256 ethPrice = getLatestPrice();
        uint256 collateralValue = vault.collateralETH * ethPrice / 10 ** priceDecimals;
        require(!vault.zeroLiquidation, "Vault already has Zero Liquidation enabled");
        require(vault.debtMyUSD > 0, "Vault has no debt");
        require((collateralValue * 1e18) / vault.debtMyUSD >= ZERO_LIQUIDATION_COLLATERAL_RATIO, "Not enough collateral");
        vault.zeroLiquidation = true;
        emit ZeroLiquidationEnabled(msg.sender);
    }

    function disableZeroLiquidation() public {
        Vault storage vault = vaults[msg.sender];
        uint256 ethPrice = getLatestPrice();
        uint256 collateralValue = vault.collateralETH * ethPrice / 10 ** priceDecimals;
        require(vault.zeroLiquidation, "Vault does not have Zero Liquidation enabled");
        require(vault.debtMyUSD > 0, "Vault has no debt");
        require((collateralValue * 1e18) / vault.debtMyUSD >= STANDARD_COLLATERAL_RATIO, "Not enough collateral");
        vault.zeroLiquidation = false;
        emit ZeroLiquidationDisabled(msg.sender);
    }
   


// remove before deployment
    function test_setVault(address user, uint256 collateralETH, uint256 debtMyUSD) external {
        vaults[user] = Vault(collateralETH, debtMyUSD, false);
    }

    function test_setZLVault(address user, uint256 collateralETH, uint256 debtMyUSD) external {
        vaults[user] = Vault(collateralETH, debtMyUSD, true);
    }

    function test_liquidateWithoutRewardCheck(address user, uint256 repayAmount) public nonReentrant {
    // No undercollateralised check here
        uint256 ethPrice = getLatestPrice();
        uint256 ethReward = repayAmount * bonusPercent * 10 ** priceDecimals / ethPrice / 100;

        require(((vaults[user].collateralETH * ethPrice / 10 ** priceDecimals) < (vaults[user].debtMyUSD * 150 / 100)), "Vault not undercollateralised");
        // require(ethReward <= vaults[user].collateralETH, "Not enough ETH in vault");
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



}