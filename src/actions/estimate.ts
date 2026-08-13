/**
 * Read-only cash-out estimate: live Chainlink oracle rate, receive amount,
 * and the historical time-to-first-fill for the requested currency. The
 * wording and result data always mark the number as an oracle estimate -
 * Peer Cash has no locked quotes; the binding rate resolves when a buyer
 * fills.
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
import { estimateToJson, formatUsdc } from "@zkp2p/cash";
import { cashFailureResult } from "../errors.js";
import { formatEstimateText } from "../format.js";
import { getPeerCashService } from "../service.js";
import { resolveCurrency } from "./catalog.js";
import { actionParams, requireStringParam, requireUsdcAmountParam } from "./params.js";
import { serviceUnavailableResult } from "./unavailable.js";

export const peerCashEstimateAction: Action = {
  name: "PEER_CASH_ESTIMATE",
  similes: ["CASH_OUT_ESTIMATE", "OFFRAMP_ESTIMATE", "USDC_TO_FIAT_ESTIMATE", "PEER_CASH_RATE"],
  description:
    "Estimate a Peer Cash crypto-to-fiat cash-out: how much fiat a given Base USDC amount would " +
    "receive at the live Chainlink oracle market rate (0% spread), plus the typical time to " +
    "first fill. Read-only; never a locked quote.",
  routingHint:
    'cash-out rate/"how much would I get" questions -> PEER_CASH_ESTIMATE; actually sending ' +
    "funds -> PEER_CASH_CASHOUT (NOT this action)",
  parameters: [
    {
      name: "amount",
      description: "USDC amount to estimate, in whole USDC units (for example 100 or 49.5)",
      required: true,
      schema: { type: "number", minimum: 0.01 },
      examples: [100, 1000],
    },
    {
      name: "currency",
      description: "Fiat currency code to receive, for example USD, EUR, or GBP",
      required: true,
      schema: { type: "string", minLength: 3, maxLength: 3 },
      examples: ["USD", "EUR"],
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
      return serviceUnavailableResult("PEER_CASH_ESTIMATE", message, callback);
    }

    try {
      const raw = actionParams(message, options);
      const amount = requireUsdcAmountParam(raw, "amount");
      const client = service.getClient();
      const currency = resolveCurrency(client.capabilities(), requireStringParam(raw, "currency"));

      const estimate = await client.estimate({ amount, currency });
      const text = formatEstimateText(estimate);

      if (callback) {
        await callback({
          text,
          actions: ["PEER_CASH_ESTIMATE"],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text,
        userFacingText: text,
        verifiedUserFacing: true,
        values: {
          peerCashEstimateRate: estimate.rate,
          peerCashEstimateReceiveAmount: estimate.receiveAmount,
          peerCashEstimateCurrency: estimate.currency,
        },
        data: {
          estimate: estimateToJson(estimate),
          amountUsdc: formatUsdc(amount),
        },
      };
    } catch (error) {
      const failure = cashFailureResult(error, "Estimate");
      if (callback) {
        await callback({
          text: failure.text ?? "Estimate failed.",
          actions: ["PEER_CASH_ESTIMATE"],
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
        content: { text: "How much EUR would I get for 1000 USDC?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Estimated cash-out: about 920.50 EUR for 1000 USDC at roughly 0.9205 EUR/USDC. This is a live Chainlink oracle estimate with 0% spread, not a locked quote.",
          actions: ["PEER_CASH_ESTIMATE"],
        },
      },
    ],
    [
      {
        name: "{{userName}}",
        content: { text: "What's the current cash-out rate for 250 USDC to USD?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Estimated cash-out: about 250.00 USD for 250 USDC at roughly 1.0000 USD/USDC. The final rate resolves at the oracle when a buyer fills.",
          actions: ["PEER_CASH_ESTIMATE"],
        },
      },
    ],
  ],
};
