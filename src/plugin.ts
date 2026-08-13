/**
 * Plugin wiring for Peer Cash - registration only, no business logic. The
 * service owns the SDK client and signer; actions own the verbs; the provider
 * contributes cheap planner context. `init` validates configuration up front
 * so a malformed environment, referral code, or key fails the load instead of
 * failing the first cash-out.
 */

import type { IAgentRuntime, Plugin } from "@elizaos/core";
import { logger } from "@elizaos/core";
import {
  peerCashCapabilitiesAction,
  peerCashCashoutAction,
  peerCashEstimateAction,
  peerCashOrderStatusAction,
  peerCashOrdersAction,
  peerCashTopUpAction,
  peerCashWithdrawAction,
} from "./actions/index.js";
import { PeerCashTestSuite } from "./e2e/suite.js";
import { PEER_CASH_SETTING_KEYS, resolvePeerCashConfig } from "./environment.js";
import { peerCashProvider } from "./providers/index.js";
import { PeerCashService } from "./service.js";

export const peerCashPlugin: Plugin = {
  name: "plugin-peer-cash",
  description:
    "Peer Cash offramp for elizaOS agents: estimate and execute Base USDC cash-outs to fiat " +
    "payment apps (Venmo, Revolut, Wise, Zelle, and more) at the live oracle market rate, " +
    "then track, withdraw, and top up orders. Non-custodial; the agent signs with its own " +
    "wallet.",

  config: {
    PEER_CASH_ENVIRONMENT: process.env.PEER_CASH_ENVIRONMENT ?? null,
    PEER_CASH_REFERRAL_CODE: process.env.PEER_CASH_REFERRAL_CODE ?? null,
    PEER_CASH_REFERRER: process.env.PEER_CASH_REFERRER ?? null,
    PEER_CASH_RPC_URL: process.env.PEER_CASH_RPC_URL ?? null,
  },

  async init(config: Record<string, string>, runtime: IAgentRuntime): Promise<void> {
    // Character-level plugin config becomes visible to the service's later
    // settings resolution the same way the starter template propagates it.
    // Only this plugin's own keys are copied, and only when set.
    for (const key of PEER_CASH_SETTING_KEYS) {
      const value = config[key];
      if (typeof value === "string" && value.trim() !== "") {
        process.env[key] = value;
      }
    }
    const resolved = resolvePeerCashConfig(runtime);
    logger.info(
      `[plugin-peer-cash] initialized for ${resolved.environment}` +
        `${resolved.referralCode ? " with a referral code" : ""}`,
    );
  },

  services: [PeerCashService],
  providers: [peerCashProvider],
  actions: [
    peerCashCapabilitiesAction,
    peerCashEstimateAction,
    peerCashCashoutAction,
    peerCashOrderStatusAction,
    peerCashOrdersAction,
    peerCashWithdrawAction,
    peerCashTopUpAction,
  ],
  tests: [PeerCashTestSuite],
};

export default peerCashPlugin;
