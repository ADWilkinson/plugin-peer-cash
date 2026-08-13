/**
 * Test harness for the Peer Cash plugin suites. Component tests run against a
 * lightweight mocked runtime (settings map, service registry, in-memory
 * cache for the confirmation gate) and a mocked `CashClient` surface; the
 * real `AgentRuntime` with the in-memory database adapter is reserved for the
 * runtime integration lane in `src/e2e/`. No test touches the network.
 */

import { randomUUID } from "node:crypto";
import {
  AgentRuntime,
  type Character,
  type HandlerCallback,
  type IAgentRuntime,
  InMemoryDatabaseAdapter,
  type Memory,
  type Plugin,
  type State,
  type UUID,
} from "@elizaos/core";
import type {
  CashCapabilities,
  CashClient,
  CashEstimate,
  CashOrder,
  CashoutResult,
  TopUpResult,
  WithdrawResult,
} from "@zkp2p/cash";
import { vi } from "vitest";
import type { PeerCashConfig } from "../environment.js";
import type { PeerCashService } from "../service.js";
import { PEER_CASH_SERVICE_TYPE } from "../service.js";
import type { ResolvedSigner } from "../wallet.js";

export function createUUID(): UUID {
  return randomUUID() as UUID;
}

/** Deterministic dev key (anvil account 0) - never funded, test-only. */
export const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

export interface MockRuntimeOptions {
  settings?: Record<string, string>;
  services?: Record<string, unknown>;
}

/**
 * Minimal runtime double covering exactly what the plugin touches:
 * `getSetting`, `getService`, and the cache trio used by the confirmation
 * gate.
 */
export function createMockRuntime(options: MockRuntimeOptions = {}): IAgentRuntime {
  const settings = new Map(Object.entries(options.settings ?? {}));
  const services = new Map(Object.entries(options.services ?? {}));
  const cache = new Map<string, unknown>();

  const runtime = {
    agentId: createUUID(),
    getSetting: (key: string) => settings.get(key) ?? null,
    getService: (serviceType: string) => services.get(serviceType) ?? null,
    getCache: async <T>(key: string): Promise<T | undefined> => cache.get(key) as T | undefined,
    setCache: async (key: string, value: unknown): Promise<boolean> => {
      cache.set(key, value);
      return true;
    },
    deleteCache: async (key: string): Promise<boolean> => cache.delete(key),
  };
  return runtime as unknown as IAgentRuntime;
}

export function createTestMessage(text: string, entityId?: UUID): Memory {
  return {
    id: createUUID(),
    entityId: entityId ?? ("11111111-1111-1111-1111-111111111111" as UUID),
    roomId: "22222222-2222-2222-2222-222222222222" as UUID,
    content: { text, source: "test" },
    createdAt: Date.now(),
  };
}

export const emptyState: State = { values: {}, data: {}, text: "" };

export function createCallbackSpy(): {
  callback: HandlerCallback;
  calls: Array<{ text?: string }>;
} {
  const calls: Array<{ text?: string }> = [];
  const callback: HandlerCallback = async (content) => {
    calls.push({ text: content.text });
    return [];
  };
  return { callback, calls };
}

export const capabilitiesFixture: CashCapabilities = {
  chainId: 8453,
  token: {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    decimals: 6,
  },
  environment: "production",
  destination: {
    chainId: 8453,
    token: {
      address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      decimals: 6,
    },
  },
  source: {
    default: {
      chainId: 8453,
      token: {
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        symbol: "USDC",
        decimals: 6,
      },
    },
  },
  platforms: [
    {
      platform: "venmo",
      currencies: ["USD"],
      payeeHint: "Your Venmo username, like @alice",
      requiresIdentityAttestation: false,
      requiresAtomicAccessPolicy: false,
    },
    {
      platform: "revolut",
      currencies: ["EUR", "GBP", "USD"],
      payeeHint: "Your Revolut revtag",
      requiresIdentityAttestation: false,
      requiresAtomicAccessPolicy: false,
    },
    {
      platform: "wise",
      currencies: ["EUR", "GBP", "USD"],
      payeeHint: "Your Wise email or wisetag",
      requiresIdentityAttestation: true,
      requiresAtomicAccessPolicy: false,
    },
  ],
  currencies: ["EUR", "GBP", "USD"],
  amount: { min: 10_000n, recommendedMin: 1_000_000n, max: null },
  pricing: { kind: "oracle-market-rate", spreadBps: 0 },
};

export const estimateFixture: CashEstimate = {
  kind: "oracle-estimate",
  currency: "EUR",
  amount: 1_000_000_000n,
  rate: 0.9205,
  receiveAmount: 920.5,
  asOf: 1_760_000_000,
  eta: { seconds: 1800, label: "usually fills within 30 minutes" },
};

