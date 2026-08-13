/**
 * Order listing for a wallet. Defaults to the agent's own signer address;
 * accepts an explicit owner address for read-only inspection of another
 * wallet. `inFlight` narrows to orders still needing attention.
 */

import type {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  JsonValue,
  Memory,
  State,
} from "@elizaos/core";
import { orderToJson } from "@zkp2p/cash";
import { cashFailureResult } from "../errors.js";
import { formatOrderListText } from "../format.js";
import { getPeerCashService } from "../service.js";
import { actionParams, addressParam, booleanParam, numberParam } from "./params.js";
import { serviceUnavailableResult } from "./unavailable.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const peerCashOrdersAction: Action = {
  name: "PEER_CASH_ORDERS",
  similes: ["LIST_CASH_OUTS", "PEER_CASH_LIST_ORDERS", "MY_CASH_OUTS", "OPEN_CASH_OUTS"],
  description:
    "List Peer Cash orders for a wallet (default: the agent's own wallet): state, amounts, and " +
    "next actions per order. Read-only.",
  routingHint:
    "list/overview of cash-outs -> PEER_CASH_ORDERS; one specific order by deposit id -> " +
    "PEER_CASH_ORDER_STATUS",
  parameters: [
    {
      name: "address",
      description: "Owner wallet address to list orders for. Defaults to the agent's own wallet.",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "inFlight",
      description:
        "Only orders still needing attention (awaiting-buyer, matched, delivering). Default false.",
      required: false,
      schema: { type: "boolean", default: false },
    },
    {
      name: "limit",
      description: "Maximum orders to return (default 20, max 100)",
      required: false,
      schema: { type: "number", minimum: 1, maximum: 100 },
    },
  ],

  validate: async (runtime: IAgentRuntime, _message: Memory): Promise<boolean> => {
    return getPeerCashService(runtime) !== null;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    options: HandlerOptions | Record<string, JsonValue | undefined> | undefined,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const service = getPeerCashService(runtime);
    if (!service) {
      return serviceUnavailableResult("PEER_CASH_ORDERS", message, callback);
    }

    try {
      const raw = actionParams(message, options);
      const explicitOwner = addressParam(raw, "address");
      const owner = explicitOwner ?? service.getSignerAddressOrNull();
      if (!owner) {
        throw new Error(
          "No wallet to list orders for. Provide an address, register an EVM wallet backend, " +
            "or set EVM_PRIVATE_KEY.",
        );
      }
      const inFlight = booleanParam(raw, "inFlight") ?? false;
      const requestedLimit = numberParam(raw, "limit") ?? DEFAULT_LIMIT;
      const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), MAX_LIMIT);

      const orders = await service.getClient().orders(owner, { inFlight, limit });
      const text = formatOrderListText(orders, owner);

      if (callback) {
        await callback({
          text,
          actions: ["PEER_CASH_ORDERS"],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text,
        userFacingText: text,
        verifiedUserFacing: true,
        values: {
          peerCashOrderCount: orders.length,
          peerCashOwner: owner,
        },
        data: { orders: orders.map((order) => orderToJson(order)) },
      };
    } catch (error) {
      const failure = cashFailureResult(error, "Order listing");
      if (callback) {
        await callback({
          text: failure.text ?? "Order listing failed.",
          actions: ["PEER_CASH_ORDERS"],
          source: message.content.source,
        });
      }
      return failure;
    }
  },

  examples: [
    [
      {
        name: "{{userName}}",
        content: { text: "Show my open cash-outs" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Peer Cash orders for 0xabc (2): base_412 awaiting-buyer, base_398 delivered.",
          actions: ["PEER_CASH_ORDERS"],
        },
      },
    ],
  ],
};
