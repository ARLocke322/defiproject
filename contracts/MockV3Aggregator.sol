// contracts/test/MockV3Aggregator.sol
pragma solidity ^0.8.28;
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MockV3Aggregator is AggregatorV3Interface {
    int256 public price;
    uint8 public override decimals = 8;

    constructor(int256 _initialPrice) {
        price = _initialPrice;
    }

    function latestRoundData() external view override returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (0, price, 0, 0, 0);
    }

    function getRoundData(uint80) external view override returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (0, price, 0, 0, 0);
    }

    function description() external pure override returns (string memory) {
        return "Mock ETH/USD";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }
}
