// SPDX-License-Identifier: Apache-2.0

import deployment from "../../../deployments/hedera-testnet.json";

export type LiveBondForm = {
  id: string;
  name: string;
  symbol: string;
  contractId?: string;
  security: string;
  decimals: string;
  quantity: string;
  unitPrice: string;
  stormPrice: string;
  haircutBps: number;
  maxConcentrationBps: number;
};

type DeploymentBond = {
  id: string;
  contractId?: string;
  evmAddress: string;
};

type DeploymentRegistry = {
  contractId?: string;
  evmAddress: string;
};

type DeploymentContract = {
  evmAddress: string;
};

const contracts = deployment.contracts as unknown as {
  atsBonds?: DeploymentBond[];
  kycAccessRegistry?: DeploymentRegistry;
  repoLifecycle?: DeploymentContract;
  complianceAuction?: DeploymentContract;
  signedPriceOracle?: DeploymentContract;
};

const deployed = (contracts.atsBonds ?? []).reduce(
  (bonds, bond) => bonds.set(bond.id, bond),
  new Map<string, DeploymentBond>(),
);

const environment = import.meta.env as Record<string, string | undefined>;

export const KYC_ACCESS_REGISTRY_ADDRESS =
  environment.VITE_KYC_ACCESS_REGISTRY_ADDRESS || contracts.kycAccessRegistry?.evmAddress || "";

export const KYC_ACCESS_REGISTRY_ID = contracts.kycAccessRegistry?.contractId;

export const DEPLOYED_LIVE_ADDRESSES = {
  repoLifecycle: contracts.repoLifecycle?.evmAddress || "",
  complianceAuction: contracts.complianceAuction?.evmAddress || "",
  signedPriceOracle: contracts.signedPriceOracle?.evmAddress || "",
  kycAccessRegistry: KYC_ACCESS_REGISTRY_ADDRESS,
};

export const DEFAULT_LIVE_BONDS: LiveBondForm[] = [
  {
    id: "ust-28",
    name: "U.S. Treasury Note 4.25%",
    symbol: "USTB-28",
    contractId: deployed.get("ust-28")?.contractId,
    security: environment.VITE_ATS_USTB_28_ADDRESS || deployed.get("ust-28")?.evmAddress || "",
    decimals: "0",
    quantity: "1",
    unitPrice: "1.00",
    stormPrice: "0.68",
    haircutBps: 200,
    maxConcentrationBps: 7_000,
  },
  {
    id: "green-30",
    name: "Sovereign Green Bond 3.80%",
    symbol: "GRNB-30",
    contractId: deployed.get("green-30")?.contractId,
    security: environment.VITE_ATS_GRNB_30_ADDRESS || deployed.get("green-30")?.evmAddress || "",
    decimals: "0",
    quantity: "1",
    unitPrice: "0.98",
    stormPrice: "0.66",
    haircutBps: 800,
    maxConcentrationBps: 6_000,
  },
  {
    id: "muni-31",
    name: "Metro Infrastructure 5.10%",
    symbol: "MUNI-31",
    contractId: deployed.get("muni-31")?.contractId,
    security: environment.VITE_ATS_MUNI_31_ADDRESS || deployed.get("muni-31")?.evmAddress || "",
    decimals: "0",
    quantity: "1",
    unitPrice: "0.95",
    stormPrice: "0.64",
    haircutBps: 1_500,
    maxConcentrationBps: 5_500,
  },
  {
    id: "corp-29",
    name: "Northstar Senior Note 5.65%",
    symbol: "NSCR-29",
    contractId: deployed.get("corp-29")?.contractId,
    security: environment.VITE_ATS_NSCR_29_ADDRESS || deployed.get("corp-29")?.evmAddress || "",
    decimals: "0",
    quantity: "1",
    unitPrice: "1.02",
    stormPrice: "0.62",
    haircutBps: 2_000,
    maxConcentrationBps: 4_500,
  },
];
