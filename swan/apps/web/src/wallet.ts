// SPDX-License-Identifier: Apache-2.0

import { getDefaultConfig, type Chain } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { http } from "wagmi";

const rpcUrl = import.meta.env.VITE_HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();

export const hederaTestnet = {
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrl] },
  },
  blockExplorers: {
    default: { name: "HashScan", url: "https://hashscan.io/testnet" },
  },
  testnet: true,
} as const satisfies Chain;

export const wagmiConfig = getDefaultConfig({
  appName: "Swan",
  appDescription: "Compliant ATS collateral and repo arena on Hedera",
  appUrl: typeof window === "undefined" ? undefined : window.location.origin,
  projectId: walletConnectProjectId || "injected-wallets-only",
  chains: [hederaTestnet],
  transports: {
    [hederaTestnet.id]: http(rpcUrl),
  },
  // WalletConnect needs a Cloud project ID. Without one, keep the modal fully
  // functional for installed EIP-1193/EIP-6963 browser wallets.
  wallets: walletConnectProjectId
    ? undefined
    : [
        {
          groupName: "Installed wallets",
          wallets: [injectedWallet],
        },
      ],
});
