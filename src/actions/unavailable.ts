/**
 * Canonical failure for actions invoked while the Peer Cash service is not
 * registered - misconfiguration surfaces as an explicit, actionable result
 * instead of an opaque throw or a fabricated success.
 */

import type { ActionResult, HandlerCallback, Memory } from "@elizaos/core";

export async function serviceUnavailableResult(
  actionName: string,
  message: Memory,
  callback?: HandlerCallback,
): Promise<ActionResult> {
  const text =
    "Peer Cash is unavailable: the plugin service has not started. Verify the plugin is " +
    "installed and PEER_CASH_ENVIRONMENT is valid, then restart the agent.";
  if (callback) {
    await callback({ text, actions: [actionName], source: message.content.source });
  }
  return {
    success: false,
    text,
    // Names the exact setting to check; echoed rather than paraphrased for
    // the same reason as every other failure text here.
    userFacingText: text,
    error: "peer-cash service not registered",
    data: { error: "SERVICE_NOT_REGISTERED" },
  };
}
