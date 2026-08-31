/**
 * Funds-moving cash-out: deposits the agent's Base USDC into a Peer Cash
 * order that a buyer fills with fiat to the given payee. Always passes the
 * two-phase confirmation gate first - the preview shows amount, platform,
 * currency, payee, and the current oracle estimate, and only a yes reply on a
 * later turn submits. The returned `depositId` is the resume key; hosts
 * should persist it. Venmo, Cash App, and PayPal orders confirm an
 * access-policy transaction after the deposit; its hash is reported when
 * present.
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
import { logger } from "@elizaos/core";
import { type CashClient, type CurrencyType, cashoutResultToJson, formatUsdc } from "@zkp2p/cash";
import { cashFailureResult } from "../errors.js";
import { formatOrderText } from "../format.js";
import { gatePeerCashExecution, peerCashGateActionResult } from "../security/confirmation.js";
import { getPeerCashService } from "../service.js";
import { resolveCurrency, resolvePlatform } from "./catalog.js";
import { actionParams, requireStringParam, requireUsdcAmountParam } from "./params.js";
import { serviceUnavailableResult } from "./unavailable.js";

/**
 * Informational oracle-estimate line for the confirmation preview. A failed
 * read degrades to no suffix - the preview already carries the full economic
 * terms, and the binding rate resolves at fill time regardless.
 */
async function estimatePreviewSuffix(
  client: CashClient,
  amount: bigint,
  currency: CurrencyType,
): Promise<string | undefined> {
  // error-policy:J4 user-facing degrade - the estimate is advisory context for
  // the confirmation prompt, never a binding term of the confirmed operation.
  try {
    const estimate = await client.estimate({ amount, currency }, { includeEta: false });
    return `Current oracle estimate: about ${estimate.receiveAmount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${estimate.currency} (not a locked rate).`;
  } catch (error) {
    logger.debug(
      `[plugin-peer-cash] estimate unavailable for cash-out preview: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

export const peerCashCashoutAction: Action = {
  name: "PEER_CASH_CASHOUT",
  similes: ["CASH_OUT", "CASH_OUT_USDC", "OFFRAMP_USDC", "USDC_TO_FIAT", "SELL_USDC_FOR_FIAT"],
  description:
    "Cash out the agent's Base USDC to a fiat payment app (Venmo, Revolut, Wise, Zelle, and " +
    "more) through the Peer P2P protocol. Creates an on-chain order priced at the live oracle " +
    "market rate with 0% spread; a buyer pays the fiat and proves it before the USDC is " +
    "released. Requires a user confirmation turn before submitting.",
  routingHint:
    "explicit crypto-to-fiat cash-out of USDC to a payment app -> PEER_CASH_CASHOUT; " +
    "rate-only questions -> PEER_CASH_ESTIMATE; token swaps/transfers -> wallet actions " +
    "(NOT this action)",
  tags: ["capability:execute"],
  parameters: [
    {
      name: "amount",
      description: "USDC amount to cash out, in whole USDC units (for example 100 or 49.5)",
      required: true,
      schema: { type: "number", minimum: 0.01 },
      examples: [100, 500],
    },
    {
      name: "platform",
      description: "Payout platform id from PEER_CASH_CAPABILITIES, for example venmo or revolut",
      required: true,
      schema: { type: "string" },
      examples: ["venmo", "revolut"],
    },
    {
      name: "currency",
      description: "Fiat currency the payee receives, for example USD or EUR",
      required: true,
      schema: { type: "string", minLength: 3, maxLength: 3 },
      examples: ["USD", "EUR"],
    },
    {
      name: "payee",
      description:
        "The payee handle on the platform (for example a Venmo username or Revolut revtag). " +
        "Must match the platform's payee format.",
      required: true,
      schema: { type: "string", minLength: 1 },
      examples: ["@alice", "revtag123"],
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
      return serviceUnavailableResult("PEER_CASH_CASHOUT", message, callback);
    }

    try {
      const raw = actionParams(message, options);
      const amount = requireUsdcAmountParam(raw, "amount");
      const client = service.getClient();
      const capabilities = client.capabilities();
      const platform = resolvePlatform(capabilities, requireStringParam(raw, "platform"));
      const currency = resolveCurrency(capabilities, requireStringParam(raw, "currency"), platform);
      const payee = requireStringParam(raw, "payee");

      // Signer resolution happens before the confirmation ask so a
      // misconfigured wallet fails immediately instead of after a "yes".
      const signer = service.getSigner();

      const gate = await gatePeerCashExecution({
        runtime,
        message,
        params: {
          operation: "cashout",
          environment: service.getConfig().environment,
          amountBaseUnits: amount,
          platform: platform.platform,
          currency,
          payee,
        },
        callback,
        extraPreview: await estimatePreviewSuffix(client, amount, currency),
      });
      if (!gate.proceed) {
        return peerCashGateActionResult(gate);
      }

      const result = await client.cashout(
        {
          amount,
          receive: { platform: platform.platform, currency, payee },
        },
        { signer: signer.walletClient },
      );

      const lines = [
        `Cash-out submitted: ${formatUsdc(amount)} USDC to ${payee} on ${platform.platform} ` +
          `in ${currency}.`,
        `Deposit id (save this to track or manage the order): ${result.depositId}.`,
        `Transaction: ${result.txHash}.`,
      ];
      if (result.accessPolicyTxHash) {
        lines.push(`Access policy confirmed: ${result.accessPolicyTxHash}.`);
      }
      lines.push(formatOrderText(result.order));
      const text = lines.join(" ");

      if (callback) {
        await callback({
          text,
          actions: ["PEER_CASH_CASHOUT"],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text,
        userFacingText: text,
        verifiedUserFacing: true,
        // The USDC is in escrow now, and this text carries the only keys that
        // reach it again: the deposit id, the deposit transaction, and any
        // access-policy hash. `verifiedUserFacing` alone does not protect
        // them - core lets a canonical result outrank the evaluator only when
        // it is the turn's *single* successful step, so one more successful
        // step (the estimate a planner ran first, the status read it plans
        // next) drops the receipt to the model's paraphrase of it, and a
        // paraphrased or omitted deposit id is an order the user cannot
        // track, top up, or withdraw. Halting ends the turn on this text
        // verbatim, and nothing needs to follow a submitted deposit.
        continueChain: false,
        values: {
          peerCashActionSucceeded: true,
          peerCashDepositId: result.depositId,
        },
        data: {
          cashout: cashoutResultToJson(result),
          signerSource: signer.source,
        },
      };
    } catch (error) {
      const failure = cashFailureResult(error, "Cash-out");
      if (callback) {
        await callback({
          text: failure.text ?? "Cash-out failed.",
          actions: ["PEER_CASH_CASHOUT"],
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
        content: { text: "Cash out 100 USDC to my Venmo @alice in USD" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Cash out 100 USDC to @alice on venmo in USD at the live oracle market rate (0% spread, rate resolves when a buyer fills)? Reply yes to submit or no to cancel.",
          actions: ["PEER_CASH_CASHOUT"],
        },
      },
      {
        name: "{{userName}}",
        content: { text: "yes" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Cash-out submitted: 100 USDC to @alice on venmo in USD. Deposit id (save this to track or manage the order): base_412.",
          actions: ["PEER_CASH_CASHOUT"],
        },
      },
    ],
  ],
};
