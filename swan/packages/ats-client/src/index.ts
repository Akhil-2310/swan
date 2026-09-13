// SPDX-License-Identifier: Apache-2.0

export enum AtsKycStatus {
  NotGranted = 0,
  Granted = 1,
}

export type EligibilityCheckCode =
  | "ASSET_ACTIVE"
  | "ACCOUNT_NOT_FROZEN"
  | "KYC_GRANTED"
  | "BALANCE_AVAILABLE"
  | "TRANSFER_ALLOWED";

export interface EligibilityCheck {
  code: EligibilityCheckCode;
  passed: boolean;
  detail: string;
}

export interface EligibilityDecision {
  eligible: boolean;
  checks: EligibilityCheck[];
  reason: string | null;
}

/**
 * Minimal read surface used by Swan. Each method maps directly to an ATS
 * facet and can be backed by the published ATS SDK or an ethers contract.
 */
export interface AtsSecurityReader {
  paused(securityId: string): Promise<boolean>;
  isFrozen(securityId: string, accountId: string): Promise<boolean>;
  getKycStatusFor(securityId: string, accountId: string): Promise<number>;
  balanceOf(securityId: string, accountId: string): Promise<bigint>;
  canTransferFrom(
    securityId: string,
    fromAccountId: string,
    toAccountId: string,
    amount: bigint,
  ): Promise<{ allowed: boolean; status: string; reason: string }>;
}

export async function checkListingEligibility(
  reader: AtsSecurityReader,
  input: {
    securityId: string;
    sellerId: string;
    auctionEscrowId: string;
    quantity: bigint;
  },
): Promise<EligibilityDecision> {
  const { securityId, sellerId, auctionEscrowId, quantity } = input;
  const [isPaused, isFrozen, kycStatus, balance, transfer] = await Promise.all([
    reader.paused(securityId),
    reader.isFrozen(securityId, sellerId),
    reader.getKycStatusFor(securityId, sellerId),
    reader.balanceOf(securityId, sellerId),
    reader.canTransferFrom(securityId, sellerId, auctionEscrowId, quantity),
  ]);

  return decision([
    {
      code: "ASSET_ACTIVE",
      passed: !isPaused,
      detail: isPaused ? "ATS security is paused" : "ATS security is active",
    },
    {
      code: "ACCOUNT_NOT_FROZEN",
      passed: !isFrozen,
      detail: isFrozen ? "Seller is frozen" : "Seller is not frozen",
    },
    {
      code: "KYC_GRANTED",
      passed: kycStatus === AtsKycStatus.Granted,
      detail: kycStatus === AtsKycStatus.Granted ? "Seller KYC is granted" : "Seller KYC is not granted",
    },
    {
      code: "BALANCE_AVAILABLE",
      passed: quantity > 0n && balance >= quantity,
      detail: `Available ${balance.toString()} / required ${quantity.toString()}`,
    },
    {
      code: "TRANSFER_ALLOWED",
      passed: transfer.allowed,
      detail: transfer.allowed ? "ATS transfer preflight passed" : `${transfer.status}: ${transfer.reason}`,
    },
  ]);
}

export async function checkBidderEligibility(
  reader: AtsSecurityReader,
  input: {
    securityId: string;
    escrowId: string;
    bidderId: string;
    quantity: bigint;
  },
): Promise<EligibilityDecision> {
  const { securityId, escrowId, bidderId, quantity } = input;
  const [isPaused, isFrozen, kycStatus, transfer] = await Promise.all([
    reader.paused(securityId),
    reader.isFrozen(securityId, bidderId),
    reader.getKycStatusFor(securityId, bidderId),
    reader.canTransferFrom(securityId, escrowId, bidderId, quantity),
  ]);

  return decision([
    {
      code: "ASSET_ACTIVE",
      passed: !isPaused,
      detail: isPaused ? "ATS security is paused" : "ATS security is active",
    },
    {
      code: "ACCOUNT_NOT_FROZEN",
      passed: !isFrozen,
      detail: isFrozen ? "Bidder is frozen" : "Bidder is not frozen",
    },
    {
      code: "KYC_GRANTED",
      passed: kycStatus === AtsKycStatus.Granted,
      detail: kycStatus === AtsKycStatus.Granted ? "Bidder KYC is granted" : "Bidder KYC is not granted",
    },
    {
      code: "TRANSFER_ALLOWED",
      passed: transfer.allowed,
      detail: transfer.allowed ? "ATS transfer preflight passed" : `${transfer.status}: ${transfer.reason}`,
    },
  ]);
}

function decision(checks: EligibilityCheck[]): EligibilityDecision {
  const failed = checks.find((check) => !check.passed);
  return {
    eligible: failed === undefined,
    checks,
    reason: failed?.detail ?? null,
  };
}
