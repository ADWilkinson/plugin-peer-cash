/**
 * Signer resolution for funds-moving actions. The agent's existing wallet
 * comes first: when a wallet backend service (the `@elizaos/plugin-wallet`
 * convention, service type `wallet-backend`) is registered and can sign for
 * EVM, its viem `Account` is wrapped into a Base `WalletClient`. Otherwise
 * the `EVM_PRIVATE_KEY` setting builds a local EOA. The integration is
 * duck-typed so this plugin never hard-depends on the wallet plugin package.
 */

import { type IAgentRuntime, logger } from "@elizaos/core";
import { type Account, createWalletClient, http, publicActions, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { PeerCashConfig } from "./environment.js";

/** Base mainnet - the only chain Peer Cash orders settle on. */
export const BASE_CHAIN_ID = 8453;

const WALLET_BACKEND_SERVICE_TYPE = "wallet-backend";

interface EvmWalletBackendLike {
  canSign(chainHint: "evm" | "solana" | "off-chain"): boolean;
  getEvmAccount(chainId: number): Account;
}

interface WalletBackendServiceLike {
  getWalletBackendOrNull(): EvmWalletBackendLike | null;
}

function isWalletBackendServiceLike(value: unknown): value is WalletBackendServiceLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WalletBackendServiceLike).getWalletBackendOrNull === "function"
  );
}

function isEvmWalletBackendLike(value: unknown): value is EvmWalletBackendLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EvmWalletBackendLike).canSign === "function" &&
    typeof (value as EvmWalletBackendLike).getEvmAccount === "function"
  );
}

/**
 * Account from the runtime's wallet backend service, or null when the service
 * is absent, cannot sign for EVM, or fails to produce a Base account.
 */
function walletBackendAccount(runtime: IAgentRuntime): Account | null {
  const service = runtime.getService(WALLET_BACKEND_SERVICE_TYPE);
  if (!isWalletBackendServiceLike(service)) return null;
  // error-policy:J4 user-facing degrade - a wallet backend that is registered
  // but unavailable or non-EVM falls through to the EVM_PRIVATE_KEY path; the
  // caller reports "no signer configured" when that path is also absent.
  try {
    const backend = service.getWalletBackendOrNull();
    if (!isEvmWalletBackendLike(backend) || !backend.canSign("evm")) return null;
    return backend.getEvmAccount(BASE_CHAIN_ID);
  } catch (error) {
    logger.debug(
      `[plugin-peer-cash] wallet backend present but unusable for Base signing: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export type SignerSource = "wallet-backend" | "EVM_PRIVATE_KEY";

export interface ResolvedSigner {
  walletClient: WalletClient;
  address: `0x${string}`;
  source: SignerSource;
}

function toWalletClient(account: Account, rpcUrl: string | undefined): WalletClient {
  return createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  }).extend(publicActions);
}

/**
 * Resolve the agent's Base signer. Throws an actionable error when neither
 * the wallet backend service nor `EVM_PRIVATE_KEY` can sign; funds-moving
 * actions surface that message verbatim.
 */
export function resolveSigner(runtime: IAgentRuntime, config: PeerCashConfig): ResolvedSigner {
  const backendAccount = walletBackendAccount(runtime);
  if (backendAccount) {
    return {
      walletClient: toWalletClient(backendAccount, config.rpcUrl),
      address: backendAccount.address,
      source: "wallet-backend",
    };
  }

  if (config.evmPrivateKey) {
    const account = privateKeyToAccount(config.evmPrivateKey);
    return {
      walletClient: toWalletClient(account, config.rpcUrl),
      address: account.address,
      source: "EVM_PRIVATE_KEY",
    };
  }

  throw new Error(
    "No signer is configured. Register an EVM wallet backend (for example @elizaos/plugin-wallet) " +
      "or set EVM_PRIVATE_KEY so the agent can sign Peer Cash transactions on Base.",
  );
}

/** Non-throwing address peek for context providers and defaulted reads. */
export function signerAddressOrNull(
  runtime: IAgentRuntime,
  config: PeerCashConfig,
): `0x${string}` | null {
  const backendAccount = walletBackendAccount(runtime);
  if (backendAccount) return backendAccount.address;
  if (config.evmPrivateKey) return privateKeyToAccount(config.evmPrivateKey).address;
  return null;
}
