/**
 * Signer resolution tests: wallet backend service first (duck-typed against
 * the `wallet-backend` convention), `EVM_PRIVATE_KEY` fallback second, and an
 * actionable error when neither can sign. Accounts are viem test fixtures;
 * nothing is funded or broadcast.
 */

import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { PeerCashConfig } from "../environment.js";
import { BASE_CHAIN_ID, resolveSigner, signerAddressOrNull } from "../wallet.js";
import { createMockRuntime, TEST_ADDRESS, TEST_PRIVATE_KEY } from "./test-utils.js";

const baseConfig: PeerCashConfig = { environment: "production" };

function walletBackendService(overrides: { canSign?: boolean; throwOnAccount?: boolean } = {}) {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  let requestedChainId: number | null = null;
  const backend = {
    canSign: (hint: string) => (overrides.canSign ?? true) && hint === "evm",
    getEvmAccount: (chainId: number) => {
      if (overrides.throwOnAccount) throw new Error("backend exploded");
      requestedChainId = chainId;
      return account;
    },
  };
  return {
    service: { getWalletBackendOrNull: () => backend },
    requestedChainId: () => requestedChainId,
  };
}

describe("resolveSigner", () => {
  it("prefers the runtime wallet backend and requests a Base account", () => {
    const { service, requestedChainId } = walletBackendService();
    const runtime = createMockRuntime({ services: { "wallet-backend": service } });

    const signer = resolveSigner(runtime, baseConfig);

    expect(signer.source).toBe("wallet-backend");
    expect(signer.address).toBe(TEST_ADDRESS);
    expect(requestedChainId()).toBe(BASE_CHAIN_ID);
    expect(signer.walletClient.chain?.id).toBe(BASE_CHAIN_ID);
  });

  it("falls back to EVM_PRIVATE_KEY when the backend cannot sign for EVM", () => {
    const { service } = walletBackendService({ canSign: false });
    const runtime = createMockRuntime({ services: { "wallet-backend": service } });

    const signer = resolveSigner(runtime, {
      ...baseConfig,
      evmPrivateKey: TEST_PRIVATE_KEY,
    });

    expect(signer.source).toBe("EVM_PRIVATE_KEY");
    expect(signer.address).toBe(TEST_ADDRESS);
  });

  it("falls back to EVM_PRIVATE_KEY when the backend throws", () => {
    const { service } = walletBackendService({ throwOnAccount: true });
    const runtime = createMockRuntime({ services: { "wallet-backend": service } });

    const signer = resolveSigner(runtime, {
      ...baseConfig,
      evmPrivateKey: TEST_PRIVATE_KEY,
    });

    expect(signer.source).toBe("EVM_PRIVATE_KEY");
  });

  it("throws an actionable error when nothing can sign", () => {
    expect(() => resolveSigner(createMockRuntime(), baseConfig)).toThrow(
      /No signer is configured.*EVM_PRIVATE_KEY/s,
    );
  });
});

describe("signerAddressOrNull", () => {
  it("returns null instead of throwing when nothing can sign", () => {
    expect(signerAddressOrNull(createMockRuntime(), baseConfig)).toBeNull();
  });

  it("returns the fallback key address", () => {
    expect(
      signerAddressOrNull(createMockRuntime(), { ...baseConfig, evmPrivateKey: TEST_PRIVATE_KEY }),
    ).toBe(TEST_ADDRESS);
  });
});
