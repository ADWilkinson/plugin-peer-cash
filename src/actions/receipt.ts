/**
 * Reporting path for a funds-moving verb whose confirmation has been spent.
 * Once the SDK call has returned - or thrown - the money question is settled,
 * and everything that follows is description: rendering the receipt and
 * handing it to the host transport. None of that may throw.
 *
 * A throw there does not just lose the text. It escapes the handler's own
 * catch block, because that block emits through the same failing callback, so
 * the action returns no `ActionResult` at all: no receipt, no deposit id, no
 * `continueChain: false`, and - since core recorded no successful step for the
 * verb - nothing stopping the planner from submitting the whole operation a
 * second time against the user's still-current "yes". `submitConfirmed`
 * covers a submission that failed; this covers everything after one that did
 * not.
 *
 * The `ActionResult` carries the same text in `userFacingText`, so a receipt
 * whose emit failed still reaches the user through core's final-message path.
 */

import type { HandlerCallback, Memory } from "@elizaos/core";
import { logger } from "@elizaos/core";

/**
 * Render a receipt that reads from SDK result objects, degrading to a
 * `fallback` built only from values already read off the result. The full
 * text is preferred; losing an order summary is survivable, losing the
 * deposit id the fallback carries is not.
 */
export function composeReceipt(compose: () => string, fallback: string): string {
  // error-policy:J4 user-facing degrade - the operation has already settled;
  // a formatting failure may not turn it into a reported failure.
  try {
    return compose();
  } catch (error) {
    logger.warn(
      `[plugin-peer-cash] receipt formatting failed, reporting the short form: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallback;
  }
}

/**
 * Emit a settled funds-moving verb's text through the host callback. A
 * transport that is down, rate-limited, or rejecting the message is logged
 * and swallowed so the caller still returns its result.
 */
export async function emitSettled(args: {
  actionName: string;
  message: Memory;
  text: string;
  callback?: HandlerCallback;
}): Promise<void> {
  if (!args.callback) return;
  // error-policy:J4 user-facing degrade - see the module comment: the emit is
  // delivery, and delivery failing cannot be allowed to unmake the result.
  try {
    await args.callback({
      text: args.text,
      actions: [args.actionName],
      source: args.message.content.source,
    });
  } catch (error) {
    logger.warn(
      `[plugin-peer-cash] ${args.actionName} could not deliver its reply through the host ` +
        `callback; the result still carries the text: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
}
