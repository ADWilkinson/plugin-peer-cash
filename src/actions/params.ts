/**
 * Shared parameter extraction for Peer Cash actions. The planner delivers
 * validated parameters through `HandlerOptions.parameters`; older hosts pass
 * them directly on `options`. Values are re-checked here at the handler
 * boundary - parameter schemas guide the model, they do not replace
 * validation - and every rejection carries the exact field and expectation.
 */

import type { HandlerOptions, JsonValue, Memory } from "@elizaos/core";
import { usdc } from "@zkp2p/cash";

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Structured params from planner options, falling back to raw option keys. */
export function actionParams(
  message: Memory,
  options?: HandlerOptions | Record<string, JsonValue | undefined>,
): Record<string, unknown> {
  const optionRecord = objectRecord(options);
  const optionParams = objectRecord(optionRecord?.parameters);
  if (optionParams) return optionParams;
  if (optionRecord && Object.keys(optionRecord).length > 0) return optionRecord;
  return objectRecord(message.content) ?? {};
}

export function stringParam(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return undefined;
}

export function requireStringParam(raw: Record<string, unknown>, key: string): string {
  const value = stringParam(raw, key);
  if (value === undefined) throw new Error(`${key} is required`);
  return value;
}

export function numberParam(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function booleanParam(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
}

/**
 * Positive USDC amount in base units (6 decimals) from a human-unit param.
 * Rejects zero, negatives, malformed numbers, and sub-micro precision.
 */
export function requireUsdcAmountParam(raw: Record<string, unknown>, key: string): bigint {
  const value = raw[key];
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? value.toString()
      : typeof value === "string" && value.trim() !== ""
        ? value.trim()
        : undefined;
  if (text === undefined) {
    throw new Error(`${key} is required: a positive USDC amount such as 100 or "49.50"`);
  }
  let baseUnits: bigint;
  try {
    baseUnits = usdc(text);
  } catch {
    throw new Error(
      `${key} must be a positive USDC amount with at most 6 decimals (got "${text}")`,
    );
  }
  if (baseUnits <= 0n) {
    throw new Error(`${key} must be greater than zero`);
  }
  return baseUnits;
}

const DEPOSIT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Composite deposit id (`escrow_onchainId`) - the resume key for an order. */
export function requireDepositIdParam(raw: Record<string, unknown>, key = "depositId"): string {
  const value = requireStringParam(raw, key);
  if (!DEPOSIT_ID_PATTERN.test(value)) {
    throw new Error(
      `${key} must be the deposit id returned by the cash-out (for example "base_123"), got "${value}"`,
    );
  }
  return value;
}

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function addressParam(raw: Record<string, unknown>, key: string): `0x${string}` | undefined {
  const value = stringParam(raw, key);
  if (value === undefined) return undefined;
  if (!EVM_ADDRESS_PATTERN.test(value)) {
    throw new Error(`${key} must be a 0x-prefixed EVM address (got "${value}")`);
  }
  return value as `0x${string}`;
}
