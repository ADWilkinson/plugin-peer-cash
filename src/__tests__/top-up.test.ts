/**
 * Top-up action tests: confirmation gate, submission arguments, and the
 * terminal-order error path.
 */

import { CashError, usdc } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
import { peerCashTopUpAction } from "../actions/top-up.js";
import {
  createCallbackSpy,
  createMockCashClient,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
} from "./test-utils.js";

const params = { depositId: "base_412", amount: 50 };

describe("PEER_CASH_TOP_UP", () => {
  it("gates the top-up and then submits with the confirmed amount", async () => {
    const { runtime, client } = createRuntimeWithService();
    const { callback, calls } = createCallbackSpy();

    const pending = await peerCashTopUpAction.handler(
      runtime,
      createTestMessage("Add 50 to base_412"),
      emptyState,
      { parameters: params },
      callback,
    );
    expect(pending?.data?.requiresConfirmation).toBe(true);
    expect(calls[0]?.text).toContain("Add 50 USDC");
    expect(client.topUp).not.toHaveBeenCalled();

    const result = await peerCashTopUpAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: params },
      undefined,
    );

    expect(client.topUp).toHaveBeenCalledOnce();
    const [depositId, amount, options] = client.topUp.mock.calls[0];
    expect(depositId).toBe("base_412");
    expect(amount).toBe(usdc(50));
    expect(options.signer).toBeDefined();
    expect(result?.success).toBe(true);
    expect(result?.text).toContain("Added 50 USDC to order base_412");
  });

  it("maps ORDER_NOT_ACTIVE to the start-a-new-cashout remediation", async () => {
    const client = createMockCashClient({
      topUp: vi.fn(async () => {
        throw new CashError({
          code: "ORDER_NOT_ACTIVE",
          message: "order base_412 is terminal",
          retryable: false,
          remediation: "Start a new cashout instead of topping up.",
        });
      }),
    });
    const { runtime } = createRuntimeWithService({ client });

    await peerCashTopUpAction.handler(
      runtime,
      createTestMessage("Add 50 to base_412"),
      emptyState,
      { parameters: params },
      undefined,
    );
    const result = await peerCashTopUpAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: params },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("ORDER_NOT_ACTIVE");
    expect(result?.text).toContain("Start a new cashout");
  });

  it("requires both depositId and amount", async () => {
    const { runtime, client } = createRuntimeWithService();

    const missingAmount = await peerCashTopUpAction.handler(
      runtime,
      createTestMessage("top up"),
      emptyState,
      { parameters: { depositId: "base_412" } },
      undefined,
    );
    expect(missingAmount?.success).toBe(false);
    expect(missingAmount?.text).toContain("amount is required");
    expect(client.topUp).not.toHaveBeenCalled();
  });
});
