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
    // The preview is the text the user answers "yes" to, while the pending
    // key binds the real amount, payee, platform, and order. A paraphrase
    // that drops the payee or rounds the amount is confirmed against terms
    // never shown. `userFacingText` alone also keeps core from treating a
    // finished confirmation turn as a silent finish and replanning it - on
    // replan the second `requireConfirmation` call finds the still-fresh
    // pending record, matches the original request text against neither the
    // confirm nor the cancel regex, and cancels the operation mid-turn.
    userFacingText: gate.text,
    // Marks the preview canonical so it outranks the evaluator's message.
    // Only on the pending turn: core consults this override on successful
    // steps alone, so setting it on the cancellation would be inert. Note
    // the override also needs the gated action to be the turn's *only*
    // successful step; when the planner pairs a read verb with the write in
    // one turn, `userFacingText` is what still carries the exact terms.
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
