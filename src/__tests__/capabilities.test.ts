/**
 * Capabilities action tests: catalog rendering with fill evidence, per-platform
 * fill counting across the SDK's pair and multi-currency-set keys, the
 * fail-open path when fill stats are unavailable, and the stats opt-out.
 */

import { CashError, createCashClient } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
import { peerCashCapabilitiesAction } from "../actions/capabilities.js";
import {
  capabilitiesFixture,
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

  it("counts a multi-currency corridor's fills once, not once per stats key", async () => {
    // The SDK records one fill under both its `platform:CURRENCY` pair and the
    // deposit's aggregate `platform:EUR+GBP+USD` set key.
    const client = createMockCashClient({
      fillStats: vi.fn(async () => ({
        "revolut:EUR": { fills: 3 },
        "revolut:GBP": { fills: 2 },
        "revolut:EUR+GBP+USD": { fills: 5 },
      })),
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
    expect(result?.text).toContain("[5 fills in the last 30 days]");
    expect(result?.text).not.toContain("[10 fills in the last 30 days]");
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

  it("names corridors that bind when the deposit is created", async () => {
    const client = createMockCashClient({
      capabilities: vi.fn(() => ({
        ...capabilitiesFixture,
        currencies: [...capabilitiesFixture.currencies, "CNY"],
        platforms: [
          ...capabilitiesFixture.platforms,
          {
            platform: "alipay",
            currencies: ["CNY"],
            pricing: {
              CNY: {
                kind: "fixed-at-deposit-creation",
                source: "chainlink-ethereum",
                spreadBps: 0,
              },
            },
            payeeHint: "Email address linked to your Alipay account",
            requiresIdentityAttestation: true,
            requiresAtomicAccessPolicy: false,
          },
        ],
      })),
    });
    const { runtime } = createRuntimeWithService({ client });

    const result = await peerCashCapabilitiesAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { includeFillStats: false } },
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("bind when the deposit is created");
    expect(result?.text).toContain("CNY binds when the deposit is created");
    expect(result?.text).not.toContain("live oracle market rate with 0% spread");
  });
});

describe("installed @zkp2p/cash catalog", () => {
  it("exposes Alipay/CNY as a creation-bound corridor and leaves Cash App public", () => {
    const caps = createCashClient({ environment: "production" }).capabilities();
    const methods = ["capabilities", "estimate", "cashout", "order", "orders", "withdraw", "topUp"];
    const client = createCashClient({ environment: "production" });
    for (const method of methods) {
      expect(typeof client[method as keyof typeof client]).toBe("function");
    }

    expect(
      caps.platforms.find((platform) => platform.platform === "alipay")?.pricing.CNY?.kind,
    ).toBe("fixed-at-deposit-creation");
    expect(
      caps.platforms.find((platform) => platform.platform === "venmo")?.pricing.USD?.kind,
    ).toBe("oracle-at-intent-signal");
    expect(caps.platforms.some((platform) => platform.platform === "cashapp")).toBe(true);
  });
});
