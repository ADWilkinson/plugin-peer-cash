/**
 * Plugin shape and initialization tests: registered surfaces, package
 * metadata parity, and init failing fast on invalid configuration.
 */

import { describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { PEER_CASH_SETTING_KEYS } from "../environment.js";
import { peerCashPlugin } from "../plugin.js";
import { createMockRuntime } from "./test-utils.js";

const EXPECTED_ACTIONS = [
  "PEER_CASH_CAPABILITIES",
  "PEER_CASH_ESTIMATE",
  "PEER_CASH_CASHOUT",
  "PEER_CASH_ORDER_STATUS",
  "PEER_CASH_ORDERS",
  "PEER_CASH_WITHDRAW",
  "PEER_CASH_TOP_UP",
];

describe("peerCashPlugin", () => {
  it("registers every action, the provider, the service, and the test suite", () => {
    expect(peerCashPlugin.name).toBe("plugin-peer-cash");
    expect(packageJson.name).toBe("@davyjones0x/plugin-peer-cash");
    expect(peerCashPlugin.actions?.map((action) => action.name)).toEqual(EXPECTED_ACTIONS);
    expect(peerCashPlugin.providers?.map((provider) => provider.name)).toEqual([
      "PEER_CASH_STATUS",
    ]);
    expect(peerCashPlugin.services).toHaveLength(1);
    expect(peerCashPlugin.tests).toHaveLength(1);
  });

  it("declares every plugin setting in package.json agentConfig", () => {
    const declared = Object.keys(packageJson.agentConfig.pluginParameters);
    for (const key of PEER_CASH_SETTING_KEYS) {
      expect(declared).toContain(key);
    }
  });

  it("gates funds-moving actions and leaves reads ungated", () => {
    const gated = ["PEER_CASH_CASHOUT", "PEER_CASH_WITHDRAW", "PEER_CASH_TOP_UP"];
    for (const action of peerCashPlugin.actions ?? []) {
      if (gated.includes(action.name)) {
        expect(action.tags).toContain("capability:execute");
      } else {
        expect(action.tags ?? []).not.toContain("capability:execute");
      }
    }
  });

  it("initializes with valid configuration", async () => {
    await expect(
      peerCashPlugin.init?.(
        { PEER_CASH_ENVIRONMENT: "staging" },
        createMockRuntime({ settings: { PEER_CASH_ENVIRONMENT: "staging" } }),
      ),
    ).resolves.toBeUndefined();
    expect(process.env.PEER_CASH_ENVIRONMENT).toBe("staging");
    delete process.env.PEER_CASH_ENVIRONMENT;
  });

  it("fails initialization on an invalid environment", async () => {
    await expect(
      peerCashPlugin.init?.(
        {},
        createMockRuntime({ settings: { PEER_CASH_ENVIRONMENT: "mainnet" } }),
      ),
    ).rejects.toThrow(/PEER_CASH_ENVIRONMENT must be one of/);
  });

  it("fails initialization on a malformed referral code", async () => {
    await expect(
      peerCashPlugin.init?.(
        {},
        createMockRuntime({ settings: { PEER_CASH_REFERRAL_CODE: "nope" } }),
      ),
    ).rejects.toThrow(/PEER_CASH_REFERRAL_CODE/);
  });
});
