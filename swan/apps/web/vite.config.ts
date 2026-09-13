// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The starter monorepo also contains applications pinned to React Query 4.
    // Keep Swan, wagmi, and RainbowKit on Swan's React Query 5 instance so
    // QueryClientProvider context is not split across duplicate packages.
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  server: { port: 4174 },
});
