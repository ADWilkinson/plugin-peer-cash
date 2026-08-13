/**
 * Withdraw action tests: full close and partial withdrawal through the
 * confirmation gate, prune reporting, and the blocked-withdrawal error path.
 */

import { CashError, usdc } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
import { peerCashWithdrawAction } from "../actions/withdraw.js";
import {
  createCallbackSpy,
  createMockCashClient,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
  withdrawResultFixture,
} from "./test-utils.js";

describe("PEER_CASH_WITHDRAW", () => {
  it("gates a full withdrawal and then closes the order", async () => {
    const { runtime, client } = createRuntimeWithService();
    const { callback, calls } = createCallbackSpy();

    const pending = await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("Cancel base_412"),
      emptyState,
      { parameters: { depositId: "base_412" } },
      callback,
    );
    expect(pending?.data?.requiresConfirmation).toBe(true);
    expect(calls[0]?.text).toContain("all remaining funds");
    expect(client.withdraw).not.toHaveBeenCalled();

    const result = await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: { depositId: "base_412" } },
      undefined,
    );

    expect(client.withdraw).toHaveBeenCalledOnce();
    const [depositId, options] = client.withdraw.mock.calls[0];
    expect(depositId).toBe("base_412");
    expect(options.amount).toBeUndefined();
    expect(result?.success).toBe(true);
    expect(result?.text).toContain("Order closed; all remaining funds returned");
  });

  it("passes the partial amount through and says so", async () => {
    const { runtime, client } = createRuntimeWithService();

    await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("Withdraw 25 from base_412"),
      emptyState,
      { parameters: { depositId: "base_412", amount: 25 } },
      undefined,
    );
    const result = await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: { depositId: "base_412", amount: 25 } },
      undefined,
    );

    const [, options] = client.withdraw.mock.calls[0];
    expect(options.amount).toBe(usdc(25));
    expect(result?.success).toBe(true);
    expect(result?.text).toContain("Partial withdrawal of 25 USDC");
  });

  it("reports the prune transaction when expired intents were cleared", async () => {
    const client = createMockCashClient({
      withdraw: vi.fn(async () => ({
        ...withdrawResultFixture,
        pruneTxHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
      })),
    });
    const { runtime } = createRuntimeWithService({ client });

    await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("Close base_412"),
      emptyState,
      { parameters: { depositId: "base_412" } },
      undefined,
    );
    const result = await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: { depositId: "base_412" } },
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("Expired buyer intents were pruned first");
  });

  it("maps a blocked withdrawal to its remediation", async () => {
    const client = createMockCashClient({
      withdraw: vi.fn(async () => {
        throw new CashError({
          code: "ACTIVE_INTENT_BLOCKS_WITHDRAWAL",
          message: "a live buyer intent locks these funds",
          retryable: true,
          remediation: "Wait for fill/expiry, or withdraw only the unlocked amount.",
        });
      }),
    });
    const { runtime } = createRuntimeWithService({ client });

    await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("Close base_412"),
      emptyState,
      { parameters: { depositId: "base_412" } },
      undefined,
    );
    const result = await peerCashWithdrawAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: { depositId: "base_412" } },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("ACTIVE_INTENT_BLOCKS_WITHDRAWAL");
    expect(result?.text).toContain("withdraw only the unlocked amount");
  });
});
