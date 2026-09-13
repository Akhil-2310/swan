const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("RepoLifecycle", function () {
  async function fixture() {
    const [borrower, lenderA, lenderB, ineligible, oracleSigner, reviewer, bidder] = await ethers.getSigners();
    const Security = await ethers.getContractFactory("MockATSSecurity");
    const Cash = await ethers.getContractFactory("MockTestCash");
    const Repo = await ethers.getContractFactory("RepoLifecycle");
    const first = await Security.deploy();
    const second = await Security.deploy();
    const third = await Security.deploy();
    const cash = await Cash.deploy();
    const Oracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await Oracle.deploy();
    await oracle.setPrice(await first.getAddress(), 100_000);
    await oracle.setPrice(await second.getAddress(), 98_000);
    await oracle.setPrice(await third.getAddress(), 100_000);
    const repo = await Repo.deploy(await oracle.getAddress(), await cash.getAddress(), reviewer.address, 300);

    for (const security of [first, second, third]) {
      await security.mint(borrower.address, 20);
      await security.setKyc(borrower.address, true);
      await security.setKyc(await repo.getAddress(), true);
      await security.setKyc(lenderA.address, true);
      await security.setKyc(lenderB.address, true);
      await security.setKyc(bidder.address, true);
      await security.connect(borrower).approve(await repo.getAddress(), 20);
    }
    for (const lender of [lenderA, lenderB, ineligible, bidder]) {
      await cash.mint(lender.address, 3_000_000);
      await cash.connect(lender).approve(await repo.getAddress(), 3_000_000);
    }

    const now = await time.latest();
    const fundingDeadline = now + 100;
    const maturity = fundingDeadline + 30 * 24 * 60 * 60;
    const basket = [
      [await first.getAddress(), 6, 100_000, 200, 6_000],
      [await second.getAddress(), 6, 98_000, 800, 6_000],
    ];
    await repo
      .connect(borrower)
      .requestRepo(await cash.getAddress(), 1_000_000, fundingDeadline, maturity, 10_500, basket);

    return {
      borrower,
      lenderA,
      lenderB,
      ineligible,
      oracle,
      oracleSigner,
      reviewer,
      bidder,
      first,
      second,
      third,
      cash,
      repo,
      fundingDeadline,
      maturity,
    };
  }

  async function activeFixture() {
    const context = await fixture();
    const { lenderA, lenderB, repo, fundingDeadline } = context;
    await repo.connect(lenderA).offerFunding(1, 475);
    await repo.connect(lenderB).offerFunding(1, 410);
    await time.increaseTo(fundingDeadline);
    await repo.openRepo(1);
    return context;
  }

  it("locks a post-haircut ATS basket and sends cash from the lowest-rate eligible lender", async function () {
    const { borrower, lenderA, lenderB, cash, repo, fundingDeadline } = await loadFixture(fixture);
    expect(await repo.collateralCapacity(1)).to.equal(1_128_960);
    await repo.connect(lenderA).offerFunding(1, 475);
    await repo.connect(lenderB).offerFunding(1, 410);
    await time.increaseTo(fundingDeadline);
    await expect(repo.openRepo(1)).to.emit(repo, "RepoOpened").withArgs(1, lenderB.address, 410, 1_000_000);
    expect(await cash.balanceOf(borrower.address)).to.equal(1_000_000);
    await repo.connect(lenderA).withdrawLosingOffer(1);
    expect(await cash.balanceOf(lenderA.address)).to.equal(3_000_000);
  });

  it("rejects a lender who cannot receive the ATS collateral", async function () {
    const { ineligible, repo } = await loadFixture(fixture);
    await expect(repo.connect(ineligible).offerFunding(1, 300))
      .to.be.revertedWithCustomError(repo, "KycNotGranted")
      .withArgs(ineligible.address);
  });

  it("rejects a basket that breaches a series concentration limit", async function () {
    const { borrower, first, cash, repo } = await loadFixture(fixture);
    const now = await time.latest();
    await expect(
      repo
        .connect(borrower)
        .requestRepo(await cash.getAddress(), 100_000, now + 100, now + 1_000, 10_000, [
          [await first.getAddress(), 2, 100_000, 200, 6_000],
        ]),
    )
      .to.be.revertedWithCustomError(repo, "ConcentrationExceeded")
      .withArgs(0);
  });

  it("starts a margin call after oracle repricing and accepts partial repayment as a cure", async function () {
    const { borrower, lenderB, first, second, oracle, cash, repo } = await loadFixture(activeFixture);
    await oracle.setPrice(await first.getAddress(), 80_000);
    await repo.refreshPrice(1, 0);
    await oracle.setPrice(await second.getAddress(), 75_000);
    await expect(repo.refreshPrice(1, 1)).to.emit(repo, "MarginCalled");
    expect((await repo.repos(1)).state).to.equal(3);
    await cash.mint(borrower.address, 250_000);
    await cash.connect(borrower).approve(await repo.getAddress(), 250_000);
    await expect(repo.connect(borrower).partiallyRepay(1, 200_000)).to.emit(repo, "MarginCured");
    expect((await repo.repos(1)).state).to.equal(2);
    expect(await cash.balanceOf(lenderB.address)).to.equal(2_200_000);
  });

  it("requires coupon treatment, repays the lender, and returns every collateral line at maturity", async function () {
    const { borrower, lenderB, reviewer, first, second, cash, repo, maturity } = await loadFixture(activeFixture);
    await time.increaseTo(maturity);
    await cash.mint(borrower.address, 50_000);
    await cash.connect(borrower).approve(await repo.getAddress(), 1_050_000);
    await expect(repo.connect(borrower).closeRepo(1)).to.be.revertedWithCustomError(repo, "CouponTreatmentRequired");
    const scheduleHash = ethers.id("0.0.123456");
    await expect(repo.connect(reviewer).verifyCouponEquivalentSchedule(1, scheduleHash))
      .to.emit(repo, "CouponEquivalentScheduled")
      .withArgs(1, scheduleHash);
    await expect(repo.connect(lenderB).payCouponEquivalent(1, 1_000)).to.emit(repo, "CouponEquivalentPaid");
    await expect(repo.connect(borrower).closeRepo(1)).to.emit(repo, "RepoClosed");
    expect(await first.balanceOf(borrower.address)).to.equal(20);
    expect(await second.balanceOf(borrower.address)).to.equal(20);
    expect(await cash.balanceOf(lenderB.address)).to.be.greaterThan(3_000_000);
  });

  it("permits substitution only when the replacement maintains required coverage", async function () {
    const { borrower, first, third, repo } = await loadFixture(activeFixture);
    await third.connect(borrower).approve(await repo.getAddress(), 20);
    await expect(repo.connect(borrower).substituteCollateral(1, 0, [await third.getAddress(), 7, 100_000, 200, 6_000]))
      .to.emit(repo, "CollateralSubstituted")
      .withArgs(1, 0, await first.getAddress(), await third.getAddress());
    expect(await first.balanceOf(borrower.address)).to.equal(20);
  });

  it("routes an uncured basket to compliant auctions with lender-first, borrower-surplus settlement", async function () {
    const { borrower, lenderB, oracle, reviewer, bidder, first, second, cash, repo } = await loadFixture(activeFixture);
    await oracle.setPrice(await first.getAddress(), 80_000);
    await repo.refreshPrice(1, 0);
    await oracle.setPrice(await second.getAddress(), 75_000);
    await repo.refreshPrice(1, 1);
    const marginDeadline = (await repo.repos(1)).marginDeadline;
    await time.increaseTo(marginDeadline);
    await repo.declareDefault(1);

    const Auction = await ethers.getContractFactory("ComplianceAuction");
    const auction = await Auction.deploy(
      reviewer.address,
      await repo.getAddress(),
      await cash.getAddress(),
      await oracle.getAddress(),
    );
    for (const security of [first, second]) await security.setKyc(await auction.getAddress(), true);
    const auctionDeadline = (await time.latest()) + 100;
    await expect(
      repo.connect(lenderB).createLiquidationAuctions(1, await auction.getAddress(), auctionDeadline, 5_000),
    ).to.emit(repo, "LiquidationAuctionCreated");
    expect(await repo.collateralCount(1)).to.equal(2);

    await cash.connect(bidder).approve(await auction.getAddress(), 700_000);
    await auction.connect(bidder).bid(1, 600_000);
    await time.increaseTo(auctionDeadline);
    await auction.close(1);
    const lenderBefore = await cash.balanceOf(lenderB.address);
    const borrowerBefore = await cash.balanceOf(borrower.address);
    await expect(auction.settle(1)).to.emit(auction, "LiquidationWaterfallPaid");
    expect(await cash.balanceOf(lenderB.address)).to.be.greaterThan(lenderBefore);
    expect(await cash.balanceOf(borrower.address)).to.be.greaterThan(borrowerBefore);
  });

  it("returns collateral when the funding window expires without an offer", async function () {
    const { borrower, first, second, repo, fundingDeadline } = await loadFixture(fixture);
    await time.increaseTo(fundingDeadline);
    await expect(repo.connect(borrower).reclaimUnfundedRepo(1)).to.emit(repo, "RepoCancelled").withArgs(1);
    expect((await repo.repos(1)).state).to.equal(6);
    expect(await first.balanceOf(borrower.address)).to.equal(20);
    expect(await second.balanceOf(borrower.address)).to.equal(20);
  });

  it("routes an unpaid maturity obligation to liquidation", async function () {
    const { repo, maturity } = await loadFixture(activeFixture);
    await time.increaseTo(maturity);
    await expect(repo.declareDefault(1)).to.emit(repo, "RepoDefaulted");
    expect((await repo.repos(1)).state).to.equal(5);
  });

  it("rejects a borrower-supplied price that differs from the authenticated oracle", async function () {
    const { borrower, first, cash, repo } = await loadFixture(fixture);
    const now = await time.latest();
    await expect(
      repo
        .connect(borrower)
        .requestRepo(await cash.getAddress(), 100_000, now + 100, now + 1_000, 10_000, [
          [await first.getAddress(), 2, 101_000, 200, 10_000],
        ]),
    ).to.be.revertedWithCustomError(repo, "OraclePriceMismatch");
  });

  it("normalizes ATS token decimals when calculating borrowing capacity", async function () {
    const { borrower, first, cash, oracle, repo } = await loadFixture(fixture);
    await first.setDecimals(6);
    await first.mint(borrower.address, 2_000_000n);
    await first.connect(borrower).approve(await repo.getAddress(), 2_000_000n);
    await oracle.setPrice(await first.getAddress(), 6_000_000n);
    const now = await time.latest();
    await repo
      .connect(borrower)
      .requestRepo(await cash.getAddress(), 10_000_000n, now + 100, now + 1_000, 10_000, [
        [await first.getAddress(), 2_000_000n, 6_000_000n, 1_000, 10_000],
      ]);
    expect(await repo.collateralCapacity(2)).to.equal(10_800_000n);
  });

  it("allows each party to authorize Hedera's scheduled-transaction caller address", async function () {
    const { borrower, lenderB, bidder, reviewer, cash, repo, maturity } = await loadFixture(activeFixture);
    await expect(repo.connect(borrower).authorizeScheduledCaller(1, bidder.address))
      .to.emit(repo, "ScheduledCallerAuthorized")
      .withArgs(1, borrower.address, bidder.address);
    await repo.connect(lenderB).authorizeScheduledCaller(1, bidder.address);
    await repo.connect(reviewer).verifyCouponEquivalentSchedule(1, ethers.id("0.0.654321"));
    await expect(repo.connect(bidder).payCouponEquivalent(1, 1_000)).to.emit(repo, "CouponEquivalentPaid");
    await cash.mint(borrower.address, 50_000);
    await cash.connect(borrower).approve(await repo.getAddress(), 1_050_000);
    await time.increaseTo(maturity);
    await expect(repo.connect(bidder).closeRepo(1)).to.emit(repo, "RepoClosed");
  });
});
