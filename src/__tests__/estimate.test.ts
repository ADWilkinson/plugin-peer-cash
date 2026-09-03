/**
 * Estimate action tests: oracle-estimate wording on the happy path, catalog
 * rejection for unsupported currencies, typed CashError mapping, and
 * parameter validation failures. The cash client is mocked; no network.
 */

import { CashError, usdc } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
import { peerCashEstimateAction } from "../actions/estimate.js";
import {
  capabilitiesFixture,
  createCallbackSpy,
  createMockCashClient,
  createMockRuntime,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
  estimateFixture,
} from "./test-utils.js";

const message = () => createTestMessage("How much EUR for 1000 USDC?");

describe("PEER_CASH_ESTIMATE", () => {
  it("returns the oracle estimate and never calls it a locked quote", async () => {
    const { runtime, client } = createRuntimeWithService();
    const { callback, calls } = createCallbackSpy();

    const result = await peerCashEstimateAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { amount: 1000, currency: "eur" } },
      callback,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("not a locked quote");
    expect(result?.text).toContain("920.50 EUR");
    expect(client.estimate).toHaveBeenCalledWith({ amount: usdc(1000), currency: "EUR" });
    expect(calls).toHaveLength(1);
    expect(result?.data?.estimate).toBeDefined();
  });

  it("rejects currencies missing from the catalog with the supported list", async () => {
    const { runtime, client } = createRuntimeWithService();

    const result = await peerCashEstimateAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { amount: 100, currency: "JPY" } },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain('currency "JPY" is not supported');
    expect(result?.text).toContain("EUR, GBP, USD");
    expect(client.estimate).not.toHaveBeenCalled();
  });

  it("maps CashError codes to remediation text", async () => {
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

    const result = await peerCashEstimateAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { amount: 100, currency: "USD" } },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("ORACLE_READ_FAILED");
    expect(result?.text).toContain("Retry the read through a healthy Base RPC.");
    expect(result?.text).toContain("retryable");
    expect(result?.data?.error).toBe("ORACLE_READ_FAILED");
    expect(result?.data?.retryable).toBe(true);
  });

  it("does not tell the user a creation-bound estimate resolves at fill", async () => {
    const client = createMockCashClient({
      capabilities: vi.fn(() => ({
        ...capabilitiesFixture,
        currencies: [...capabilitiesFixture.currencies, "CNY"],
      })),
      estimate: vi.fn(async () => ({
        ...estimateFixture,
        currency: "CNY",
        binding: "deposit-creation" as const,
        receiveAmount: 7200,
        rate: 7.2,
      })),
    });
    const { runtime } = createRuntimeWithService({ client });

    const result = await peerCashEstimateAction.handler(
      runtime,
      createTestMessage("How much CNY for 1000 USDC?"),
      emptyState,
      { parameters: { amount: 1000, currency: "CNY" } },
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain("binds when the deposit is created");
    expect(result?.text).toContain("not a locked quote");
    expect(result?.text).not.toContain("when a buyer fills");
  });

  it("fails clearly when the amount is missing or invalid", async () => {
    const { runtime } = createRuntimeWithService();

    const missing = await peerCashEstimateAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { currency: "USD" } },
      undefined,
    );
    expect(missing?.success).toBe(false);
    expect(missing?.text).toContain("amount is required");

    const negative = await peerCashEstimateAction.handler(
      runtime,
      message(),
      emptyState,
      { parameters: { amount: -5, currency: "USD" } },
      undefined,
    );
    expect(negative?.success).toBe(false);
    expect(negative?.text).toContain("amount");
  });

  it("fails explicitly when the service is not registered", async () => {
    const result = await peerCashEstimateAction.handler(
      createMockRuntime(),
      message(),
      emptyState,
      { parameters: { amount: 100, currency: "USD" } },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("Peer Cash is unavailable");
  });

  it("validates only when the service is registered", async () => {
    const { runtime } = createRuntimeWithService();
    await expect(peerCashEstimateAction.validate(runtime, message())).resolves.toBe(true);
    await expect(peerCashEstimateAction.validate(createMockRuntime(), message())).resolves.toBe(
      false,
    );
  });
});
