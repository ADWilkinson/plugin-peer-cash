/**
 * Vitest adapter running the plugin TestSuite against a real in-memory
 * AgentRuntime with the plugin registered, mirroring the CLI template's e2e
 * lane. Plugin env keys are cleared first so host state (a real key or a
 * non-default environment) cannot leak into the assertions.
 */

import { beforeAll, describe, it } from "vitest";
import { cleanupRealTestRuntime, createRealTestRuntime } from "../__tests__/test-utils.js";
import { PEER_CASH_SETTING_KEYS } from "../environment.js";
import peerCashPlugin from "../plugin.js";
import { PeerCashTestSuite } from "./suite.js";

beforeAll(() => {
  for (const key of PEER_CASH_SETTING_KEYS) {
    delete process.env[key];
  }
});

describe(PeerCashTestSuite.name, () => {
  for (const suiteTest of PeerCashTestSuite.tests) {
    it(suiteTest.name, async () => {
      const runtime = await createRealTestRuntime({
        character: { name: "Eliza" },
        plugins: [peerCashPlugin],
      });
      try {
        await suiteTest.fn(runtime);
      } finally {
        await cleanupRealTestRuntime(runtime);
      }
    });
  }
});
