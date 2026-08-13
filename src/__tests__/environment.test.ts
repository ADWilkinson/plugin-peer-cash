/**
 * Configuration boundary tests: canonical environments and aliases, referral
 * code normalization, URL and key shape validation, and aggregated failure
 * messages. Uses the mocked runtime settings map; process env keys are
 * cleared per test so host state cannot leak in.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PEER_CASH_SETTING_KEYS, resolvePeerCashConfig } from "../environment.js";
import { createMockRuntime } from "./test-utils.js";

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of PEER_CASH_SETTING_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of PEER_CASH_SETTING_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolvePeerCashConfig", () => {
  it("defaults to production with everything else unset", () => {
    const config = resolvePeerCashConfig(createMockRuntime());
    expect(config).toEqual({
      environment: "production",
      referralCode: undefined,
      referrer: undefined,
      rpcUrl: undefined,
      evmPrivateKey: undefined,
    });
  });

  it("accepts canonical environments and the preprod/prod aliases", () => {
    for (const [input, expected] of [
      ["production", "production"],
      ["prod", "production"],
      ["preproduction", "preproduction"],
      ["preprod", "preproduction"],
      ["staging", "staging"],
      ["Staging", "staging"],
    ] as const) {
      const config = resolvePeerCashConfig(
        createMockRuntime({ settings: { PEER_CASH_ENVIRONMENT: input } }),
      );
      expect(config.environment).toBe(expected);
    }
  });

  it("rejects unknown environments with the supported list", () => {
    expect(() =>
      resolvePeerCashConfig(createMockRuntime({ settings: { PEER_CASH_ENVIRONMENT: "mainnet" } })),
    ).toThrow(/PEER_CASH_ENVIRONMENT must be one of production, preproduction, staging/);
  });

  it("normalizes referral codes to uppercase", () => {
    const config = resolvePeerCashConfig(
      createMockRuntime({ settings: { PEER_CASH_REFERRAL_CODE: "abc123" } }),
    );
    expect(config.referralCode).toBe("ABC123");
  });

  it("rejects malformed referral codes", () => {
    expect(() =>
      resolvePeerCashConfig(
        createMockRuntime({ settings: { PEER_CASH_REFERRAL_CODE: "not-a-code" } }),
      ),
    ).toThrow(/PEER_CASH_REFERRAL_CODE must be the six character alphanumeric code/);
  });

  it("rejects malformed RPC URLs and private keys in one aggregated error", () => {
    expect(() =>
      resolvePeerCashConfig(
        createMockRuntime({
          settings: {
            PEER_CASH_RPC_URL: "not a url",
            EVM_PRIVATE_KEY: "0x1234",
          },
        }),
      ),
    ).toThrow(/PEER_CASH_RPC_URL must be a valid URL.*EVM_PRIVATE_KEY must be a 0x-prefixed/s);
  });

  it("falls back to process.env when the runtime setting is absent", () => {
    process.env.PEER_CASH_ENVIRONMENT = "staging";
    const config = resolvePeerCashConfig(createMockRuntime());
    expect(config.environment).toBe("staging");
  });

  it("prefers the runtime setting over process.env", () => {
    process.env.PEER_CASH_ENVIRONMENT = "staging";
    const config = resolvePeerCashConfig(
      createMockRuntime({ settings: { PEER_CASH_ENVIRONMENT: "preprod" } }),
    );
    expect(config.environment).toBe("preproduction");
  });
});
