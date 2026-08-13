/**
 * Order status action tests: explain-based summary on the happy path and the
 * retryable ORDER_NOT_FOUND mapping that distinguishes indexer lag from a
 * lost deposit.
 */

import { CashError } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
import { peerCashOrderStatusAction } from "../actions/order-status.js";
import {
  createCallbackSpy,
  createMockCashClient,
  createOrderFixture,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
} from "./test-utils.js";

const message = () => createTestMessage("Status of base_412?");

describe("PEER_CASH_ORDER_STATUS", () => {
  it("reports state, amounts, and next actions from the order", async () => {
    const { runtime, client } = createRuntimeWithService();
    const { callback, calls } = createCallbackSpy();

    const result = await peerCashOrderStatusAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { depositId: "base_412" } },
      callback,
    );

    expect(client.order).toHaveBeenCalledWith("base_412");
    expect(result?.success).toBe(true);
    expect(result?.text).toContain("Waiting for a buyer to take this order.");
    expect(result?.text).toContain("state awaiting-buyer");
    expect(result?.text).toContain("wait, withdraw");
    expect(result?.values?.peerCashOrderState).toBe("awaiting-buyer");
    expect(calls).toHaveLength(1);
  });

  it("reports a delivered order without inventing next actions", async () => {
    const client = createMockCashClient({
      order: vi.fn(async () =>
        createOrderFixture({
          state: "delivered",
          filledAmount: 100_000_000n,
          nextActions: [],
          isInFlight: false,
          explain: () => "Delivered: the buyer paid and the USDC was released.",
        }),
      ),
    });
    const { runtime } = createRuntimeWithService({ client });

    const result = await peerCashOrderStatusAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { depositId: "base_412" } },
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("Delivered");
    expect(result?.text).not.toContain("Available next actions");
  });

  it("surfaces ORDER_NOT_FOUND as retryable indexer lag", async () => {
    const client = createMockCashClient({
      order: vi.fn(async () => {
        throw new CashError({
          code: "ORDER_NOT_FOUND",
          message: "order base_999 not found",
          retryable: true,
          remediation: "Retry through immediate indexer lag; otherwise verify the id.",
        });
      }),
    });
    const { runtime } = createRuntimeWithService({ client });

    const result = await peerCashOrderStatusAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { depositId: "base_999" } },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("ORDER_NOT_FOUND");
    expect(result?.text).toContain("indexer lag");
    expect(result?.data?.retryable).toBe(true);
  });

  it("requires a deposit id", async () => {
    const { runtime } = createRuntimeWithService();

    const result = await peerCashOrderStatusAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: {} },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("depositId is required");
  });
});
