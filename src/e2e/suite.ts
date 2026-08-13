/**
 * Runtime TestSuite for the Peer Cash plugin: verifies registration of the
 * service, every action, and the provider against a real runtime, and
 * exercises the offline-safe surfaces (static capabilities, catalog
 * validation, signer-absent failure). No test performs a network read or
 * moves funds; live verification stays with the SDK's own staging checklist.
 */

import type { ActionResult, IAgentRuntime, Memory, State, TestSuite, UUID } from "@elizaos/core";
import { PEER_CASH_SERVICE_TYPE } from "../service.js";

const ACTION_NAMES = [
  "PEER_CASH_CAPABILITIES",
  "PEER_CASH_ESTIMATE",
  "PEER_CASH_CASHOUT",
  "PEER_CASH_ORDER_STATUS",
  "PEER_CASH_ORDERS",
  "PEER_CASH_WITHDRAW",
  "PEER_CASH_TOP_UP",
] as const;

function testMessage(text: string): Memory {
  return {
    entityId: "12345678-1234-1234-1234-123456789012" as UUID,
    roomId: "12345678-1234-1234-1234-123456789012" as UUID,
    content: { text, source: "test" },
  };
}

const emptyState: State = { values: {}, data: {}, text: "" };

function requireAction(runtime: IAgentRuntime, name: string) {
  const action = runtime.actions.find((candidate) => candidate.name === name);
  if (!action) throw new Error(`${name} not found in runtime actions`);
  return action;
}

export const PeerCashTestSuite: TestSuite = {
  name: "plugin_peer_cash_test_suite",
  tests: [
    {
      name: "service_is_registered",
      fn: async (runtime: IAgentRuntime) => {
        const service = runtime.getService(PEER_CASH_SERVICE_TYPE);
        if (!service) throw new Error("peer-cash service not found");
      },
    },
    {
      name: "all_actions_are_registered",
      fn: async (runtime: IAgentRuntime) => {
        for (const name of ACTION_NAMES) {
          requireAction(runtime, name);
        }
      },
    },
    {
      name: "status_provider_is_registered",
      fn: async (runtime: IAgentRuntime) => {
        const provider = runtime.providers.find(
          (candidate) => candidate.name === "PEER_CASH_STATUS",
        );
        if (!provider) throw new Error("PEER_CASH_STATUS provider not found");
      },
    },
    {
      name: "capabilities_action_reports_catalog_without_network",
      fn: async (runtime: IAgentRuntime) => {
        const action = requireAction(runtime, "PEER_CASH_CAPABILITIES");
        const result = (await action.handler(
          runtime,
          testMessage("Where can I cash out to?"),
          emptyState,
          { parameters: { includeFillStats: false } },
          undefined,
          [],
        )) as ActionResult;
        if (!result?.success) {
          throw new Error(`capabilities action failed: ${String(result?.error)}`);
        }
        if (!result.text?.includes("Payout platforms")) {
          throw new Error("capabilities text missing the platform catalog");
        }
      },
    },
    {
      name: "estimate_action_rejects_unsupported_currency_offline",
      fn: async (runtime: IAgentRuntime) => {
        const action = requireAction(runtime, "PEER_CASH_ESTIMATE");
        const result = (await action.handler(
          runtime,
          testMessage("estimate"),
          emptyState,
          { parameters: { amount: 100, currency: "XXX" } },
          undefined,
          [],
        )) as ActionResult;
        if (result?.success !== false) {
          throw new Error("estimate accepted an unsupported currency");
        }
        if (!result.text?.includes("not supported")) {
          throw new Error("estimate failure text does not list supported currencies");
        }
      },
    },
    {
      name: "cashout_fails_actionably_without_a_signer",
      fn: async (runtime: IAgentRuntime) => {
        const action = requireAction(runtime, "PEER_CASH_CASHOUT");
        const result = (await action.handler(
          runtime,
          testMessage("cash out"),
          emptyState,
          {
            parameters: { amount: 100, platform: "venmo", currency: "USD", payee: "@alice" },
          },
          undefined,
          [],
        )) as ActionResult;
        if (result?.success !== false) {
          throw new Error("cashout succeeded without a signer");
        }
        if (!result.text?.includes("No signer is configured")) {
          throw new Error(`unexpected no-signer failure text: ${result.text}`);
        }
      },
    },
  ],
};
