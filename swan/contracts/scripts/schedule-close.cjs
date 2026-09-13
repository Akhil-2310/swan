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
  const operatorId = AccountId.fromString(required("OPERATOR_ID"));
  const operatorKey = PrivateKey.fromStringECDSA(required("OPERATOR_PRIVATE_KEY"));
  const executeAt = new Date(required("REPO_CLOSE_AT"));
  const delaySeconds = Math.floor((executeAt.getTime() - Date.now()) / 1000);
  if (!Number.isFinite(executeAt.getTime()) || delaySeconds <= 0 || delaySeconds > 62 * 24 * 60 * 60) {
    throw new Error("REPO_CLOSE_AT must be in the future and no more than 62 days away");
  }

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  const close = new ContractExecuteTransaction()
    .setContractId(contractId(required("REPO_CONTRACT_ID")))
    .setGas(450_000)
    .setFunction("closeRepo", new ContractFunctionParameters().addUint256(required("REPO_ID")));

  const response = await new ScheduleCreateTransaction()
    .setScheduledTransaction(close)
    .setPayerAccountId(operatorId)
    .setScheduleMemo(`Swan repo ${required("REPO_ID")} close`)
    .setExpirationTime(Timestamp.fromDate(executeAt))
    .setWaitForExpiry(true)
    .execute(client);
  const receipt = await response.getReceipt(client);

  console.log(
    JSON.stringify(
      {
        network: "hedera-testnet",
        scheduleId: receipt.scheduleId?.toString(),
        scheduledTransactionId: receipt.scheduledTransactionId?.toString(),
        executeAt: executeAt.toISOString(),
        mirrorUrl: `https://testnet.mirrornode.hedera.com/api/v1/schedules/${receipt.scheduleId?.toString()}`,
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
