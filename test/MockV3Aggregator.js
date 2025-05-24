const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockV3Aggregator", function () {
  let mockFeed;

  beforeEach(async function () {
    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    mockFeed = await MockV3Aggregator.deploy(2000e8); // Initial price: $2000
    await mockFeed.waitForDeployment();
  });

  it("should return the correct initial price", async function () {
    const data = await mockFeed.latestRoundData();
    const price = data[1];
    expect(price).to.equal(2000e8);
  });

  it("should have 8 decimals", async function () {
    const decimals = await mockFeed.decimals();
    expect(decimals).to.equal(8);
  });
});
