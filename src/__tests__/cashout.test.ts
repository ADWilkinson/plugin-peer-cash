/**
 * Cash-out action tests: the two-phase confirmation gate (pending, confirmed,
 * cancelled), submission with the resolved signer, typed error mapping, and
 * the signer-absent failure. The confirmation cache lives in the mocked
 * runtime; the same runtime instance must serve both turns.
 */

import { CashError, usdc } from "@zkp2p/cash";
import { describe, expect, it, vi } from "vitest";
import { peerCashCashoutAction } from "../actions/cashout.js";
import {
  cashoutResultFixture,
  createCallbackSpy,
  createMockCashClient,
  createRuntimeWithService,
  createTestMessage,
  emptyState,
} from "./test-utils.js";

const params = { amount: 100, platform: "venmo", currency: "USD", payee: "@alice" };

describe("PEER_CASH_CASHOUT", () => {
  it("asks for confirmation first and does not submit", async () => {
    const { runtime, client } = createRuntimeWithService();
    const { callback, calls } = createCallbackSpy();

    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      callback,
    );

    expect(client.cashout).not.toHaveBeenCalled();
    expect(result?.data?.requiresConfirmation).toBe(true);
    expect(result?.data?.confirmationStatus).toBe("pending");
    expect(calls[0]?.text).toContain("Reply yes to submit or no to cancel");
    expect(calls[0]?.text).toContain("100 USDC");
    expect(calls[0]?.text).toContain("@alice");
    expect(calls[0]?.text).toContain("Current oracle estimate");
  });

  it("submits after a yes reply and reports the deposit id", async () => {
    const { runtime, client } = createRuntimeWithService();

    await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      undefined,
    );
    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: params },
      undefined,
    );

    expect(client.cashout).toHaveBeenCalledOnce();
    const [input, options] = client.cashout.mock.calls[0];
    expect(input).toEqual({
      amount: usdc(100),
      receive: { platform: "venmo", currency: "USD", payee: "@alice" },
    });
    expect(options.signer).toBeDefined();
    expect(result?.success).toBe(true);
    expect(result?.text).toContain("base_412");
    expect(result?.text).toContain("save this");
    expect(result?.data?.cashout).toBeDefined();
  });

  it("cancels on a no reply without submitting", async () => {
    const { runtime, client } = createRuntimeWithService();

    await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      undefined,
    );
    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("no, cancel that"),
      emptyState,
      { parameters: params },
      undefined,
    );

    expect(client.cashout).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
    expect(result?.text).toContain("cancelled");
  });

  it("does not let a confirmation authorize different parameters", async () => {
    const { runtime, client } = createRuntimeWithService();

    await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      undefined,
    );
    // Same user says yes, but the extracted parameters changed - the pending
    // key differs, so this becomes a fresh confirmation ask, not a submit.
    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: { ...params, amount: 5000 } },
      undefined,
    );

    expect(client.cashout).not.toHaveBeenCalled();
    expect(result?.data?.confirmationStatus).toBe("pending");
  });

  it("maps a CashError from submission to remediation text", async () => {
    const client = createMockCashClient({
      cashout: vi.fn(async () => {
        throw new CashError({
          code: "INSUFFICIENT_TOKEN_BALANCE",
          message: "wallet holds 12 USDC",
          retryable: false,
          remediation: "Fund the required token amount, then retry.",
        });
      }),
    });
    const { runtime } = createRuntimeWithService({ client });

    await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      undefined,
    );
    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: params },
      undefined,
    );

    expect(result?.success).toBe(false);
    expect(result?.text).toContain("INSUFFICIENT_TOKEN_BALANCE");
    expect(result?.text).toContain("Fund the required token amount");
    expect(result?.error).toBe("wallet holds 12 USDC");
  });

  it("fails before the confirmation ask when no signer is configured", async () => {
    const { runtime, client } = createRuntimeWithService({ signer: null });
    const { callback, calls } = createCallbackSpy();

    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      callback,
    );

    expect(client.cashout).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
    expect(result?.text).toContain("No signer is configured");
    expect(calls[0]?.text).toContain("No signer is configured");
  });

  it("rejects platforms missing from the catalog before asking anything", async () => {
    const { runtime, client } = createRuntimeWithService();

    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out"),
      emptyState,
      { parameters: { ...params, platform: "paypal-invalid" } },
      undefined,
    );

    expect(client.cashout).not.toHaveBeenCalled();
    expect(result?.success).toBe(false);
    expect(result?.text).toContain('platform "paypal-invalid" is not supported');
  });

  it("reports every confirmed access-policy hash", async () => {
    const hashes = [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ] as const;
    const client = createMockCashClient({
      cashout: vi.fn(async () => ({
        ...cashoutResultFixture,
        accessPolicyTxHashes: [...hashes],
      })),
    });
    const { runtime } = createRuntimeWithService({ client });

    await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      undefined,
    );
    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: params },
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain(`Access policies confirmed: ${hashes[0]}, ${hashes[1]}.`);
  });

  it("reports a single access-policy hash from the compatibility field", async () => {
    const hash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const client = createMockCashClient({
      cashout: vi.fn(async () => ({
        ...cashoutResultFixture,
        accessPolicyTxHash: hash,
      })),
    });
    const { runtime } = createRuntimeWithService({ client });

    await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("Cash out 100 USDC to @alice on venmo"),
      emptyState,
      { parameters: params },
      undefined,
    );
    const result = await peerCashCashoutAction.handler(
      runtime,
      createTestMessage("yes"),
      emptyState,
      { parameters: params },
      undefined,
    );

    expect(result?.success).toBe(true);
    expect(result?.text).toContain(`Access policy confirmed: ${hash}.`);
  });
});
