/**
 * Canonical-reply contract across every action and every reply it can end a
 * turn on. Success paths, the confirmation preview, and the failure paths all
 * render identifiers, amounts, and counts - deposit ids, transaction hashes,
 * payout corridors, oracle rates, fill numbers - and core's planner loop only
 * echoes an action's text verbatim when the result carries `userFacingText`;
 * `verifiedUserFacing: true` additionally outranks the evaluator, but core
 * consults it only on a step that succeeded and only when it is the turn's
 * single successful step. Without `userFacingText` the terminal reply is the
 * model's paraphrase of those numbers, and without `continueChain: false`
 * neither the confirmation prompt nor the receipt that follows it is even the
 * turn's last word - a second successful step in the same turn is enough to
 * spend the single-step budget the override needs. This suite fails when any
 * verb drops either; the coverage test below keeps the case lists equal to the
 * plugin's own registration.
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
  cashoutResultFixture,
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
    // Funds have moved and this text is the receipt for them. Ending the turn
    // here is what makes it the reply verbatim; see the test below for the
    // ordinary turn where the override alone would not have held.
    expect(result.continueChain).toBe(false);
  });

  // The hazard the receipt halt exists to stop. Core's canonical override only
  // outranks the evaluator when the turn has exactly one successful step, and a
  // planner that priced the cash-out before submitting it has already spent
  // that budget - so without the halt these identifiers reach the user only as
  // whatever the model wrote about them. A unit test cannot run core's planner
  // loop, so the second successful step is driven directly.
  it("ends the turn on a cash-out receipt priced by an earlier successful step", async () => {
    const { runtime, client } = createRuntimeWithService();
    const parameters = { amount: 100, platform: "venmo", currency: "USD", payee: "@alice" };
    const call = (text: string) =>
      run(peerCashCashoutAction, runtime, createTestMessage(text), parameters);

    const estimate = await run(peerCashEstimateAction, runtime, createTestMessage("rate?"), {
      amount: 100,
      currency: "USD",
    });
    await call("cash out 100 USDC to @alice on venmo");
    const receipt = await call("yes");

    expect(estimate.success).toBe(true);
    expect(receipt.continueChain).toBe(false);
    // The keys that reach an order already holding the user's USDC.
    expect(receipt.userFacingText).toContain(cashoutResultFixture.depositId);
    expect(receipt.userFacingText).toContain(cashoutResultFixture.txHash);
    expect(client.cashout).toHaveBeenCalledTimes(1);
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
      // Ends the turn on the ask, so nothing plans past a gate still waiting
      // on the user. See the re-entry test below for what that prevents.
      expect(result.continueChain).toBe(false);
    },
  );

  // The hazard the halt exists to stop, driven directly because a unit test
  // cannot run core's planner loop. Core's confirm regex is anchored at the
  // start of the message and accepts "ok", "sure", "do it", "go ahead"; on a
  // second call inside one turn it tests that regex against the original
  // request, so a request opening with one of those words confirms itself.
  const reentryCases: Array<[string, string, number]> = [
    ["go ahead and cash out 100 USDC to @alice on venmo", "submit unapproved", 1],
    ["do it", "submit unapproved", 1],
    ["cash out 100 USDC to @alice on venmo", "cancel mid-approval", 0],
  ];

  it.each(reentryCases)(
    "re-entering the gate on %j would %s",
    async (request, _outcome, submissions) => {
      const { runtime, client } = createRuntimeWithService();
      const parameters = { amount: 100, platform: "venmo", currency: "USD", payee: "@alice" };
      const message = createTestMessage(request);
      const call = () => run(peerCashCashoutAction, runtime, message, parameters);

      const prompt = await call();
      const reentry = await call();

      // The prompt halting the chain is what keeps the second call from ever
      // happening; the second call's outcome is why that matters.
      expect(prompt.continueChain).toBe(false);
      expect(reentry.text).not.toBe(prompt.text);
      expect(client.cashout).toHaveBeenCalledTimes(submissions);
    },
  );

  it.each(writeCases)("$name marks its cancellation canonical", async (action, parameters) => {
    const { runtime } = createRuntimeWithService();
    await run(action, runtime, createTestMessage("do it"), parameters);
    const result = await run(action, runtime, createTestMessage("no"), parameters);

    expect(result.success).toBe(false);
    expect(result.text).toBeTruthy();
    expect(result.userFacingText).toBe(result.text);
    // The override is success-gated in core, so claiming it here would be
    // inert; the cancellation rides the `userFacingText` fallback instead.
    expect(result.verifiedUserFacing).not.toBe(true);
    // A decline ends the turn too. Planning on would re-arm a fresh pending
    // record for the terms just refused, which the user's next confirm-shaped
    // message would release.
    expect(result.continueChain).toBe(false);
  });

  it("a declined operation leaves no gate armed behind it", async () => {
    const { runtime, client } = createRuntimeWithService();
    const parameters = { amount: 100, platform: "venmo", currency: "USD", payee: "@alice" };
    const call = (text: string) =>
      run(peerCashCashoutAction, runtime, createTestMessage(text), parameters);

    await call("cash out 100 USDC to @alice on venmo");
    const declined = await call("no");
    // What a planner loop that ignored the halt would do: re-plan the write,
    // arm a new record, and hand the next yes an operation the user refused.
    const rearmed = await call("cash out 100 USDC to @alice on venmo");
    await call("yes");

    expect(declined.continueChain).toBe(false);
    expect(rearmed.data?.confirmationStatus).toBe("pending");
    expect(client.cashout).toHaveBeenCalledTimes(1);
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
  it.each([...readCases, ...writeCases])(
    "$name marks a service-unavailable result canonical",
    async (action, parameters) => {
      const runtime = createMockRuntime();
      const result = await run(action, runtime, createTestMessage("ask"), parameters);

      expect(result.success).toBe(false);
      expect(result.text).toBeTruthy();
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
