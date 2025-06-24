pragma solidity ^0.8.28;
import { USDToken } from "./USDToken.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "prb-math/contracts/PRBMathUD60x18.sol";


contract VaultManager is ReentrancyGuard, Ownable, Pausable {
    struct Vault {
    uint256 collateralETH; // ETH locked by user (in wei)
    uint256 debtMyUSD;     // MyUSD minted by user (18 decimals)
    bool zeroLiquidation; // is zero liquidation toggled
    uint256 lastIndex;
    }

    using PRBMathUD60x18 for uint256;

    uint256 public totalCollateralETH = 0;
    uint256 public totalDebtMyUSD = 0;

    AggregatorV3Interface internal priceFeed;
    uint256 public COLLATERAL_FLOOR = 10e18; // $10 in 18 decimals
    uint256 public constant SECONDS_IN_YEAR = 31536000;
    uint256 public INTEREST_RATE = 1000000001585489000;

    uint256 public REBALANCE_INTERVAL = 43200; // 12 hours
    uint256 public lastRebalance = block.timestamp;

    
    uint256 public BONUS_PERCENT = 105e16;

    mapping(address => Vault) public vaults;

    event CollateralDeposited(address indexed _to, uint256 amount);
    event CollateralWithdrawn(address indexed _from, uint256 amount);
    event CollateralLiquidated(address indexed user, address indexed liquidator, uint256 repayAmount, uint256 ethReward);

    event USDTokenMinted(address indexed _from, uint256 amount);
    event USDTokenBurned(address indexed _from, uint256 amount);

    event ZeroLiquidationEnabled(address indexed user);
    event ZeroLiquidationDisabled(address indexed user);

    event RebalancingEnabledUpdated(bool enabled);

    event CollateralRatiosUpdated(uint256 standard, uint256 zeroLiquidation);
    event CollateralFloorUpdated(uint256 newFloor);
    event BonusPercentUpdated(uint256 newBonus);
    event InterestRateUpdated(uint256 newRate);


    event FeeCollected(address indexed user, uint256 amount, uint256 fee);

    USDToken public immutable usdToken;
    uint256 public STANDARD_COLLATERAL_RATIO = 150e16; // 150%
    uint256 public ZERO_LIQUIDATION_COLLATERAL_RATIO = 250e16; // 250%

    uint8 public priceDecimals;
    uint256 public debtIndex = 1e18; // start at 1.0 in fixed point
    uint256 public lastIndexUpdate; // timestamp of last update

    bool public rebalancingEnabled = true;

    address public treasury;
    uint256 public mintFee = 5e15; // 0.5%






    constructor(address _usdToken, address _priceFeed, address _admin, address _treasury) Ownable(_admin) {
        usdToken = USDToken(_usdToken);
        priceFeed = AggregatorV3Interface(_priceFeed);
        priceDecimals = priceFeed.decimals();
        lastIndexUpdate = block.timestamp;
        treasury = _treasury;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid address");
        treasury = newTreasury;
    }

    function setMintFee(uint256 newFee) external onlyOwner {
        require(newFee >= 0, "Fee must be >= 0"); 
        mintFee = newFee;
    }

    function getMintFee() public view returns (uint256) {
        return mintFee;
    }

    function getLatestPrice() public view returns (uint256) {
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        return uint256(price);
    }

    function isAboveCollateralFloor(uint256 ethAmount) public view returns (bool) {
        if (ethAmount == 0) {
            return true;
        }
        uint256 ethPrice = getLatestPrice(); // 8 decimals
        uint256 collateralUSD = ethAmount * ethPrice / 1e8;
        return collateralUSD >= COLLATERAL_FLOOR;
    }

    function setCollateralFloor(uint256 newFloor) external onlyOwner { 
        COLLATERAL_FLOOR = newFloor;
        emit CollateralFloorUpdated(newFloor);
    }

    function setCollateralRatios(uint256 _standard, uint256 _zero) external onlyOwner {
        require(_standard >= 1e18, "Too low");
        require(_zero >= _standard, "ZL must be stricter");
        STANDARD_COLLATERAL_RATIO = _standard;
        ZERO_LIQUIDATION_COLLATERAL_RATIO = _zero;
        emit CollateralRatiosUpdated(_standard, _zero);
    }

    function setBonusPercent(uint256 newBonus) external onlyOwner {
        require(newBonus >= 1e18, "Must be >= 100");
        BONUS_PERCENT = newBonus;
        emit BonusPercentUpdated(newBonus);
    }

    function setInterestRate(uint256 newRate) external onlyOwner {
        // interest rate per second
        require(newRate <= 2e18, "Rate must be <= 2.0");
        require(newRate >= 1e18, "Rate must be >= 1.0");
        updateDebtIndex();
        INTEREST_RATE = newRate;
        emit InterestRateUpdated(newRate);
    }

    function setRebalancingEnabled(bool enabled) external onlyOwner {
        rebalancingEnabled = enabled;
        emit RebalancingEnabledUpdated(enabled);
    }


    function updateDebtIndex() public {
        uint256 timeElapsed = block.timestamp - lastIndexUpdate;
        if (timeElapsed == 0) return;
        
        if (timeElapsed > SECONDS_IN_YEAR) {
            timeElapsed = SECONDS_IN_YEAR;
        }
        debtIndex = debtIndex.mul(PRBMathUD60x18.powu(INTEREST_RATE, timeElapsed));
        lastIndexUpdate = block.timestamp;
    }

    function getCurrentIndex() public view returns (uint256) {
        uint256 timeElapsed = block.timestamp - lastIndexUpdate;
        if (timeElapsed == 0) return debtIndex;
        if (timeElapsed > SECONDS_IN_YEAR) {
            timeElapsed = SECONDS_IN_YEAR;
        }
        return debtIndex.mul(PRBMathUD60x18.powu(INTEREST_RATE, timeElapsed));
    }

    function getUpdatedDebt(address user) public view returns (uint256) {
        Vault memory vault = vaults[user];
        if (vault.debtMyUSD == 0) return 0;

        uint256 timeElapsed = block.timestamp - lastIndexUpdate;
        uint256 currentIndex = debtIndex;

        if (timeElapsed > 0) {
            currentIndex = currentIndex.mul(PRBMathUD60x18.powu(INTEREST_RATE, timeElapsed));
        }

        return vault.debtMyUSD.mul(currentIndex).div(vault.lastIndex);
    }


    function _accrueInterest(address user) internal {
        updateDebtIndex();
        Vault storage vault = vaults[user];
        if (vault.debtMyUSD > 0) {
            vault.debtMyUSD = getUpdatedDebt(user); // updates the actual number
        }
        vault.lastIndex = debtIndex; // reset snapshot
    }

    function getAnnualRate() public view returns (uint256) {
        return PRBMathUD60x18.powu(INTEREST_RATE, SECONDS_IN_YEAR);
    }


    function _rebalanceInterestRate() internal {
        if (!rebalancingEnabled) return;
        if (block.timestamp - lastRebalance >= REBALANCE_INTERVAL) {
            uint256 globalCollateralRatio = calculateGlobalCollateralRatio();
            uint256 newRate;
            if (globalCollateralRatio >= 2e18) {
                newRate = 1000000000937303470;
            } else if (globalCollateralRatio >= 1.8e18) {
                newRate = 1000000001243680656;
            } else if (globalCollateralRatio >= 1.6e18) {
                newRate = 1000000001395766281;
            } else if (globalCollateralRatio >= 1.4e18) {
                newRate = 1000000001547125957;
            } else if (globalCollateralRatio >= 1.2e18) {
                newRate = 1000000001697766583;
            } else if (globalCollateralRatio >= 1e18) {
                newRate = 1000000001847694957;
            } else { // < 100
                newRate = 1000000002145441671;
            }
            INTEREST_RATE = newRate;
            lastRebalance = block.timestamp;
            emit InterestRateUpdated(newRate);
        }
    }

    function calculateGlobalCollateralRatio() public view returns (uint256) {
        if (totalDebtMyUSD == 0) {
            return type(uint256).max; // Effectively infinite ratio if no debt exists
        }
        uint256 ethPrice = getLatestPrice(); // e.g. 2000 USD with 8 decimals
        uint256 collateralValueUSD = totalCollateralETH * ethPrice / (10 ** priceDecimals);
        return collateralValueUSD * 1e18 / totalDebtMyUSD;
    }

    




    function depositCollateral() public payable whenNotPaused {
        Vault storage vault = vaults[msg.sender];
        require(isAboveCollateralFloor(msg.value + vault.collateralETH), "Must be above collateral floor");
        _rebalanceInterestRate();
        _accrueInterest(msg.sender);
        vault.collateralETH += msg.value;
        totalCollateralETH += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    function mint(uint256 amount) public whenNotPaused {
        require(amount > 0, "Amount must be > 0");

        Vault storage vault = vaults[msg.sender];
        _rebalanceInterestRate();
        _accrueInterest(msg.sender);
        
        uint256 ethPrice = getLatestPrice();
        // uint256 collateralValue = vault.collateralETH * ethPrice / 1e18;
        uint256 collateralValue = vault.collateralETH * ethPrice / 10 ** priceDecimals;

        uint256 fee = amount * mintFee / 1e18;

        uint256 newDebt = vault.debtMyUSD + amount + fee;
        uint256 collateralRatio = vault.zeroLiquidation ? ZERO_LIQUIDATION_COLLATERAL_RATIO : STANDARD_COLLATERAL_RATIO;
        require((collateralValue * 1e18) / newDebt >= collateralRatio, "Not enough collateral"); 

        
        usdToken.mint(msg.sender, amount);
        usdToken.mint(treasury, fee);

        vault.debtMyUSD = vault.debtMyUSD + amount + fee;
        totalDebtMyUSD = totalDebtMyUSD + amount + fee;

        emit FeeCollected(msg.sender, amount, fee);

        emit USDTokenMinted(msg.sender, amount);
    }

    function burn(uint256 amount) public whenNotPaused {
        Vault storage vault = vaults[msg.sender];
        _rebalanceInterestRate();
        _accrueInterest(msg.sender);
        require(amount > 0, "Amount must be > 0");
        require(vault.debtMyUSD >= amount, "Not enough debt");
        require((usdToken.balanceOf(msg.sender) >= amount), "Insufficient token balance");

        usdToken.burn(msg.sender, amount);
        vault.debtMyUSD -= amount;
        totalDebtMyUSD -= amount;
        emit USDTokenBurned(msg.sender, amount);
    }

    function repayAll() external whenNotPaused {
        uint256 updatedDebt = getUpdatedDebt(msg.sender);
        burn(updatedDebt);
    }


    function withdrawCollateral(uint256 amount) public nonReentrant whenNotPaused {
        Vault storage vault = vaults[msg.sender];
        _rebalanceInterestRate();
        _accrueInterest(msg.sender);
        uint256 ethPrice = getLatestPrice();

        
        require(amount > 0, "Amount must be > 0");
        require(vault.collateralETH >= amount, "Not enough collateral to withdraw");

        uint256 newCollateral = vault.collateralETH - amount;
        require(isAboveCollateralFloor(newCollateral), "Cannot go below collateral floor");
        uint256 newCollateralValue = newCollateral * ethPrice / 10 ** priceDecimals;
        uint256 collateralRatio = vault.zeroLiquidation ? ZERO_LIQUIDATION_COLLATERAL_RATIO : STANDARD_COLLATERAL_RATIO;
        
        if (vault.debtMyUSD > 0) {
            require((newCollateralValue * 1e18) / vault.debtMyUSD >= collateralRatio, "Withdrawing would cause debt to be undercollateralised");
        }

        vault.collateralETH -= amount;
        totalCollateralETH -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit CollateralWithdrawn(msg.sender, amount);  
    }

    function liquidate(address user, uint256 repayAmount) public nonReentrant whenNotPaused { // repayAmount in USDTKN
        Vault storage vault = vaults[user];
        _rebalanceInterestRate();
        _accrueInterest(user);
        uint256 ethPrice = getLatestPrice();
        require(!vault.zeroLiquidation, "Zero Liquidation vault cannot be liquidated");

        uint256 ethReward = repayAmount * BONUS_PERCENT * 10 ** priceDecimals / ethPrice / 1e18;
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
        totalCollateralETH -= ethReward;

        vault.debtMyUSD -= repayAmount;
        totalDebtMyUSD -= repayAmount;
        emit CollateralLiquidated(user, msg.sender, repayAmount, ethReward);

   
    }

    function getVault(address user) external view returns (uint256 collateralETH, uint256 debtMyUSD, bool zeroLiquidation, uint256 lastIndex) {
        Vault memory vault = vaults[user];
        return (vault.collateralETH, vault.debtMyUSD, vault.zeroLiquidation, vault.lastIndex);
    }


       

    function getCollateralRatio(address user) public view returns (uint256 ratio) {
        // returns current collateral ratio of vault
        Vault memory vault = vaults[user];
        uint256 ethPrice = getLatestPrice();
        if (vault.debtMyUSD == 0) return type(uint256).max;
        uint256 collateralUSD = vault.collateralETH * ethPrice / 10 ** priceDecimals;
        return collateralUSD * 1e18 / vault.debtMyUSD;
    }

    function enableZeroLiquidation() public whenNotPaused {
        Vault storage vault = vaults[msg.sender];
        _rebalanceInterestRate();
        _accrueInterest(msg.sender);
        uint256 ethPrice = getLatestPrice();
        uint256 collateralValue = vault.collateralETH * ethPrice / 10 ** priceDecimals;
        require(!vault.zeroLiquidation, "Vault already has Zero Liquidation enabled");
        require(vault.debtMyUSD > 0, "Vault has no debt");
        require((collateralValue * 1e18) / vault.debtMyUSD >= ZERO_LIQUIDATION_COLLATERAL_RATIO, "Not enough collateral");
        vault.zeroLiquidation = true;
        emit ZeroLiquidationEnabled(msg.sender);
    }

    function disableZeroLiquidation() public whenNotPaused {
        Vault storage vault = vaults[msg.sender]; // 3 2000 true 1e18
        _rebalanceInterestRate();
        _accrueInterest(msg.sender); 
        uint256 ethPrice = getLatestPrice(); // 2000
        uint256 collateralValue = vault.collateralETH * ethPrice / 10 ** priceDecimals;
        require(vault.zeroLiquidation, "Vault does not have Zero Liquidation enabled");
        require(vault.debtMyUSD > 0, "Vault has no debt");
        require((collateralValue * 1e18) / vault.debtMyUSD >= STANDARD_COLLATERAL_RATIO, "Not enough collateral");
        vault.zeroLiquidation = false;
        emit ZeroLiquidationDisabled(msg.sender);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
   


// remove before deployment
    function test_setVault(address user, uint256 collateralETH, uint256 debtMyUSD) external {
        vaults[user] = Vault(collateralETH, debtMyUSD, false, debtIndex);
    
        totalCollateralETH += collateralETH;
        totalDebtMyUSD += debtMyUSD;
    }

    function test_setZLVault(address user, uint256 collateralETH, uint256 debtMyUSD) external {
        vaults[user] = Vault(collateralETH, debtMyUSD, true, debtIndex);
    }

    function test_liquidateWithoutRewardCheck(address user, uint256 repayAmount) public nonReentrant {
    // No undercollateralised check here
        uint256 ethPrice = getLatestPrice();
        uint256 ethReward = repayAmount * BONUS_PERCENT * 10 ** priceDecimals / ethPrice / 1e18;

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