/**
 * Plugin shape and initialization tests: registered surfaces, package
 * metadata parity, and init failing fast on invalid configuration.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { PEER_CASH_SETTING_KEYS, resolvePeerCashConfig } from "../environment.js";
import { peerCashPlugin } from "../plugin.js";
import { createMockRuntime, mockRuntimeSecretKeys, TEST_PRIVATE_KEY } from "./test-utils.js";

const savedEnv = new Map<string, string | undefined>();

// Plugin env keys are cleared per test so host state cannot leak into the
// isolation assertions below.
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
    const runtime = createMockRuntime({ settings: { PEER_CASH_ENVIRONMENT: "staging" } });
    await expect(
      peerCashPlugin.init?.({ PEER_CASH_ENVIRONMENT: "staging" }, runtime),
    ).resolves.toBeUndefined();
    expect(runtime.getSetting("PEER_CASH_ENVIRONMENT")).toBe("staging");
  });

  it("makes plugin config visible to the initialized agent", async () => {
    const runtime = createMockRuntime();
    await expect(
      peerCashPlugin.init?.({ PEER_CASH_ENVIRONMENT: "staging" }, runtime),
    ).resolves.toBeUndefined();
    expect(runtime.getSetting("PEER_CASH_ENVIRONMENT")).toBe("staging");
    expect(resolvePeerCashConfig(runtime).environment).toBe("staging");
  });

  it("never overwrites a value the agent already resolves", async () => {
    const runtime = createMockRuntime({ settings: { PEER_CASH_ENVIRONMENT: "production" } });
    await peerCashPlugin.init?.({ PEER_CASH_ENVIRONMENT: "staging" }, runtime);
    expect(runtime.getSetting("PEER_CASH_ENVIRONMENT")).toBe("production");
  });

  it("keeps plugin config out of process.env so co-hosted agents stay isolated", async () => {
    const configured = createMockRuntime();
    await peerCashPlugin.init?.(
      {
        PEER_CASH_ENVIRONMENT: "staging",
        PEER_CASH_REFERRAL_CODE: "ABC123",
        EVM_PRIVATE_KEY: TEST_PRIVATE_KEY,
      },
      configured,
    );

    for (const key of PEER_CASH_SETTING_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }

    // The signing key is the one setting that must land in the runtime's
    // secret store rather than its plain settings.
    expect([...mockRuntimeSecretKeys(configured)]).toEqual(["EVM_PRIVATE_KEY"]);

    // A second agent in the same process must not inherit the first agent's
    // environment, referral attribution, or signing key.
    const coHosted = createMockRuntime();
    const coHostedConfig = resolvePeerCashConfig(coHosted);
    expect(coHostedConfig.environment).toBe("production");
    expect(coHostedConfig.referralCode).toBeUndefined();
    expect(coHostedConfig.evmPrivateKey).toBeUndefined();
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
