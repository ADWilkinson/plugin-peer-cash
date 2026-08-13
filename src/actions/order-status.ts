/**
 * Order status by deposit id: reconstructs the order from the chain, reports
 * the SDK's own `explain()` sentence, the amounts, and the `nextActions` the
 * caller can take. `ORDER_NOT_FOUND` seconds after a cash-out is indexer lag,
 * not a lost deposit - the SDK marks it retryable and the failure text says
 * so.
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
import { formatOrderText } from "../format.js";
import { getPeerCashService } from "../service.js";
import { actionParams, requireDepositIdParam } from "./params.js";
import { serviceUnavailableResult } from "./unavailable.js";

export const peerCashOrderStatusAction: Action = {
  name: "PEER_CASH_ORDER_STATUS",
  similes: ["CASH_OUT_STATUS", "PEER_CASH_ORDER", "CHECK_CASH_OUT", "ORDER_PROGRESS"],
  description:
    "Check one Peer Cash order by its deposit id: current state (awaiting-buyer, matched, " +
    "delivering, delivered, returned), filled and pending amounts, and what can be done next. " +
    "Read-only; resumable from the id alone.",
  routingHint:
    "status of a specific cash-out (deposit id known) -> PEER_CASH_ORDER_STATUS; all orders " +
    "for the wallet -> PEER_CASH_ORDERS",
  parameters: [
    {
      name: "depositId",
      description: "The deposit id returned by the cash-out, for example base_412",
      required: true,
      schema: { type: "string", minLength: 1 },
      examples: ["base_412"],
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
      return serviceUnavailableResult("PEER_CASH_ORDER_STATUS", message, callback);
    }

    try {
      const raw = actionParams(message, options);
      const depositId = requireDepositIdParam(raw);

      const order = await service.getClient().order(depositId);
      const text = formatOrderText(order);

      if (callback) {
        await callback({
          text,
          actions: ["PEER_CASH_ORDER_STATUS"],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text,
        userFacingText: text,
        verifiedUserFacing: true,
        values: {
          peerCashOrderState: order.state,
          peerCashDepositId: order.depositId,
        },
        data: { order: orderToJson(order) },
      };
    } catch (error) {
      const failure = cashFailureResult(error, "Order lookup");
      if (callback) {
        await callback({
          text: failure.text ?? "Order lookup failed.",
          actions: ["PEER_CASH_ORDER_STATUS"],
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
        content: { text: "What's the status of my cash-out base_412?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Order base_412: state awaiting-buyer; total 100 USDC, filled 0, pending 0, returned 0. Available next actions: wait, withdraw.",
          actions: ["PEER_CASH_ORDER_STATUS"],
        },
      },
    ],
  ],
};
