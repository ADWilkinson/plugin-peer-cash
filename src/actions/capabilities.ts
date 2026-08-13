/**
 * Discovery action: payout platforms, their currencies and payee formats,
 * amount bounds, and 30-day fill evidence. `capabilities()` is synchronous
 * and static; `fillStats()` is a network read that fails open - when stats
 * are unavailable the full catalog is still reported with an explicit note,
 * matching the SDK's own availability guidance.
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
import { type CashFillStats, capabilitiesToJson, fillStatsToJson } from "@zkp2p/cash";
import { cashFailureResult, describeCashFailure } from "../errors.js";
import { formatCapabilitiesText } from "../format.js";
import { getPeerCashService } from "../service.js";
import { actionParams, booleanParam } from "./params.js";
import { serviceUnavailableResult } from "./unavailable.js";

export const peerCashCapabilitiesAction: Action = {
  name: "PEER_CASH_CAPABILITIES",
  similes: ["CASH_OUT_OPTIONS", "OFFRAMP_PLATFORMS", "PEER_CASH_PLATFORMS", "CASH_OUT_METHODS"],
  description:
    "List where Peer Cash can send fiat: payout platforms (Venmo, Revolut, Wise, Zelle, and " +
    "more), the currencies each supports, the payee handle format, amount bounds, and recent " +
    "fill evidence per corridor. Read-only.",
  routingHint:
    "which platforms/currencies can I cash out to -> PEER_CASH_CAPABILITIES; price for a " +
    "specific amount -> PEER_CASH_ESTIMATE",
  parameters: [
    {
      name: "includeFillStats",
      description:
        "Include 30-day fill counts per corridor (one extra network read). Default true.",
      required: false,
      schema: { type: "boolean", default: true },
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
      return serviceUnavailableResult("PEER_CASH_CAPABILITIES", message, callback);
    }

    try {
      const raw = actionParams(message, options);
      const includeFillStats = booleanParam(raw, "includeFillStats") ?? true;
      const client = service.getClient();
      const capabilities = client.capabilities();

      let fillStats: CashFillStats | null = null;
      let statsNote: string | null = null;
      if (includeFillStats) {
        // error-policy:J4 user-facing degrade - fill stats are evidence, not a
        // gate; the SDK's guidance is to fail open to the full catalog, and the
        // degraded state is reported explicitly in the reply and result data.
        try {
          fillStats = await client.fillStats();
        } catch (error) {
          const failure = describeCashFailure(error, "Fill stats read");
          statsNote = `Fill statistics are temporarily unavailable (${failure.message}); showing the full catalog without them.`;
          logger.warn(`[plugin-peer-cash] ${statsNote}`);
        }
      }

      const text = formatCapabilitiesText(capabilities, fillStats, statsNote);

      if (callback) {
        await callback({
          text,
          actions: ["PEER_CASH_CAPABILITIES"],
          source: message.content.source,
        });
      }

      return {
        success: true,
        text,
        values: {
          peerCashPlatformCount: capabilities.platforms.length,
          peerCashEnvironment: capabilities.environment,
        },
        data: {
          capabilities: capabilitiesToJson(capabilities),
          ...(fillStats ? { fillStats: fillStatsToJson(fillStats) } : {}),
          ...(statsNote ? { fillStatsUnavailable: statsNote } : {}),
        },
      };
    } catch (error) {
      const failure = cashFailureResult(error, "Capability discovery");
      if (callback) {
        await callback({
          text: failure.text ?? "Capability discovery failed.",
          actions: ["PEER_CASH_CAPABILITIES"],
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
        content: { text: "Where can I cash out USDC to?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Peer Cash (production) cashes out Base USDC to fiat at the live oracle market rate with 0% spread. Payout platforms include venmo (USD), revolut (EUR, GBP, USD), wise, zelle, and more.",
          actions: ["PEER_CASH_CAPABILITIES"],
        },
      },
    ],
    [
      {
        name: "{{userName}}",
        content: { text: "Does Peer Cash support Revolut in GBP?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Yes: revolut supports EUR, GBP, and USD payouts. The payee is your Revolut revtag.",
          actions: ["PEER_CASH_CAPABILITIES"],
        },
      },
    ],
  ],
};
