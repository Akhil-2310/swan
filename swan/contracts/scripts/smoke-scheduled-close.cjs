// SPDX-License-Identifier: Apache-2.0

const { ethers } = require("hardhat");
const {
  AccountCreateTransaction,
  AccountDeleteTransaction,
  AccountId,
  Client,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  Hbar,
  PrivateKey,
  ScheduleCreateTransaction,
  Timestamp,
  TokenAssociateTransaction,
  TokenId,
} = require("@hashgraph/sdk");

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];

const ATS_KYC_ABI = [
  "function grantKyc(address,string,uint256,uint256,address) returns (bool)",
  "function getKycStatusFor(address) view returns (uint8)",
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function eventId(contract, receipt, name, argument) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === name) return BigInt(parsed.args[argument]);
    } catch {
      // Ignore logs from ATS and native USDC.
    }
  }
  throw new Error(`${name} event missing`);
}

async function waitForTimestamp(timestamp) {
  while (true) {
    const block = await ethers.provider.getBlock("latest");
    if (block.timestamp >= timestamp) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(3_000, (timestamp - block.timestamp) * 1_000)));
  }
}

async function publishSecurityPrice(oracle, signer, security, price) {
  const observedAt = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const nonce = await oracle.nextNonce();
  const payload = await oracle.securityPayloadHash(security, price, observedAt, nonce);
  const signature = await signer.signMessage(ethers.getBytes(payload));
  return (await oracle.submitSecurityPrice(security, price, observedAt, nonce, signature)).wait();
}

async function createSchedule(client, repoContractId, payerId, repoId, functionName, amount, executeAt) {
  const parameters = new ContractFunctionParameters().addUint256(repoId.toString());
  if (amount !== undefined) parameters.addUint256(amount.toString());
  const call = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(repoContractId))
    .setGas(450_000)
    .setFunction(functionName, parameters);
  const response = await new ScheduleCreateTransaction()
    .setScheduledTransaction(call)
    .setPayerAccountId(payerId)
    .setScheduleMemo(`Swan ${functionName} repo ${repoId}`)
    .setExpirationTime(Timestamp.fromDate(new Date(executeAt * 1_000)))
    .setWaitForExpiry(true)
    .execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.scheduleId) throw new Error(`No schedule ID returned for ${functionName}`);
  return {
    scheduleId: receipt.scheduleId.toString(),
    scheduledTransactionId: receipt.scheduledTransactionId?.toString() || null,
  };
}

