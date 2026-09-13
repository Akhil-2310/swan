// SPDX-License-Identifier: Apache-2.0

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ComplianceAuction", function () {
  async function fixture() {
    const [owner, reviewer, router, seller, bidderA, bidderB, blocked, lender] = await ethers.getSigners();
    const Security = await ethers.getContractFactory("MockATSSecurity");
    const security = await Security.deploy();
    const Cash = await ethers.getContractFactory("MockTestCash");
    const cash = await Cash.deploy();
    const Oracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await Oracle.deploy();
    await oracle.setPrice(await security.getAddress(), 100_000n);
    const Auction = await ethers.getContractFactory("ComplianceAuction");
    const market = await Auction.deploy(
      reviewer.address,
      router.address,
      await cash.getAddress(),
      await oracle.getAddress(),
    );
    await Promise.all([security.waitForDeployment(), cash.waitForDeployment(), market.waitForDeployment()]);

    const marketAddress = await market.getAddress();
    for (const account of [seller, bidderA, bidderB, lender]) await security.setKyc(account.address, true);
    await security.setKyc(marketAddress, true);
    await security.mint(seller.address, 100n);
    await security.connect(seller).approve(marketAddress, 100n);
    for (const bidder of [bidderA, bidderB, blocked]) {
      await cash.mint(bidder.address, 2_000_000n);
      await cash.connect(bidder).approve(marketAddress, 2_000_000n);
    }

    return { owner, reviewer, router, seller, bidderA, bidderB, blocked, lender, security, cash, oracle, market };
  }

  async function listVoluntary(context, overrides = {}) {
    const now = await time.latest();
    const deadline = overrides.deadline ?? now + 60;
    const quantity = overrides.quantity ?? 10n;
    await context.market
      .connect(context.seller)
      .createVoluntaryAuction(
        await context.security.getAddress(),
        await context.cash.getAddress(),
        quantity,
        overrides.reserve ?? 950_000n,
        deadline,
        overrides.oracle ?? 100_000n * quantity,
        overrides.tolerance ?? 1_500,
      );
    return { auctionId: 1n, deadline };
  }

  it("rejects a non-KYC bidder before cash is funded", async function () {
    const context = await fixture();
    const { auctionId } = await listVoluntary(context);
    await expect(context.market.connect(context.blocked).bid(auctionId, 980_000n))
      .to.be.revertedWithCustomError(context.market, "KycNotGranted")
      .withArgs(context.blocked.address);
    expect(await context.cash.balanceOf(context.blocked.address)).to.equal(2_000_000n);
  });

  it("selects the highest eligible bid, settles atomically, and refunds the loser", async function () {
    const context = await fixture();
    const { auctionId, deadline } = await listVoluntary(context);
    await context.market.connect(context.bidderA).bid(auctionId, 980_000n);
    await context.market.connect(context.bidderB).bid(auctionId, 1_040_000n);
    await time.increaseTo(deadline);
    await context.market.close(auctionId);
    await context.market.settle(auctionId);

    expect(await context.security.balanceOf(context.bidderB.address)).to.equal(10n);
    expect(await context.cash.balanceOf(context.seller.address)).to.equal(1_040_000n);
    await expect(context.market.connect(context.bidderA).withdrawRefund(auctionId))
      .to.emit(context.market, "BidRefundWithdrawn")
      .withArgs(auctionId, context.bidderA.address, 980_000n);
    expect(await context.cash.balanceOf(context.bidderA.address)).to.equal(2_000_000n);
  });

  it("does not move either DvP leg when the cash leg fails", async function () {
    const context = await fixture();
    const { auctionId, deadline } = await listVoluntary(context);
    await context.market.connect(context.bidderA).bid(auctionId, 980_000n);
    await time.increaseTo(deadline);
    await context.market.close(auctionId);
    await context.cash.setBlockedRecipient(context.seller.address, true);

    await expect(context.market.settle(auctionId)).to.be.revertedWithCustomError(context.market, "CashTransferFailed");
    expect(await context.security.balanceOf(context.bidderA.address)).to.equal(0n);
    expect(await context.security.balanceOf(await context.market.getAddress())).to.equal(10n);
    expect((await context.market.auctions(auctionId)).state).to.equal(2n);
  });

  it("rechecks ATS pause and freeze controls at settlement", async function () {
    const context = await fixture();
    const { auctionId, deadline } = await listVoluntary(context);
    await context.market.connect(context.bidderA).bid(auctionId, 980_000n);
    await time.increaseTo(deadline);
    await context.market.close(auctionId);
    await context.security.setPaused(true);
    await expect(context.market.settle(auctionId)).to.be.revertedWithCustomError(context.market, "SecurityPaused");
    await context.security.setPaused(false);
    await context.security.setFrozen(context.bidderA.address, true);
    await expect(context.market.settle(auctionId))
      .to.be.revertedWithCustomError(context.market, "AccountFrozen")
      .withArgs(context.bidderA.address);
  });

  it("requires compliance review for an out-of-band oracle price", async function () {
    const context = await fixture();
    const { auctionId, deadline } = await listVoluntary(context);
    await context.market.connect(context.bidderA).bid(auctionId, 1_200_000n);
    await time.increaseTo(deadline);
    await context.market.close(auctionId);
    await expect(context.market.settle(auctionId)).to.be.revertedWithCustomError(
      context.market,
      "OracleReviewRequired",
    );
    await expect(context.market.connect(context.reviewer).approveOracleException(auctionId)).to.emit(
      context.market,
      "OracleExceptionApproved",
    );
    await expect(context.market.settle(auctionId)).to.emit(context.market, "AuctionSettled");
  });

  it("returns the lot and makes cash refundable when reserve is not met", async function () {
    const context = await fixture();
    const { auctionId, deadline } = await listVoluntary(context);
    await context.market.connect(context.bidderA).bid(auctionId, 900_000n);
    await time.increaseTo(deadline);
    await expect(context.market.close(auctionId)).to.emit(context.market, "AuctionFailedNoValidBid");
    expect(await context.security.balanceOf(context.seller.address)).to.equal(100n);
    await context.market.connect(context.bidderA).withdrawRefund(auctionId);
    expect(await context.cash.balanceOf(context.bidderA.address)).to.equal(2_000_000n);
  });

  it("routes liquidation proceeds to the lender through the same engine", async function () {
    const context = await fixture();
    const now = await time.latest();
    const deadline = now + 60;
    await expect(
      context.market
        .connect(context.router)
        .createLiquidationAuction(
          await context.security.getAddress(),
          await context.cash.getAddress(),
          context.seller.address,
          context.lender.address,
          10n,
          950_000n,
          deadline,
          1_000_000n,
          1_500,
        ),
    ).to.emit(context.market, "AuctionListed");
    await context.market.connect(context.bidderA).bid(1n, 1_000_000n);
    await time.increaseTo(deadline);
    await context.market.close(1n);
    await context.market.settle(1n);
    expect(await context.cash.balanceOf(context.lender.address)).to.equal(1_000_000n);
    expect(await context.cash.balanceOf(context.seller.address)).to.equal(0n);
  });

  it("prevents listing unavailable or already committed units", async function () {
    const context = await fixture();
    await listVoluntary(context, { quantity: 60n });
    const deadline = (await time.latest()) + 60;
    await expect(
      context.market
        .connect(context.seller)
        .createVoluntaryAuction(
          await context.security.getAddress(),
          await context.cash.getAddress(),
          41n,
          1n,
          deadline,
          4_100_000n,
          1_500,
        ),
    ).to.be.revertedWithCustomError(context.market, "InsufficientSecurityBalance");
  });

  it("rejects an unauthenticated auction reference price", async function () {
    const context = await fixture();
    const now = await time.latest();
    await expect(
      context.market
        .connect(context.seller)
        .createVoluntaryAuction(
          await context.security.getAddress(),
          await context.cash.getAddress(),
          10n,
          900_000n,
          now + 60,
          999_999n,
          1_500,
        ),
    ).to.be.revertedWithCustomError(context.market, "OraclePriceMismatch");
  });

  it("normalizes ATS token decimals when authenticating a lot price", async function () {
    const context = await fixture();
    await context.security.setDecimals(6);
    await context.security.mint(context.seller.address, 2_000_000n);
    await context.security.connect(context.seller).approve(await context.market.getAddress(), 2_000_000n);
    await context.oracle.setPrice(await context.security.getAddress(), 6_000_000n);
    const deadline = (await time.latest()) + 60;
    await context.market
      .connect(context.seller)
      .createVoluntaryAuction(
        await context.security.getAddress(),
        await context.cash.getAddress(),
        2_000_000n,
        10_000_000n,
        deadline,
        12_000_000n,
        1_500,
      );
    expect((await context.market.auctions(1)).oraclePrice).to.equal(12_000_000n);
  });

  it("supports ATS securities whose internal KYC module is intentionally disabled", async function () {
    const context = await fixture();
    await context.security.setInternalKycActivated(false);
    const now = await time.latest();
    await context.market
      .connect(context.seller)
      .createVoluntaryAuction(
        await context.security.getAddress(),
        await context.cash.getAddress(),
        10n,
        950_000n,
        now + 60,
        1_000_000n,
        1_500,
      );
    await expect(context.market.connect(context.blocked).bid(1, 980_000n)).to.emit(context.market, "BidFunded");
  });
});
