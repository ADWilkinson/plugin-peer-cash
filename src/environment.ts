/**
 * Configuration boundary for the Peer Cash plugin. Settings are read through
 * `runtime.getSetting()` with a `process.env` fallback for single-tenant
 * hosts, then validated once with zod; everything past this module works with
 * the typed `PeerCashConfig` instead of raw strings. Invalid required
 * configuration fails plugin initialization instead of degrading silently.
 */

import type { IAgentRuntime } from "@elizaos/core";
import { z } from "zod";

export const PEER_CASH_ENVIRONMENTS = ["production", "preproduction", "staging"] as const;

export type PeerCashEnvironment = (typeof PEER_CASH_ENVIRONMENTS)[number];

/** Accepted spellings for `PEER_CASH_ENVIRONMENT`, mapped to canonical SDK values. */
const ENVIRONMENT_ALIASES: Record<string, PeerCashEnvironment> = {
  production: "production",
  prod: "production",
  preproduction: "preproduction",
  preprod: "preproduction",
  staging: "staging",
};

const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const EVM_PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const peerCashConfigSchema = z.object({
  PEER_CASH_ENVIRONMENT: z
    .string()
    .optional()
    .transform((value, ctx) => {
      const normalized = (value ?? "production").trim().toLowerCase();
      const environment = ENVIRONMENT_ALIASES[normalized];
      if (!environment) {
        ctx.addIssue({
          code: "custom",
          message:
            `PEER_CASH_ENVIRONMENT must be one of ${PEER_CASH_ENVIRONMENTS.join(", ")} ` +
            `(got "${value}")`,
        });
        return z.NEVER;
      }
      return environment;
    }),
  PEER_CASH_REFERRAL_CODE: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const normalized = value.trim().toUpperCase();
      if (!REFERRAL_CODE_PATTERN.test(normalized)) {
        ctx.addIssue({
          code: "custom",
          message:
            "PEER_CASH_REFERRAL_CODE must be the six character alphanumeric code shown in " +
            `your Peer app (got "${value}")`,
        });
        return z.NEVER;
      }
      return normalized;
    }),
  PEER_CASH_REFERRER: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  PEER_CASH_RPC_URL: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === "") return undefined;
      const trimmed = value.trim();
      try {
        new URL(trimmed);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: `PEER_CASH_RPC_URL must be a valid URL (got "${value}")`,
        });
        return z.NEVER;
      }
      return trimmed;
    }),
  EVM_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === "") return undefined;
      const trimmed = value.trim();
      if (!EVM_PRIVATE_KEY_PATTERN.test(trimmed)) {
        ctx.addIssue({
          code: "custom",
          message: "EVM_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key",
        });
        return z.NEVER;
      }
      return trimmed as `0x${string}`;
    }),
});

/** Validated plugin configuration used by the service, signer, and actions. */
export interface PeerCashConfig {
  environment: PeerCashEnvironment;
  referralCode?: string;
  referrer?: string;
  rpcUrl?: string;
  evmPrivateKey?: `0x${string}`;
}

export const PEER_CASH_SETTING_KEYS = [
  "PEER_CASH_ENVIRONMENT",
  "PEER_CASH_REFERRAL_CODE",
  "PEER_CASH_REFERRER",
  "PEER_CASH_RPC_URL",
  "EVM_PRIVATE_KEY",
] as const;

export type PeerCashSettingKey = (typeof PEER_CASH_SETTING_KEYS)[number];

/**
 * Settings that must never be written anywhere an unrelated agent can read
 * them. Stored as runtime secrets rather than plain settings.
 */
export const PEER_CASH_SENSITIVE_SETTING_KEYS: ReadonlySet<PeerCashSettingKey> = new Set([
  "EVM_PRIVATE_KEY",
]);

/**
 * Per-agent runtime setting first, `process.env` second. Core's
 * `getSetting()` deliberately never reads the OS environment (multi-tenant
 * isolation), so a standalone plugin adds the env fallback itself. Empty
 * strings count as unset.
 */
export function readSetting(runtime: IAgentRuntime, key: PeerCashSettingKey): string | undefined {
  const fromRuntime = runtime.getSetting(key);
  if (typeof fromRuntime === "string" && fromRuntime.trim() !== "") return fromRuntime;
  const fromEnv = process.env[key];
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv;
  return undefined;
}

/**
 * Read and validate every plugin setting. Throws an aggregated, actionable
 * error when any value is malformed; missing optional values stay undefined.
 */
export function resolvePeerCashConfig(runtime: IAgentRuntime): PeerCashConfig {
  const raw: Partial<Record<PeerCashSettingKey, string>> = {};
  for (const key of PEER_CASH_SETTING_KEYS) {
    const value = readSetting(runtime, key);
    if (value !== undefined) raw[key] = value;
  }

  const parsed = peerCashConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`[plugin-peer-cash] invalid configuration: ${details}`);
  }

  return {
    environment: parsed.data.PEER_CASH_ENVIRONMENT,
    referralCode: parsed.data.PEER_CASH_REFERRAL_CODE,
    referrer: parsed.data.PEER_CASH_REFERRER,
    rpcUrl: parsed.data.PEER_CASH_RPC_URL,
    evmPrivateKey: parsed.data.EVM_PRIVATE_KEY,
  };
}
