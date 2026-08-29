/**
 * Canonical-reply contract across every action. Each success path renders
 * identifiers, amounts, and counts - deposit ids, transaction hashes, payout
 * corridors, oracle rates, fill numbers - and core's planner loop only echoes
 * an action's text verbatim when the result carries `userFacingText` with
 * `verifiedUserFacing: true`. Without both, the terminal reply is the model's
 * paraphrase of those numbers. This suite fails when any verb drops the pair.
 */

import type { Action, ActionResult, IAgentRuntime, JsonValue, Memory } from "@elizaos/core";
import { describe, expect, it } from "vitest";
import {
  peerCashCapabilitiesAction,
  peerCashCashoutAction,
  peerCashEstimateAction,
  peerCashOrderStatusAction,
  peerCashOrdersAction,
  peerCashTopUpAction,
  peerCashWithdrawAction,
} from "../actions/index.js";
import { peerCashPlugin } from "../plugin.js";
import { createRuntimeWithService, createTestMessage, emptyState } from "./test-utils.js";

async function run(
  action: Action,
  runtime: IAgentRuntime,
  message: Memory,
  parameters: Record<string, JsonValue>,
): Promise<ActionResult> {
  return (await action.handler(
    runtime,
    message,
    emptyState,
    { parameters },
    undefined,
    [],
  )) as ActionResult;
}

/** Funds-moving verbs answer only on the turn after a yes; drive both turns. */
async function runConfirmed(
  action: Action,
  parameters: Record<string, JsonValue>,
): Promise<ActionResult> {
  const { runtime } = createRuntimeWithService();
  await run(action, runtime, createTestMessage("do it"), parameters);
  return run(action, runtime, createTestMessage("yes"), parameters);
}

const readCases: Array<[Action, Record<string, JsonValue>]> = [
  [peerCashCapabilitiesAction, {}],
  [peerCashEstimateAction, { amount: 1000, currency: "EUR" }],
  [peerCashOrderStatusAction, { depositId: "base_412" }],
  [peerCashOrdersAction, {}],
];

const writeCases: Array<[Action, Record<string, JsonValue>]> = [
  [peerCashCashoutAction, { amount: 100, platform: "venmo", currency: "USD", payee: "@alice" }],
  [peerCashWithdrawAction, { depositId: "base_412" }],
  [peerCashTopUpAction, { depositId: "base_412", amount: 50 }],
];

describe("canonical user-facing text", () => {
  it.each(readCases)("$name marks its read result canonical", async (action, parameters) => {
    const { runtime } = createRuntimeWithService();
    const result = await run(action, runtime, createTestMessage("ask"), parameters);

    expect(result.success).toBe(true);
    expect(result.verifiedUserFacing).toBe(true);
    expect(result.userFacingText).toBe(result.text);
  });

  it.each(writeCases)("$name marks its submitted result canonical", async (action, parameters) => {
    const result = await runConfirmed(action, parameters);

    expect(result.success).toBe(true);
    expect(result.verifiedUserFacing).toBe(true);
    expect(result.userFacingText).toBe(result.text);
  });

  // Derived from the plugin's own registration, so a new verb that skips the
  // pair fails here instead of silently escaping the contract above.
  it("covers every registered action", () => {
    const covered = [...readCases, ...writeCases].map(([action]) => action.name).sort();
    const registered = (peerCashPlugin.actions ?? []).map((action) => action.name).sort();

    expect(covered).toEqual(registered);
  });
});
