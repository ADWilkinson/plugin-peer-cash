/**
 * Context provider: one cheap line telling the planner what Peer Cash can do
 * right now - environment, signer availability, and the payout catalog size.
 * Deliberately no network reads (capabilities() is synchronous and static);
 * live order state belongs to the actions.
 */

import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { getPeerCashService } from "../service.js";

export const peerCashProvider: Provider = {
  name: "PEER_CASH_STATUS",
  description:
    "Peer Cash offramp availability: environment, signer state, and supported payout platforms.",
  dynamic: true,

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
  ): Promise<ProviderResult> => {
    const service = getPeerCashService(runtime);
    if (!service) {
      return {
        text: "Peer Cash: not available (plugin service not started).",
        values: { peerCashAvailable: false },
        data: {},
      };
    }

    const config = service.getConfig();
    const capabilities = service.getClient().capabilities();
    const signerAddress = service.getSignerAddressOrNull();
    const platforms = capabilities.platforms.map((platform) => platform.platform).join(", ");

    const text =
      `Peer Cash (${config.environment}): cash out Base USDC to ${platforms} at the live ` +
      `oracle market rate. Signer: ${signerAddress ?? "not configured"}. Referral code: ` +
      `${config.referralCode ? "configured" : "none"}.`;

    return {
      text,
      values: {
        peerCashAvailable: true,
        peerCashEnvironment: config.environment,
        peerCashSignerAddress: signerAddress ?? null,
        peerCashPlatformCount: capabilities.platforms.length,
      },
      data: {},
    };
  },
};
