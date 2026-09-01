/**
 * Top-up: add USDC to a live Peer Cash order - same payee, same live market
 * rate. Confirmation-gated like every funds-moving verb. Fails with
 * `ORDER_NOT_ACTIVE` when the order is terminal; the remediation tells the
 * agent to start a new cash-out instead.
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
import { formatUsdc, topUpResultToJson } from "@zkp2p/cash";
import { cashFailureResult, submitConfirmed } from "../errors.js";
import { gatePeerCashExecution, peerCashGateActionResult } from "../security/confirmation.js";
import { getPeerCashService } from "../service.js";
import { actionParams, requireDepositIdParam, requireUsdcAmountParam } from "./params.js";
import { serviceUnavailableResult } from "./unavailable.js";

export const peerCashTopUpAction: Action = {
  name: "PEER_CASH_TOP_UP",
  similes: ["TOP_UP_CASH_OUT", "PEER_CASH_ADD_FUNDS", "ADD_TO_CASH_OUT", "INCREASE_CASH_OUT"],
  description:
    "Add more USDC to a live Peer Cash order: same payee, same live oracle market rate. " +
    "Requires a user confirmation turn before submitting.",
  routingHint:
    "add funds to an existing live cash-out -> PEER_CASH_TOP_UP; new cash-out to a new " +
    "payee -> PEER_CASH_CASHOUT",
  tags: ["capability:execute"],
  parameters: [
    {
      name: "depositId",
      description: "The deposit id of the live order to top up, for example base_412",
      required: true,
      schema: { type: "string", minLength: 1 },
      examples: ["base_412"],
    },
    {
      name: "amount",
      description: "USDC amount to add, in whole USDC units (for example 50)",
      required: true,
      schema: { type: "number", minimum: 0.01 },
      examples: [50, 200],
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
      return serviceUnavailableResult("PEER_CASH_TOP_UP", message, callback);
    }

    try {
      const raw = actionParams(message, options);
      const depositId = requireDepositIdParam(raw);
      const amount = requireUsdcAmountParam(raw, "amount");

      const signer = service.getSigner();

      const gate = await gatePeerCashExecution({
        runtime,
        message,
        params: {
          operation: "top-up",
          environment: service.getConfig().environment,
          depositId,
          amountBaseUnits: amount,
        },
        callback,
      });
      if (!gate.proceed) {
        return peerCashGateActionResult(gate);
      }

      // The confirmation is spent; a failure past this point ends the turn.
      const result = await submitConfirmed(() =>
        service.getClient().topUp(depositId, amount, { signer: signer.walletClient }),
      );

      const text =
        `Added ${formatUsdc(amount)} USDC to order ${result.depositId}. ` +
        `Transaction: ${result.txHash}.`;

      if (callback) {
        await callback({
          text,
          actions: ["PEER_CASH_TOP_UP"],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text,
        userFacingText: text,
        verifiedUserFacing: true,
        // Same halt the cash-out receipt takes: the order id and transaction
        // hash reach the user verbatim only while this is the turn's last
        // word.
        continueChain: false,
        values: {
          peerCashActionSucceeded: true,
          peerCashDepositId: result.depositId,
        },
        data: { topUp: topUpResultToJson(result) },
      };
    } catch (error) {
      const failure = cashFailureResult(error, "Top-up");
      if (callback) {
        await callback({
          text: failure.text ?? "Top-up failed.",
          actions: ["PEER_CASH_TOP_UP"],
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
        content: { text: "Add 50 USDC to my cash-out base_412" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Add 50 USDC to Peer Cash order base_412 (same payee, same live market rate)? Reply yes to submit or no to cancel.",
          actions: ["PEER_CASH_TOP_UP"],
        },
      },
      {
        name: "{{userName}}",
        content: { text: "yes" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Added 50 USDC to order base_412.",
          actions: ["PEER_CASH_TOP_UP"],
        },
      },
    ],
  ],
};
