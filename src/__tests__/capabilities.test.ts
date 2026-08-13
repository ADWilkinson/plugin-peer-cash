/**
 * Capabilities action tests: catalog rendering with fill evidence, the
 * fail-open path when fill stats are unavailable, and the stats opt-out.
 */

import { CashError } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
import { peerCashCapabilitiesAction } from "../actions/capabilities.js";
import {
  createCallbackSpy,
  createMockCashClient,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
} from "./test-utils.js";

const message = () => createTestMessage("Where can I cash out to?");

describe("PEER_CASH_CAPABILITIES", () => {
  it("reports platforms, currencies, payee hints, and fill evidence", async () => {
    const { runtime, client } = createRuntimeWithService();
    const { callback, calls } = createCallbackSpy();

    const result = await peerCashCapabilitiesAction.handler(
      runtime,
      message(),
      emptyState,
      {},
      callback,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("venmo: USD");
    expect(result?.text).toContain("revolut: EUR, GBP, USD");
    expect(result?.text).toContain("identity attestation");
    expect(result?.text).toContain("42 fills in the last 30 days");
    expect(client.fillStats).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1);
  });

  it("fails open to the full catalog when fill stats are unavailable", async () => {
    const client = createMockCashClient({
      fillStats: vi.fn(async () => {
        throw new CashError({
          code: "INDEXER_UNAVAILABLE",
          message: "indexer transport failed",
          retryable: true,
          remediation: "Retry only the failed read.",
        });
      }),
    });
    const { runtime } = createRuntimeWithService({ client });

    const result = await peerCashCapabilitiesAction.handler(
      runtime,
      message(),
      emptyState,
      {},
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("venmo: USD");
    expect(result?.text).toContain("Fill statistics are temporarily unavailable");
    expect(result?.data?.fillStatsUnavailable).toBeDefined();
    expect(result?.data?.fillStats).toBeUndefined();
  });

  it("skips the stats read when includeFillStats is false", async () => {
    const { runtime, client } = createRuntimeWithService();

    const result = await peerCashCapabilitiesAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { includeFillStats: false } },
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(client.fillStats).not.toHaveBeenCalled();
  });
});
