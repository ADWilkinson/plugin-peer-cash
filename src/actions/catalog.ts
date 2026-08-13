/**
 * Catalog validation against the live `capabilities()` surface. Platform and
 * currency inputs are only accepted when the active environment's catalog
 * lists them, so typos fail closed with the supported options instead of
 * reaching the protocol as unsupported hashes.
 */

import type { CashCapabilities, CurrencyType } from "@zkp2p/cash";

export interface ResolvedPlatform {
  platform: string;
  currencies: CurrencyType[];
  payeeHint: string;
  requiresIdentityAttestation: boolean;
}

/** Case-insensitive platform lookup; throws with the supported list on miss. */
export function resolvePlatform(
  capabilities: CashCapabilities,
  platformInput: string,
): ResolvedPlatform {
  const normalized = platformInput.trim().toLowerCase();
  const match = capabilities.platforms.find((entry) => entry.platform === normalized);
  if (!match) {
    const supported = capabilities.platforms.map((entry) => entry.platform).join(", ");
    throw new Error(`platform "${platformInput}" is not supported. Supported: ${supported}`);
  }
  return {
    platform: match.platform,
    currencies: match.currencies,
    payeeHint: match.payeeHint,
    requiresIdentityAttestation: match.requiresIdentityAttestation,
  };
}

/**
 * Uppercase currency lookup, scoped to a platform when given; throws with the
 * valid options on miss.
 */
export function resolveCurrency(
  capabilities: CashCapabilities,
  currencyInput: string,
  platform?: ResolvedPlatform,
): CurrencyType {
  const normalized = currencyInput.trim().toUpperCase();
  const pool = platform ? platform.currencies : capabilities.currencies;
  const match = pool.find((currency) => currency === normalized);
  if (!match) {
    const scope = platform ? `platform ${platform.platform}` : "Peer Cash";
    throw new Error(
      `currency "${currencyInput}" is not supported by ${scope}. Supported: ${pool.join(", ")}`,
    );
  }
  return match;
}
