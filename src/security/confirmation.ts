/**
 * Confirmation gate for every funds-moving Peer Cash action (`cashout`,
 * `withdraw`, `top-up`). Mirrors the wallet plugin's financial gate: core's
 * `requireConfirmation` stashes a pending record keyed off the economic
 * parameters and only a yes-shaped user reply on a later turn releases the
 * operation. LLM-supplied flags cannot bypass it because the pending key is
 * derived from the actual amount/platform/payee/deposit parameters, not from
 * caller-controlled booleans. Do not remove or short-circuit this gate.
 */

import type {
  ActionResult,
  ConfirmationDecision,
  HandlerCallback,
  IAgentRuntime,
  Memory,
} from "@elizaos/core";
import { requireConfirmation } from "@elizaos/core";
import { formatUsdc } from "@zkp2p/cash";

/** Cache namespace for Peer Cash funds-moving confirmations. */
export const PEER_CASH_CONFIRM_ACTION = "PEER_CASH_FINANCIAL";

export type PeerCashWriteOperation = "cashout" | "withdraw" | "top-up";

export interface PeerCashWriteParams {
  operation: PeerCashWriteOperation;
  environment: string;
  /** USDC base units being deposited, withdrawn, or added. Absent = full withdrawal. */
  amountBaseUnits?: bigint;
  platform?: string;
  currency?: string;
  payee?: string;
  depositId?: string;
}

/**
 * Stable pending key binding the confirmation to the exact economic
 * parameters - a "yes" cannot authorize a different amount, payee, or order.
 */
export function peerCashPendingKey(params: PeerCashWriteParams): string {
  const entries: [string, string][] = [
    ["op", params.operation],
    ["env", params.environment],
    ["amount", params.amountBaseUnits === undefined ? "full" : params.amountBaseUnits.toString()],
    ["platform", (params.platform ?? "").toLowerCase()],
    ["currency", (params.currency ?? "").toUpperCase()],
    ["payee", params.payee ?? ""],
    ["depositId", params.depositId ?? ""],
  ];
  return entries.map(([key, value]) => `${key}=${value}`).join("|");
}

/** Human-readable preview of the pending operation. */
export function peerCashPreview(params: PeerCashWriteParams): string {
  const amount =
    params.amountBaseUnits === undefined ? "" : `${formatUsdc(params.amountBaseUnits)} USDC`;
  switch (params.operation) {
    case "cashout":
      return (
        `Cash out ${amount} to ${params.payee ?? "?"} on ${params.platform ?? "?"} in ` +
        `${params.currency ?? "?"} at the live oracle market rate (0% spread, rate resolves ` +
        "when a buyer fills)? Reply yes to submit or no to cancel."
      );
    case "withdraw": {
      const scope = params.amountBaseUnits === undefined ? "all remaining funds" : amount;
      return (
        `Withdraw ${scope} from Peer Cash order ${params.depositId ?? "?"} back to the agent ` +
        "wallet? Reply yes to submit or no to cancel."
      );
    }
    case "top-up":
      return (
        `Add ${amount} to Peer Cash order ${params.depositId ?? "?"} (same payee, same live ` +
        "market rate)? Reply yes to submit or no to cancel."
      );
  }
}

export type PeerCashGateResult =
  | { readonly proceed: true }
  | {
      readonly proceed: false;
      readonly decision: ConfirmationDecision;
      readonly text: string;
    };

/**
 * Two-phase gate: first invocation stashes the pending record and emits the
 * preview; the follow-up user turn decides confirmed or cancelled.
 * `extraPreview` adds informational context (for example the current oracle
 * estimate) to the prompt without entering the pending key - only the
 * economic parameters bind the confirmation.
 */
export async function gatePeerCashExecution(args: {
  runtime: IAgentRuntime;
  message: Memory;
  params: PeerCashWriteParams;
  callback?: HandlerCallback;
  extraPreview?: string;
}): Promise<PeerCashGateResult> {
  const preview = args.extraPreview
    ? `${peerCashPreview(args.params)} ${args.extraPreview}`
    : peerCashPreview(args.params);
  const decision = await requireConfirmation({
    runtime: args.runtime,
    message: args.message,
    actionName: PEER_CASH_CONFIRM_ACTION,
    pendingKey: peerCashPendingKey(args.params),
    prompt: preview,
    callback: args.callback,
    metadata: { operation: args.params.operation },
  });

  if (decision.status === "confirmed") {
    return { proceed: true };
  }

  const text = decision.status === "pending" ? preview : "Peer Cash operation cancelled.";
  return { proceed: false, decision, text };
}

/** `ActionResult` for a gate that did not proceed (pending or cancelled). */
export function peerCashGateActionResult(
  gate: Extract<PeerCashGateResult, { proceed: false }>,
): ActionResult {
  const awaiting = gate.decision.status === "pending";
  return {
    success: awaiting,
    text: gate.text,
    // The gate said wait or no, so the turn ends here. `continueChain: false`
    // is the only lever core reads to stop its planner loop; the
    // `requiresConfirmation` and `awaitingUserInput` flags below are
    // diagnostics core never consults. Let the loop run on and it plans
    // another call in the same turn, and both outcomes move funds the user
    // never approved:
    //
    // - After a prompt, the re-entry consumes the still-fresh pending record
    //   and tests core's confirm regex against the *original request*. That
    //   regex is anchored at the start of the text and accepts "ok", "sure",
    //   "do it", "go ahead", "yes". A request that opens with any of them
    //   confirms itself, and the cash-out submits on the turn the user was
    //   only ever shown the preview.
    // - After a decline, the re-plan finds no record and arms a fresh one for
    //   the terms just refused, live for core's five-minute TTL, releasable
    //   by the next confirm-shaped message the user sends about anything.
    //
    // Halting also makes this result's `text` the turn's final message
    // verbatim, so the preview the pending key binds is what the user answers.
    continueChain: false,
    // The preview is the text the user answers "yes" to, while the pending
    // key binds the real amount, payee, platform, and order. A paraphrase
    // that drops the payee or rounds the amount is confirmed against terms
    // never shown. The halt above already carries `text` through core's
    // final-message path; this is the fallback for any host that resolves the
    // reply some other way.
    userFacingText: gate.text,
    // Belt and braces behind the halt: were the reply ever to reach the
    // evaluator, this outranks its paraphrase. Only on the pending turn -
    // core consults the override on successful steps alone, so setting it on
    // the cancellation would be inert.
    verifiedUserFacing: awaiting,
    values: {
      peerCashActionPrepared: awaiting,
      peerCashActionSucceeded: false,
    },
    data: {
      requiresConfirmation: awaiting,
      confirmationStatus: gate.decision.status,
      awaitingUserInput: awaiting,
    },
  };
}
