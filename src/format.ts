/**
 * Text rendering for cash verbs: estimates, orders, capabilities, and fill
 * stats become short user-facing summaries. Wording never promises a locked
 * rate - Peer Cash resolves the binding rate at the Chainlink oracle when a
 * buyer fills - and order summaries lean on the SDK's own `explain()`
 * sentence plus its `nextActions` instead of local heuristics.
 */

import type {
  CashCapabilities,
  CashEstimate,
  CashFillStats,
  CashOrder,
  CashPlatformCapability,
} from "@zkp2p/cash";
import { formatUsdc } from "@zkp2p/cash";

/** Human-format a fiat number without artificial precision. */
function fiat(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatEstimateText(estimate: CashEstimate): string {
  const usdcAmount = formatUsdc(estimate.amount);
  const bindingLine =
    estimate.binding === "deposit-creation"
      ? "This is a live Chainlink snapshot with 0% spread, not a locked quote; the rate binds " +
        "when the deposit is created."
      : "This is a live Chainlink oracle estimate with 0% spread, not a locked quote; the final " +
        "rate resolves at the oracle when a buyer fills.";
  const lines = [
    `Estimated cash-out: about ${fiat(estimate.receiveAmount)} ${estimate.currency} for ` +
      `${usdcAmount} USDC at roughly ${estimate.rate.toFixed(4)} ${estimate.currency}/USDC.`,
    bindingLine,
  ];
  if (estimate.eta?.label) {
    lines.push(`Typical time to first fill (30-day history): ${estimate.eta.label}.`);
  }
  if (estimate.stale) {
    lines.push("Warning: the oracle reading is more than a day old; treat this rate with caution.");
  }
  return lines.join(" ");
}

export function formatOrderText(order: CashOrder): string {
  const lines = [
    order.explain(),
    `Order ${order.depositId}: state ${order.state}; total ${formatUsdc(order.totalAmount)} USDC, ` +
      `filled ${formatUsdc(order.filledAmount)}, pending ${formatUsdc(order.pendingAmount)}, ` +
      `returned ${formatUsdc(order.returnedAmount)}.`,
  ];
  if (order.nextActions.length > 0) {
    lines.push(`Available next actions: ${order.nextActions.join(", ")}.`);
  }
  return lines.join(" ");
}

export function formatOrderListText(orders: CashOrder[], owner: string): string {
  if (orders.length === 0) {
    return `No Peer Cash orders found for ${owner}.`;
  }
  const rows = orders.map(
    (order) =>
      `- ${order.depositId}: ${order.state}, total ${formatUsdc(order.totalAmount)} USDC, ` +
      `filled ${formatUsdc(order.filledAmount)}, next: ${
        order.nextActions.length > 0 ? order.nextActions.join("/") : "none"
      }`,
  );
  return [`Peer Cash orders for ${owner} (${orders.length}):`, ...rows].join("\n");
}

/**
 * Fills for one platform over the 30-day window. `CashFillStats` keys a single
 * fill under both its `platform:CURRENCY` pair and, when the deposit offered
 * several currencies, an aggregate `platform:EUR+GBP+USD` set key. Only the
 * single-currency pairs are summed, or every multi-currency corridor would be
 * counted twice.
 */
function platformFills(fillStats: CashFillStats, platform: string): number {
  const prefix = `${platform}:`;
  return Object.entries(fillStats)
    .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("+"))
    .reduce((sum, [, value]) => sum + value.fills, 0);
}

function creationBoundCurrencies(platform: CashPlatformCapability): string[] {
  return Object.entries(platform.pricing ?? {})
    .filter(([, pricing]) => pricing?.kind === "fixed-at-deposit-creation")
    .map(([currency]) => currency);
}

function catalogHasCreationBoundCorridor(capabilities: CashCapabilities): boolean {
  return capabilities.platforms.some((platform) => creationBoundCurrencies(platform).length > 0);
}

export function formatCapabilitiesText(
  capabilities: CashCapabilities,
  fillStats: CashFillStats | null,
  statsNote: string | null,
): string {
  const rateLine = catalogHasCreationBoundCorridor(capabilities)
    ? `Peer Cash (${capabilities.environment}) cashes out Base USDC to fiat at a zero-spread ` +
      "Chainlink market rate. Most corridors bind when a buyer fills; corridors marked below " +
      "bind when the deposit is created."
    : `Peer Cash (${capabilities.environment}) cashes out Base USDC to fiat at the live oracle ` +
      "market rate with 0% spread.";
  const lines: string[] = [
    rateLine,
    `Minimum ${formatUsdc(capabilities.amount.min)} USDC ` +
      `(recommended at least ${formatUsdc(capabilities.amount.recommendedMin)} USDC), no maximum.`,
    "Payout platforms:",
  ];
  for (const platform of capabilities.platforms) {
    const attestation = platform.requiresIdentityAttestation
      ? " (new payees need a Peer identity attestation)"
      : "";
    const creationBound = creationBoundCurrencies(platform);
    const binding =
      creationBound.length > 0
        ? ` (${creationBound.join(", ")} binds when the deposit is created)`
        : "";
    const stats = fillStats ? platformFills(fillStats, platform.platform) : null;
    const statsSuffix = stats !== null && stats > 0 ? ` [${stats} fills in the last 30 days]` : "";
    lines.push(
      `- ${platform.platform}: ${platform.currencies.join(", ")}; payee: ${platform.payeeHint}` +
        `${attestation}${binding}${statsSuffix}`,
    );
  }
  if (statsNote) lines.push(statsNote);
  return lines.join("\n");
}
