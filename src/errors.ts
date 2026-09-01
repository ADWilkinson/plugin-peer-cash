/**
 * Failure translation from `@zkp2p/cash` typed errors to agent-facing action
 * results. Every `CashError` carries `code`, `retryable`, and a `remediation`
 * sentence; this module folds those into one honest message plus a
 * serializable data payload (including any recovery evidence) so the planner
 * and the user both see what failed and what to do next. No failure is
 * swallowed or rewritten into fake success.
 *
 * Failures raised by an already-confirmed funds-moving submission are tagged
 * with {@link submitConfirmed} so they also end the turn; see the class
 * comment below for what runs on if they do not.
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

/**
 * Marks a failure thrown by a funds-moving call the user had already
 * confirmed. Core consumed and cleared the pending record before the call, so
 * the confirmation that authorized it no longer exists, and core's planner
 * loop skips only tool calls that *succeeded* with identical args this turn -
 * a failed one is free to be planned again. Re-planning the verb re-enters the
 * gate with no record present, arms a fresh one for the same terms, and the
 * next re-entry inside that same turn tests core's confirm regex against the
 * user's still-current "yes" and submits a second time.
 *
 * That retry is exactly what several `@zkp2p/cash` failures forbid, because
 * they mean the first attempt already moved the funds or may have:
 * `ACCESS_POLICY_CONFIGURATION_FAILED` names the deposit it created,
 * `DEPOSIT_RESOLUTION_FAILED` reports a deposit transaction that succeeded
 * with an id nobody could read back, and `TRANSACTION_SUBMISSION_UNKNOWN` /
 * `TRANSACTION_STATUS_UNKNOWN` mean a transaction of unknown outcome. All of
 * them are `retryable: false` and their remediation says in words not to
 * submit the operation again before inspecting the evidence - but that is
 * advice to a reader, and the planner is not stopped by prose. The halt is.
 */
export class PeerCashSubmissionError extends Error {
  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = "PeerCashSubmissionError";
  }
}

/**
 * Run the confirmed submission of a funds-moving verb, tagging any failure as
 * post-confirmation so {@link cashFailureResult} ends the turn on it. Wrap the
 * submission call only: parameter, catalog, and signer failures happen before
 * the gate releases anything and stay re-plannable.
 */
export async function submitConfirmed<T>(submit: () => Promise<T>): Promise<T> {
  try {
    return await submit();
  } catch (error) {
    throw new PeerCashSubmissionError(error);
  }
}

/** Build the canonical failed `ActionResult` for a cash verb. */
export function cashFailureResult(error: unknown, context: string): ActionResult {
  const submitted = error instanceof PeerCashSubmissionError;
  const failure = describeCashFailure(submitted ? error.reason : error, context);
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
    // A confirmed submission that failed ends the turn, for the same reason
    // its receipt does. Halting stops the re-plan that would resubmit funds
    // the user approved moving once, and it makes this text - the only place
    // the code, the remediation, and any recovery evidence reach the user -
    // the turn's final message verbatim rather than a paraphrase of it. A
    // read verb keeps planning on: nothing it did needs undoing, and the
    // planner can still recover the turn from a stale estimate or a lagging
    // indexer.
    ...(submitted ? { continueChain: false } : {}),
    error: failure.message,
    data: failure.data,
  };
}