export function createOrderFixture(overrides: Partial<CashOrder> = {}): CashOrder {
  const order: CashOrder = {
    depositId: "base_412",
    state: "awaiting-buyer",
    fills: [],
    totalAmount: 100_000_000n,
    filledAmount: 0n,
    pendingAmount: 0n,
    returnedAmount: 0n,
    nextActions: ["wait", "withdraw"],
    isInFlight: true,
    explain: () => "Waiting for a buyer to take this order.",
    ...overrides,
  };
  return order;
}

export const cashoutResultFixture: CashoutResult = {
  depositId: "base_412",
  txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
  escrowAddress: "0x3333333333333333333333333333333333333333",
  onchainDepositId: 412n,
  order: createOrderFixture(),
};

export const withdrawResultFixture: WithdrawResult = {
  depositId: "base_412",
  withdrawTxHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
};

export const topUpResultFixture: TopUpResult = {
  depositId: "base_412",
  txHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
};

export interface MockCashClient {
  capabilities: ReturnType<typeof vi.fn>;
  fillStats: ReturnType<typeof vi.fn>;
  estimate: ReturnType<typeof vi.fn>;
  cashout: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  orders: ReturnType<typeof vi.fn>;
  withdraw: ReturnType<typeof vi.fn>;
  topUp: ReturnType<typeof vi.fn>;
}

export function createMockCashClient(overrides: Partial<MockCashClient> = {}): MockCashClient {
  return {
    capabilities: vi.fn(() => capabilitiesFixture),
    fillStats: vi.fn(async () => ({ "venmo:USD": { fills: 42, medianFillSeconds: 900 } })),
    estimate: vi.fn(async () => estimateFixture),
    cashout: vi.fn(async () => cashoutResultFixture),
    order: vi.fn(async () => createOrderFixture()),
    orders: vi.fn(async () => [createOrderFixture()]),
    withdraw: vi.fn(async () => withdrawResultFixture),
    topUp: vi.fn(async () => topUpResultFixture),
    ...overrides,
  };
}

export const testSignerFixture: ResolvedSigner = {
  walletClient: {} as ResolvedSigner["walletClient"],
  address: TEST_ADDRESS,
  source: "EVM_PRIVATE_KEY",
};

export interface MockServiceOptions {
  client?: MockCashClient;
  config?: Partial<PeerCashConfig>;
  signer?: ResolvedSigner | null;
}

/**
 * Service double satisfying `getPeerCashService`'s duck check. `signer: null`
 * simulates a runtime with no wallet configured.
 */
export function createMockPeerCashService(options: MockServiceOptions = {}): {
  service: PeerCashService;
  client: MockCashClient;
} {
  const client = options.client ?? createMockCashClient();
  const config: PeerCashConfig = { environment: "production", ...options.config };
  const signer = options.signer === undefined ? testSignerFixture : options.signer;
  const service = {
    getClient: () => client as unknown as CashClient,
    getConfig: () => config,
    getSigner: (): ResolvedSigner => {
      if (!signer) {
        throw new Error(
          "No signer is configured. Register an EVM wallet backend (for example " +
            "@elizaos/plugin-wallet) or set EVM_PRIVATE_KEY so the agent can sign Peer Cash " +
            "transactions on Base.",
        );
      }
      return signer;
    },
    getSignerAddressOrNull: () => (signer ? signer.address : null),
  };
  return { service: service as unknown as PeerCashService, client };
}

export function createRuntimeWithService(options: MockServiceOptions = {}): {
  runtime: IAgentRuntime;
  client: MockCashClient;
} {
  const { service, client } = createMockPeerCashService(options);
  const runtime = createMockRuntime({ services: { [PEER_CASH_SERVICE_TYPE]: service } });
  return { runtime, client };
}

const DEFAULT_TEST_CHARACTER: Character = {
  name: "Eliza",
  bio: ["Test agent for the Peer Cash plugin"],
  system: "You are a test agent.",
  plugins: [],
  settings: {},
  secrets: {},
};

/** Real in-memory `AgentRuntime` for the e2e lane, mirroring the CLI template. */
export async function createRealTestRuntime(
  options: { character?: Partial<Character>; plugins?: Plugin[] } = {},
): Promise<IAgentRuntime> {
  const character: Character = {
    ...DEFAULT_TEST_CHARACTER,
    id: createUUID(),
    ...options.character,
  };
  const runtime = new AgentRuntime({
    agentId: character.id ?? createUUID(),
    character,
    adapter: new InMemoryDatabaseAdapter(),
    enableDocuments: false,
    enableRelationships: false,
    enableTrajectories: false,
    plugins: options.plugins,
  });
  await runtime.initialize();
  return runtime;
}

export async function cleanupRealTestRuntime(runtime: IAgentRuntime): Promise<void> {
  await runtime.stop();
}
