/**
 * Canonical-reply contract across every action and every reply it can end a
 * turn on. Success paths, the confirmation preview, and the failure paths all
 * render identifiers, amounts, and counts - deposit ids, transaction hashes,
 * payout corridors, oracle rates, fill numbers - and core's planner loop only
 * echoes an action's text verbatim when the result carries `userFacingText`;
 * `verifiedUserFacing: true` additionally outranks the evaluator, but core
 * consults it on successful steps only. Without `userFacingText` the terminal
 * reply is the model's paraphrase of those numbers. This suite fails when any
 * verb drops it.
 */

import type { Action, ActionResult, IAgentRuntime, JsonValue, Memory } from "@elizaos/core";
import { CashError } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
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
import {
  createMockCashClient,
  createMockRuntime,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
} from "./test-utils.js";

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

/** All registered verbs, so a new one cannot skip the contracts below. */
const registeredActions: Action[] = [...(peerCashPlugin.actions ?? [])];

/** Parameters that reach each verb's own logic rather than a validation throw. */
const parametersByAction: Record<string, Record<string, JsonValue>> = Object.fromEntries(
  [...readCases, ...writeCases].map(([action, parameters]) => [action.name, parameters]),
);

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

describe("canonical confirmation preview", () => {
  // The preview is the text the user answers "yes" to, and the pending key
  // binds the real amount, payee, platform, and order. A paraphrase that
  // drops or alters any of them is confirmed against terms the user never
  // saw, so this result must be echoed verbatim.
  it.each(writeCases)(
    "$name marks its confirmation prompt canonical",
    async (action, parameters) => {
      const { runtime } = createRuntimeWithService();
      const result = await run(action, runtime, createTestMessage("do it"), parameters);

      expect(result.success).toBe(true);
      expect(result.data?.awaitingUserInput).toBe(true);
      expect(result.verifiedUserFacing).toBe(true);
      expect(result.userFacingText).toBe(result.text);
    },
  );

  it.each(writeCases)("$name marks its cancellation canonical", async (action, parameters) => {
    const { runtime } = createRuntimeWithService();
    await run(action, runtime, createTestMessage("do it"), parameters);
    const result = await run(action, runtime, createTestMessage("no"), parameters);

    expect(result.success).toBe(false);
    expect(result.userFacingText).toBe(result.text);
  });

  it("submits nothing until the preview the user saw is confirmed", async () => {
    const { runtime, client } = createRuntimeWithService();
    const parameters = { amount: 100, platform: "venmo", currency: "USD", payee: "@alice" };
    const prompt = await run(
      peerCashCashoutAction,
      runtime,
      createTestMessage("cash out"),
      parameters,
    );

    expect(client.cashout).not.toHaveBeenCalled();
    // The economic terms the pending key binds must all be in the echoed text.
    expect(prompt.userFacingText).toContain("100 USDC");
    expect(prompt.userFacingText).toContain("@alice");
    expect(prompt.userFacingText).toContain("venmo");
    expect(prompt.userFacingText).toContain("USD");
  });
});

describe("canonical failure text", () => {
  // A failed step's text carries the SDK error code, the retryable flag, and
  // the remediation sentence. Core reads `userFacingText` on any step for the
  // fallback reply, so a failure without it degrades to a generic apology.
  it.each(registeredActions)(
    "$name marks a service-unavailable result canonical",
    async (action) => {
      const runtime = createMockRuntime();
      const result = await run(
        action,
        runtime,
        createTestMessage("ask"),
        parametersByAction[action.name] ?? {},
      );

      expect(result.success).toBe(false);
      expect(result.userFacingText).toBe(result.text);
    },
  );

  it("marks a cash verb failure canonical with its code and remediation", async () => {
    const client = createMockCashClient({
      estimate: vi.fn(async () => {
        throw new CashError({
          code: "ORACLE_READ_FAILED",
          message: "oracle read failed",
          retryable: true,
          remediation: "Retry the read through a healthy Base RPC.",
        });
      }),
    });
    const { runtime } = createRuntimeWithService({ client });
    const result = await run(peerCashEstimateAction, runtime, createTestMessage("rate?"), {
      amount: 1000,
      currency: "EUR",
    });

    expect(result.success).toBe(false);
    expect(result.text).toContain("ORACLE_READ_FAILED");
    expect(result.text).toContain("Retry the read through a healthy Base RPC.");
    expect(result.userFacingText).toBe(result.text);
  });
});
