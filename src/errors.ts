/**
 * Failure translation from `@zkp2p/cash` typed errors to agent-facing action
 * results. Every `CashError` carries `code`, `retryable`, and a `remediation`
 * sentence; this module folds those into one honest message plus a
 * serializable data payload (including any recovery evidence) so the planner
 * and the user both see what failed and what to do next. No failure is
 * swallowed or rewritten into fake success.
 */

import type { ActionResult, ProviderDataRecord } from "@elizaos/core";
import { isCashError } from "@zkp2p/cash";

export interface CashFailureDescription {
  /** One user-facing sentence: what failed, why, and the remediation. */
  text: string;
  /** Serializable diagnostic payload for `ActionResult.data`. */
  data: ProviderDataRecord;
  /** Original error message for `ActionResult.error`. */
  message: string;
}

/** Normalize any thrown value from a cash verb into an agent-facing shape. */
export function describeCashFailure(error: unknown, context: string): CashFailureDescription {
  if (isCashError(error)) {
    const shape = error.toJSON();
    const retryNote = shape.retryable ? "retryable" : "not retryable";
    return {
      text: `${context} failed: ${shape.message} ${shape.remediation} (code ${shape.code}, ${retryNote})`,
      data: {
        error: shape.code,
        retryable: shape.retryable,
        remediation: shape.remediation,
        ...(shape.recovery ? { recovery: shape.recovery } : {}),
      },
      message: shape.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    text: `${context} failed: ${message}`,
    data: { error: message },
    message,
  };
}

/** Build the canonical failed `ActionResult` for a cash verb. */
export function cashFailureResult(error: unknown, context: string): ActionResult {
  const failure = describeCashFailure(error, context);
  return {
    success: false,
    text: failure.text,
    // Carries the SDK error code, the retryable flag, and the remediation
    // sentence. Core reads `userFacingText` on any step for its fallback
    // reply, so without it a failed cash verb degrades to a generic apology
    // that tells the agent nothing about whether funds moved. The
    // `verifiedUserFacing` override is deliberately not set: core consults it
    // on successful steps only.
    userFacingText: failure.text,
    error: failure.message,
    data: failure.data,
  };
}