async function main() {
  const [signer] = await ethers.getSigners();
  const securityAddress = required("SECURITY_ADDRESS");
  const repoAddress = required("REPO_CONTRACT_ADDRESS");
  const repoContractId = required("REPO_CONTRACT_ID");
  const cashAddress = required("CASH_TOKEN_ADDRESS");
  const operatorId = AccountId.fromString(process.env.OPERATOR_ID || process.env.ATS_OPERATOR_ID || "0.0.10499008");
  const operatorKey = PrivateKey.fromStringECDSA(
    (process.env.OPERATOR_PRIVATE_KEY || required("DEPLOYER_PRIVATE_KEY")).replace(/^0x/, ""),
  );
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  const oracle = await ethers.getContractAt("SignedPriceOracle", required("ORACLE_ADDRESS"), signer);
  const repo = await ethers.getContractAt("RepoLifecycle", repoAddress, signer);
  const security = new ethers.Contract(securityAddress, ERC20_ABI, signer);
  const securityKyc = new ethers.Contract(securityAddress, ATS_KYC_ABI, signer);
  const cash = new ethers.Contract(cashAddress, ERC20_ABI, signer);
  const quantity = 2n;
  const principal = 5_000_000n;
  const unitPrice = 6_000_000n;
  const couponAmount = 100_000n;
  const bondBalanceBefore = await security.balanceOf(signer.address);
  if ((await cash.balanceOf(signer.address)) < 10_000_000n) {
    throw new Error("The borrower needs at least 10 testnet USDC to provision the temporary lender");
  }
  const receipts = {};

  // Use a genuinely separate lender. Hedera rejects same-account HTS transfers,
  // and distinct counterparties are the economically meaningful repo path.
  const lenderKey = PrivateKey.generateECDSA();
  const lenderCreate = await new AccountCreateTransaction()
    .setECDSAKeyWithAlias(lenderKey)
    .setInitialBalance(new Hbar(5))
    .execute(client);
  const lenderReceipt = await lenderCreate.getReceipt(client);
  if (!lenderReceipt.accountId) throw new Error("Lender account creation did not return an account ID");
  const lenderId = lenderReceipt.accountId;
  const lenderClient = Client.forTestnet().setOperator(lenderId, lenderKey);
  await (
    await new TokenAssociateTransaction()
      .setAccountId(lenderId)
      .setTokenIds([TokenId.fromString("0.0.429274")])
      .execute(lenderClient)
  ).getReceipt(lenderClient);
  const lender = new ethers.Wallet(`0x${lenderKey.toStringRaw()}`, ethers.provider);
  const lenderCash = cash.connect(lender);
  const lenderRepo = repo.connect(lender);

  const kycNow = (await ethers.provider.getBlock("latest")).timestamp;
  receipts.lenderKyc = await (
    await securityKyc.grantKyc(
      lender.address,
      `swan-scheduled-smoke-${lenderId}`,
      kycNow,
      kycNow + 365 * 24 * 60 * 60,
      signer.address,
    )
  ).wait();
  if ((await securityKyc.getKycStatusFor(lender.address)) !== 1n) {
    throw new Error("ATS KYC was not granted to the scheduled-test lender");
  }
  receipts.lenderCash = await (await cash.transfer(lender.address, 10_000_000n)).wait();
  const borrowerCashBefore = await cash.balanceOf(signer.address);
  const lenderCashBefore = await cash.balanceOf(lender.address);

  receipts.price = await publishSecurityPrice(oracle, signer, securityAddress, unitPrice);
  receipts.securityApproval = await (await security.approve(repoAddress, quantity)).wait();
  const latest = await ethers.provider.getBlock("latest");
  const fundingDeadline = latest.timestamp + 45;
  const maturity = fundingDeadline + 75;
  receipts.request = await (
    await repo.requestRepo(cashAddress, principal, fundingDeadline, maturity, 10_500, [
      [securityAddress, quantity, unitPrice, 1_000, 10_000],
    ])
  ).wait();
  const repoId = eventId(repo, receipts.request, "RepoRequested", "repoId");
  receipts.borrowerCashApproval = await (await cash.approve(repoAddress, 11_000_000n)).wait();
  receipts.lenderCashApproval = await (await lenderCash.approve(repoAddress, 11_000_000n)).wait();
  receipts.offer = await (await lenderRepo.offerFunding(repoId, 410)).wait();
  await waitForTimestamp(fundingDeadline);
  receipts.open = await (await repo.openRepo(repoId)).wait();
  const borrowerScheduledCaller = ethers.getAddress(`0x${operatorId.num.toString(16).padStart(40, "0")}`);
  const lenderScheduledCaller = ethers.getAddress(`0x${lenderId.num.toString(16).padStart(40, "0")}`);
  receipts.borrowerScheduledCaller = await (
    await repo.authorizeScheduledCaller(repoId, borrowerScheduledCaller)
  ).wait();
  receipts.lenderScheduledCaller = await (
    await lenderRepo.authorizeScheduledCaller(repoId, lenderScheduledCaller)
  ).wait();

  const couponExecuteAt = maturity - 15;
  const closeExecuteAt = maturity + 10;
  const couponSchedule = await createSchedule(
    lenderClient,
    repoContractId,
    lenderId,
    repoId,
    "payCouponEquivalent",
    couponAmount,
    couponExecuteAt,
  );
  receipts.scheduleVerification = await (
    await repo.verifyCouponEquivalentSchedule(repoId, ethers.id(couponSchedule.scheduleId))
  ).wait();
  const closeSchedule = await createSchedule(
    client,
    repoContractId,
    operatorId,
    repoId,
    "closeRepo",
    undefined,
    closeExecuteAt,
  );

  await waitForTimestamp(closeExecuteAt + 12);
  const snapshot = await repo.repos(repoId);
  const bondBalanceAfter = await security.balanceOf(signer.address);
  const borrowerCashAfter = await cash.balanceOf(signer.address);
  const lenderCashAfter = await cash.balanceOf(lender.address);
  if (!snapshot.couponEquivalentPaid) throw new Error("Scheduled coupon equivalent did not execute");
  if (snapshot.state !== 4n) throw new Error(`Expected closed repo state 4, received ${snapshot.state}`);
  if (bondBalanceAfter !== bondBalanceBefore) throw new Error("Scheduled close did not return ATS collateral");
  if (borrowerCashAfter + lenderCashAfter !== borrowerCashBefore + lenderCashBefore) {
    throw new Error("Scheduled repo USDC cash flows did not reconcile across counterparties");
  }
  receipts.lenderCashReturn = await (await lenderCash.transfer(signer.address, lenderCashAfter)).wait();
  await (
    await new AccountDeleteTransaction().setAccountId(lenderId).setTransferAccountId(operatorId).execute(lenderClient)
  ).getReceipt(lenderClient);
  client.close();
  lenderClient.close();

  console.log(
    JSON.stringify(
      {
        passed: true,
        repoId: repoId.toString(),
        borrower: { accountId: operatorId.toString(), evmAddress: signer.address },
        lender: { accountId: lenderId.toString(), evmAddress: lender.address },
        couponSchedule,
        closeSchedule,
        evidence: Object.fromEntries(
          Object.entries(receipts).map(([name, receipt]) => [
            name,
            `https://hashscan.io/testnet/transaction/${receipt.hash}`,
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
