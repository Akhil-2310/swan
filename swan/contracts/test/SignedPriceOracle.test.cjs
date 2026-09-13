const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SignedPriceOracle", function () {
  async function fixture() {
    const [signer, relayer, attacker] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory("SignedPriceOracle");
    const Receiver = await ethers.getContractFactory("MockRepoPriceReceiver");
    const oracle = await Oracle.deploy(signer.address, 120);
    const receiver = await Receiver.deploy();
    return { signer, relayer, attacker, oracle, receiver };
  }

  async function sign(oracle, signer, receiver, values) {
    const hash = await oracle.payloadHash(
      await receiver.getAddress(),
      values.repoId,
      values.collateralIndex,
      values.price,
      values.observedAt,
      values.nonce,
    );
    return signer.signMessage(ethers.getBytes(hash));
  }

  it("accepts a fresh signed observation through an untrusted relayer", async function () {
    const { signer, relayer, oracle, receiver } = await loadFixture(fixture);
    const values = { repoId: 7, collateralIndex: 2, price: 91_000, observedAt: await time.latest(), nonce: 0 };
    const signature = await sign(oracle, signer, receiver, values);
    await expect(
      oracle
        .connect(relayer)
        .submitPrice(
          await receiver.getAddress(),
          values.repoId,
          values.collateralIndex,
          values.price,
          values.observedAt,
          values.nonce,
          signature,
        ),
    ).to.emit(oracle, "PriceSubmitted");
    expect(await receiver.price()).to.equal(values.price);
  });

  it("rejects stale, forged, and replayed observations", async function () {
    const { signer, attacker, oracle, receiver } = await loadFixture(fixture);
    const now = await time.latest();
    const stale = { repoId: 1, collateralIndex: 0, price: 80_000, observedAt: now - 121, nonce: 0 };
    await expect(
      oracle.submitPrice(
        await receiver.getAddress(),
        1,
        0,
        stale.price,
        stale.observedAt,
        0,
        await sign(oracle, signer, receiver, stale),
      ),
    ).to.be.revertedWithCustomError(oracle, "StalePrice");

    const fresh = { ...stale, observedAt: now };
    await expect(
      oracle.submitPrice(
        await receiver.getAddress(),
        1,
        0,
        fresh.price,
        fresh.observedAt,
        0,
        await sign(oracle, attacker, receiver, fresh),
      ),
    ).to.be.revertedWithCustomError(oracle, "InvalidSignature");

    const validSignature = await sign(oracle, signer, receiver, fresh);
    await oracle.submitPrice(await receiver.getAddress(), 1, 0, fresh.price, fresh.observedAt, 0, validSignature);
    await expect(
      oracle.submitPrice(await receiver.getAddress(), 1, 0, fresh.price, fresh.observedAt, 0, validSignature),
    ).to.be.revertedWithCustomError(oracle, "InvalidNonce");
  });

  it("publishes a fresh authenticated security price for repo and auction entry", async function () {
    const { signer, relayer, oracle } = await loadFixture(fixture);
    const security = ethers.Wallet.createRandom().address;
    const observedAt = await time.latest();
    const hash = await oracle.securityPayloadHash(security, 100_000, observedAt, 0);
    const signature = await signer.signMessage(ethers.getBytes(hash));
    await expect(oracle.connect(relayer).submitSecurityPrice(security, 100_000, observedAt, 0, signature))
      .to.emit(oracle, "SecurityPriceSubmitted")
      .withArgs(security, 100_000, observedAt, 0);
    const [price, timestamp] = await oracle.priceOf(security);
    expect(price).to.equal(100_000);
    expect(timestamp).to.equal(observedAt);
  });
});
