/**
 * Order listing action tests: signer-address default, explicit owner
 * override, the no-wallet failure, and empty results.
 */

import { describe, expect, it, vi } from "vitest";
import { peerCashOrdersAction } from "../actions/list-orders.js";
import {
  createMockCashClient,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
  TEST_ADDRESS,
} from "./test-utils.js";

const OTHER_ADDRESS = "0x00000000000000000000000000000000000000aa";
const message = () => createTestMessage("Show my cash-outs");

describe("PEER_CASH_ORDERS", () => {
  it("defaults to the agent's own wallet", async () => {
    const { runtime, client } = createRuntimeWithService();

    const result = await peerCashOrdersAction.handler(
      runtime,
      message(),
      emptyState,
      {},
      undefined,
    );

    expect(client.orders).toHaveBeenCalledWith(TEST_ADDRESS, { inFlight: false, limit: 20 });
    expect(result?.success).toBe(true);
    expect(result?.text).toContain("base_412");
    expect(result?.values?.peerCashOrderCount).toBe(1);
  });

  it("accepts an explicit owner address and clamps the limit", async () => {
    const { runtime, client } = createRuntimeWithService();

    const result = await peerCashOrdersAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { address: OTHER_ADDRESS, inFlight: true, limit: 500 } },
      undefined,
    );

    expect(client.orders).toHaveBeenCalledWith(OTHER_ADDRESS, { inFlight: true, limit: 100 });
    expect(result?.success).toBe(true);
  });

  it("fails actionably when no wallet is available", async () => {
    const { runtime, client } = createRuntimeWithService({ signer: null });

    const result = await peerCashOrdersAction.handler(
      runtime,
      message(),
      emptyState,
      {},
      undefined,
    );

    expect(client.orders).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
    expect(result?.text).toContain("No wallet to list orders for");
  });

  it("reports an empty order list honestly", async () => {
    const client = createMockCashClient({ orders: vi.fn(async () => []) });
    const { runtime } = createRuntimeWithService({ client });

    const result = await peerCashOrdersAction.handler(
      runtime,
      message(),
      emptyState,
      {},
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("No Peer Cash orders found");
  });

  it("rejects malformed owner addresses", async () => {
    const { runtime, client } = createRuntimeWithService();

    const result = await peerCashOrdersAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { address: "not-an-address" } },
      undefined,
    );

    expect(client.orders).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
    expect(result?.text).toContain("0x-prefixed EVM address");
  });
});
