// SPDX-License-Identifier: Apache-2.0

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("KycAccessRegistry", function () {
  async function fixture() {
    const [reviewer, applicant, stranger] = await ethers.getSigners();
    const mockFactory = await ethers.getContractFactory("MockKycSecurity");
    const securities = await Promise.all(Array.from({ length: 4 }, () => mockFactory.deploy()));
    const registryFactory = await ethers.getContractFactory("KycAccessRegistry");
    const registry = await registryFactory.deploy(
      reviewer.address,
      reviewer.address,
      await Promise.all(securities.map((security) => security.getAddress())),
    );
    const registryAddress = await registry.getAddress();
    await Promise.all(securities.map((security) => security.setRegistry(registryAddress)));
    return { reviewer, applicant, stranger, securities, registry };
  }

  it("accepts a public request without storing personal data", async function () {
    const { applicant, registry } = await fixture();
    await expect(registry.connect(applicant).requestAccess(3))
      .to.emit(registry, "AccessRequested")
      .withArgs(applicant.address, 3, anyValue);
    const request = await registry.requests(applicant.address);
    expect(request.applicant).to.equal(applicant.address);
    expect(request.roles).to.equal(3);
    expect(request.status).to.equal(1);
  });

  it("lets only the reviewer batch-grant KYC across every ATS security", async function () {
    const { reviewer, applicant, stranger, securities, registry } = await fixture();
    await registry.connect(applicant).requestAccess(1);
    const validTo = (await timeOfNextBlock()) + 31_536_000n;
    await expect(
      registry.connect(stranger).approve(applicant.address, "vc:test", validTo),
    ).to.be.revertedWithCustomError(registry, "Unauthorized");
    await expect(registry.connect(reviewer).approve(applicant.address, "vc:test", validTo)).to.emit(
      registry,
      "AccessApproved",
    );
    expect(await registry.isFullyKyc(applicant.address)).to.equal(true);
    for (const security of securities) expect(await security.getKycStatusFor(applicant.address)).to.equal(1);
  });

  it("supports rejection and a later renewed request", async function () {
    const { reviewer, applicant, registry } = await fixture();
    await registry.connect(applicant).requestAccess(2);
    await expect(registry.connect(reviewer).reject(applicant.address)).to.emit(registry, "AccessRejected");
    expect((await registry.requests(applicant.address)).status).to.equal(3);
    await registry.connect(applicant).requestAccess(3);
    expect((await registry.requests(applicant.address)).status).to.equal(1);
  });

  it("rejects invalid roles and duplicate pending requests", async function () {
    const { applicant, registry } = await fixture();
    await expect(registry.connect(applicant).requestAccess(0)).to.be.revertedWithCustomError(registry, "InvalidRoles");
    await registry.connect(applicant).requestAccess(1);
    await expect(registry.connect(applicant).requestAccess(2)).to.be.revertedWithCustomError(
      registry,
      "RequestAlreadyPending",
    );
  });
});

async function timeOfNextBlock() {
  return BigInt((await ethers.provider.getBlock("latest")).timestamp + 1);
}
