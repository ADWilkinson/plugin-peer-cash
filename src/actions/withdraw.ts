/**
 * The one unwind verb. A full withdrawal closes the order (pruning expired
 * buyer intents first when needed); a partial withdrawal with an amount
 * returns unlocked funds while the order stays live. Confirmation-gated: the
 * preview names the order and scope, and only a yes reply on a later turn
 * submits. There is no separate cancel - `withdraw` is state-aware.
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
import { formatUsdc, withdrawResultToJson } from "@zkp2p/cash";
import { cashFailureResult, submitConfirmed } from "../errors.js";
import { gatePeerCashExecution, peerCashGateActionResult } from "../security/confirmation.js";
import { getPeerCashService } from "../service.js";
import {
  actionParams,
  requireDepositIdParam,
  requireUsdcAmountParam,
  stringParam,
} from "./params.js";
import { serviceUnavailableResult } from "./unavailable.js";

export const peerCashWithdrawAction: Action = {
  name: "PEER_CASH_WITHDRAW",
  similes: ["CANCEL_CASH_OUT", "WITHDRAW_CASH_OUT", "PEER_CASH_CANCEL", "CLOSE_CASH_OUT"],
  description:
    "Withdraw funds from a Peer Cash order back to the agent wallet. Without an amount the " +
    "order is closed fully (expired buyer intents are pruned first); with an amount only that " +
    "unlocked portion is returned and the order stays live. Requires a user confirmation turn.",
  routingHint:
    "cancel/unwind/get funds back from a cash-out -> PEER_CASH_WITHDRAW; checking state " +
    "first -> PEER_CASH_ORDER_STATUS",
  tags: ["capability:execute"],
  parameters: [
    {
      name: "depositId",
      description: "The deposit id of the order to withdraw from, for example base_412",
      required: true,
      schema: { type: "string", minLength: 1 },
      examples: ["base_412"],
    },
    {
      name: "amount",
      description:
        "Optional partial amount in USDC units. Omit to close the order and withdraw everything.",
      required: false,
      schema: { type: "number", minimum: 0.01 },
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
      return serviceUnavailableResult("PEER_CASH_WITHDRAW", message, callback);
    }

    try {
      const raw = actionParams(message, options);
      const depositId = requireDepositIdParam(raw);
      const partialAmount =
        stringParam(raw, "amount") !== undefined || typeof raw.amount === "number"
          ? requireUsdcAmountParam(raw, "amount")
          : undefined;

      const signer = service.getSigner();

      const gate = await gatePeerCashExecution({
        runtime,
        message,
        params: {
          operation: "withdraw",
          environment: service.getConfig().environment,
          depositId,
          ...(partialAmount !== undefined ? { amountBaseUnits: partialAmount } : {}),
        },
        callback,
      });
      if (!gate.proceed) {
        return peerCashGateActionResult(gate);
      }

      // The confirmation is spent; a failure past this point ends the turn.
      const result = await submitConfirmed(() =>
        service.getClient().withdraw(depositId, {
          signer: signer.walletClient,
          ...(partialAmount !== undefined ? { amount: partialAmount } : {}),
        }),
      );

      const scope =
        partialAmount === undefined
          ? "Order closed; all remaining funds returned"
          : `Partial withdrawal of ${formatUsdc(partialAmount)} USDC submitted`;
      const lines = [
        `${scope} for ${result.depositId}.`,
        `Withdrawal transaction: ${result.withdrawTxHash}.`,
      ];
      if (result.pruneTxHash) {
        lines.push(`Expired buyer intents were pruned first: ${result.pruneTxHash}.`);
      }
      const text = lines.join(" ");

      if (callback) {
        await callback({
          text,
          actions: ["PEER_CASH_WITHDRAW"],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text,
        userFacingText: text,
        verifiedUserFacing: true,
        // Same halt the cash-out receipt takes, for the same reason: the
        // withdrawal and prune hashes are the evidence the unwind happened,
        // and core's canonical override survives a turn only while this is
        // its single successful step.
        continueChain: false,
        values: {
          peerCashActionSucceeded: true,
          peerCashDepositId: result.depositId,
        },
        data: {
          withdrawal: withdrawResultToJson(result),
          partial: partialAmount !== undefined,
        },
      };
    } catch (error) {
      const failure = cashFailureResult(error, "Withdrawal");
      if (callback) {
        await callback({
          text: failure.text ?? "Withdrawal failed.",
          actions: ["PEER_CASH_WITHDRAW"],
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
        content: { text: "Cancel my cash-out base_412 and get the USDC back" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Withdraw all remaining funds from Peer Cash order base_412 back to the agent wallet? Reply yes to submit or no to cancel.",
          actions: ["PEER_CASH_WITHDRAW"],
        },
      },
      {
        name: "{{userName}}",
        content: { text: "yes" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Order closed; all remaining funds returned for base_412.",
          actions: ["PEER_CASH_WITHDRAW"],
        },
      },
    ],
  ],
};
