/**
 * Runtime service owning the Peer Cash client and signer resolution. Actions
 * reach the SDK only through this service: configuration is validated once at
 * start, the `CashClient` is created lazily (client construction is pure; all
 * network work happens inside the verbs), and signing goes through the
 * runtime's wallet backend or the configured `EVM_PRIVATE_KEY` fallback.
 */

import { type IAgentRuntime, logger, Service } from "@elizaos/core";
import { type CashClient, createCashClient } from "@zkp2p/cash";
import { type PeerCashConfig, resolvePeerCashConfig } from "./environment.js";
import { type ResolvedSigner, resolveSigner, signerAddressOrNull } from "./wallet.js";

export const PEER_CASH_SERVICE_TYPE = "peer-cash";

export class PeerCashService extends Service {
  static override serviceType = PEER_CASH_SERVICE_TYPE;

  capabilityDescription =
    "Peer Cash offramp: estimate and execute Base USDC cash-outs to fiat payment apps at the " +
    "live oracle market rate, then track, withdraw, and top up orders.";

  private resolvedConfig: PeerCashConfig | null = null;
  private client: CashClient | null = null;

  constructor(runtime?: IAgentRuntime, config?: PeerCashConfig) {
    super(runtime);
    this.resolvedConfig = config ?? null;
  }

  static override async start(runtime: IAgentRuntime): Promise<PeerCashService> {
    // Configuration is validated eagerly so a malformed environment or key
    // fails the plugin load, not the first cash-out.
    const config = resolvePeerCashConfig(runtime);
    logger.info(
      `[plugin-peer-cash] service started (environment ${config.environment}, referral ` +
        `${config.referralCode ? "configured" : "not configured"})`,
    );
    return new PeerCashService(runtime, config);
  }

  async stop(): Promise<void> {
    this.client = null;
  }

  getConfig(): PeerCashConfig {
    if (!this.resolvedConfig) {
      this.resolvedConfig = resolvePeerCashConfig(this.runtime);
    }
    return this.resolvedConfig;
  }

  /** Lazily created `CashClient` for the configured environment. */
  getClient(): CashClient {
    if (!this.client) {
      const config = this.getConfig();
      this.client = createCashClient({
        environment: config.environment,
        ...(config.rpcUrl ? { rpcUrl: config.rpcUrl } : {}),
        ...(config.referralCode ? { referralCode: config.referralCode } : {}),
        ...(config.referrer ? { referrer: config.referrer } : {}),
      });
    }
    return this.client;
  }

  /** Resolve the agent's Base signer; throws an actionable error when absent. */
  getSigner(): ResolvedSigner {
    return resolveSigner(this.runtime, this.getConfig());
  }

  /** Signer address without throwing - for context providers and defaults. */
  getSignerAddressOrNull(): `0x${string}` | null {
    return signerAddressOrNull(this.runtime, this.getConfig());
  }
}

/** Typed service lookup used by every action; null when the plugin is not loaded. */
export function getPeerCashService(runtime: IAgentRuntime): PeerCashService | null {
  const service = runtime.getService(PEER_CASH_SERVICE_TYPE);
  if (service instanceof PeerCashService) return service;
  // Duck-typed acceptance keeps tests and dual-module hosts working when the
  // class identity differs but the surface matches.
  if (
    service !== null &&
    typeof (service as PeerCashService).getClient === "function" &&
    typeof (service as PeerCashService).getConfig === "function" &&
    typeof (service as PeerCashService).getSigner === "function"
  ) {
    return service as PeerCashService;
  }
  return null;
}
