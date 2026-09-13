// SPDX-License-Identifier: Apache-2.0

require("dotenv").config();

const {
  AccountId,
  Client,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  PrivateKey,
  ScheduleCreateTransaction,
  Timestamp,
} = require("@hashgraph/sdk");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function contractId(value) {
  return value.startsWith("0x") ? ContractId.fromEvmAddress(0, 0, value) : ContractId.fromString(value);
}

async function main() {
  const lenderId = AccountId.fromString(required("OPERATOR_ID"));
  const lenderKey = PrivateKey.fromStringECDSA(required("OPERATOR_PRIVATE_KEY"));
  const executeAt = new Date(required("COUPON_PAY_AT"));
  const delaySeconds = Math.floor((executeAt.getTime() - Date.now()) / 1000);
  if (!Number.isFinite(executeAt.getTime()) || delaySeconds <= 0 || delaySeconds > 62 * 24 * 60 * 60) {
    throw new Error("COUPON_PAY_AT must be in the future and no more than 62 days away");
  }

  const client = Client.forTestnet().setOperator(lenderId, lenderKey);
  const payment = new ContractExecuteTransaction()
    .setContractId(contractId(required("REPO_CONTRACT_ID")))
    .setGas(450_000)
    .setFunction(
      "payCouponEquivalent",
      new ContractFunctionParameters().addUint256(required("REPO_ID")).addUint256(required("COUPON_AMOUNT")),
    );

  const response = await new ScheduleCreateTransaction()
    .setScheduledTransaction(payment)
    .setPayerAccountId(lenderId)
    .setScheduleMemo(`Swan repo ${required("REPO_ID")} coupon equivalent`)
    .setExpirationTime(Timestamp.fromDate(executeAt))
    .setWaitForExpiry(true)
    .execute(client);
  const receipt = await response.getReceipt(client);
  const scheduleId = receipt.scheduleId?.toString();

  console.log(
    JSON.stringify(
      {
        network: "hedera-testnet",
        scheduleId,
        scheduledTransactionId: receipt.scheduledTransactionId?.toString(),
        executeAt: executeAt.toISOString(),
        verifyCommand: `COUPON_SCHEDULE_ID=${scheduleId} npm run schedule:verify:testnet --workspace=@swan/contracts`,
        mirrorUrl: `https://testnet.mirrornode.hedera.com/api/v1/schedules/${scheduleId}`,
      },
      null,
      2,
    ),
  );
  client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
