# @davyjones0x/plugin-peer-cash

Peer Cash offramp for elizaOS agents. Your agent can cash out its Base USDC to a fiat payment app (Venmo, Revolut, Wise, Zelle, and more) through the Peer P2P protocol, then track the order, withdraw, or top it up.

Built on [@zkp2p/cash](https://www.npmjs.com/package/@zkp2p/cash), the offramp-only SDK for the ZKP2P protocol. No API keys, completely self serve and really easy to integrate. Live in production on [peer.xyz](https://peer.xyz).

## How it works

The agent is the maker. Its USDC goes into a Peer protocol escrow contract as a deposit, a buyer pays the fiat to the agent's payee handle and proves the payment with a TEE attestation, and the protocol releases the USDC to the buyer. Pricing is the live Chainlink oracle rate at fill time with 0% spread. There is no quote engine and no centralized off-ramp provider in the middle.

## Actions

| Action | What it does | Moves funds |
| --- | --- | --- |
| `PEER_CASH_CAPABILITIES` | Payout platforms, currencies, payee formats, amount bounds, 30-day fill evidence | No |
| `PEER_CASH_ESTIMATE` | Fiat receive amount for a USDC amount at the live oracle rate, plus typical fill time | No |
| `PEER_CASH_CASHOUT` | Create a cash-out order (amount, platform, currency, payee) | Yes |
| `PEER_CASH_ORDER_STATUS` | One order by deposit id: state, amounts, next actions | No |
| `PEER_CASH_ORDERS` | All orders for a wallet | No |
| `PEER_CASH_WITHDRAW` | Unwind: full close, or partial with an amount | Yes |
| `PEER_CASH_TOP_UP` | Add USDC to a live order, same payee, same live rate | Yes |

Every funds-moving action asks the user to confirm in chat first and only submits after a yes reply on a later turn. The confirmation is keyed to the exact amount, platform, currency, payee, and deposit id, so a yes cannot authorize different parameters.

## Install

```bash
bun add @davyjones0x/plugin-peer-cash
```

Add `@davyjones0x/plugin-peer-cash` to your character's `plugins` array.

`@elizaos/core` is a peer dependency, so the plugin runs on the host's core rather than
installing a second copy of it. elizaOS 2.x is required; a 1.x host will report a peer conflict
instead of failing later inside the runtime.

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PEER_CASH_ENVIRONMENT` | No | `production` | `production`, `preproduction`, or `staging`. Selects contracts, curator, and indexer. |
| `PEER_CASH_REFERRAL_CODE` | No | none | Your six character Peer referral code. See the integration share section below. |
| `PEER_CASH_REFERRER` | No | none | Analytics-only ERC-8021 attribution code, for example `acme-app`. No fee share. |
| `PEER_CASH_RPC_URL` | No | public Base RPC | Base RPC override for oracle and order reads. |
| `EVM_PRIVATE_KEY` | No | none | Fallback signer, 0x-prefixed 32-byte hex. Only used when no wallet backend service is registered. |

Invalid configuration fails plugin initialization with the exact problem, not the first cash-out.

Settings are read per agent: the agent's own runtime setting first, then `process.env`. Plugin
config passed to `init` is applied to that agent alone and never written back to `process.env`,
so on a host running several agents in one process one agent's environment, referral code, or
`EVM_PRIVATE_KEY` cannot become another agent's default.

## Wallet

The agent signs with its own wallet. The plugin looks for a registered wallet backend service first (the `@elizaos/plugin-wallet` convention, service type `wallet-backend`) and uses its EVM account on Base. If none is registered it falls back to `EVM_PRIVATE_KEY`. The integration is duck-typed, so there is no hard dependency on the wallet plugin.

Hosts that keep custody elsewhere (AA bundlers, policy engines, human approval steps) should use the SDK's unsigned prepare path directly: `prepare()`, `prepareWithdraw()`, and `prepareTopUp()` on `@zkp2p/cash` return unsigned transactions with human-readable step labels. This plugin's actions cover the common case where the agent runtime holds the signer.

## Safety notes

- Non-custodial. Funds sit in the Peer protocol escrow contract, and only the maker wallet can withdraw an unmatched deposit. There is no provider custody and no API key.
- `PEER_CASH_ESTIMATE` is an oracle estimate, not a locked quote. The binding rate resolves at the Chainlink oracle when a buyer fills. The plugin never presents an estimate as a committed price.
- Every funds-moving action requires a fresh user confirmation turn. The prompt ends the turn, so no later planner step can answer it on the user's behalf, and LLM-supplied flags cannot bypass the gate.
- The receipt ends the turn too. A cash-out, withdrawal, or top-up reply reaches the user verbatim, so the deposit id and transaction hashes for funds that have already moved are never a model paraphrase of them.
- Errors are typed. Every failure surfaces the SDK's error code, whether it is retryable, and the remediation sentence, including recovery evidence for uncertain transaction states.
- Venmo, Cash App, and PayPal orders attach an access policy transaction after the deposit confirms. The plugin reports its hash, and a policy failure surfaces the recovery data instead of retrying blind.
- Wise and PayPal need a Peer identity attestation for new payee registrations, which first-party Peer web obtains through the Peer TEE browser extension. Already registered handles work directly. `PEER_CASH_CAPABILITIES` flags these platforms.

## Earn the integration share

Set `PEER_CASH_REFERRAL_CODE` to the six character referral code shown in your Peer mobile or web app. The SDK stamps `peer-ref-XXXXXX` into ERC-8021 attribution on every deposit transaction. When that liquidity fills, Curator pays the code owner 50 bps, capped by the configured Peer service fee. No registration transaction and no separate receiving address, the code already belongs to your Peer wallet, and the mapping is permanent for open deposits. The `PEER_CASH_REFERRER` option is separate and analytics-only.

## Development

```bash
bun install
bun run typecheck
bun run lint:check
bun run test
bun run build
```

Tests mock the cash client surface and never touch the network. The e2e lane runs the plugin's TestSuite against a real in-memory `AgentRuntime`. For live verification against `staging`, follow the maker-side checklist in the [SDK agent manual](https://github.com/zkp2p/peer-cash/blob/main/AGENTS.md).

## Release

A merge to `main` is not a publication. The npm package is the distribution surface.

A publish needs a registry credential, and this repository has none yet. Configure
one of these first, once:

- **npm Trusted Publishing (preferred).** On npmjs.com, add a trusted publisher to
  `@davyjones0x/plugin-peer-cash` for repository `ADWilkinson/plugin-peer-cash` and
  workflow `release.yml`. No stored secret. The workflow provisions npm `11.19.0`,
  because trusted publishing needs npm >= 11.5.1 on Node >= 22.14.0.
- **`NPM_TOKEN` secret.** A granular automation token with publish rights on the
  package, stored as a repository secret.

Then, per release:

1. Bump `package.json` `version` in its own PR and merge once `check` is green.
2. Tag the merge commit (`git tag v0.1.2 && git push origin v0.1.2`).
3. The `release` workflow checks the credential, refuses a tag/`package.json`
   mismatch or an already-published version, runs the same gate as `check`, then
   publishes with npm provenance.

The credential and tag checks run before the gate on purpose: a pushed tag is
immutable, so a release that cannot succeed must fail in seconds rather than after
a full build. `workflow_dispatch` defaults to a dry run, which needs no credential
and never publishes.

## Links

SDK → https://www.npmjs.com/package/@zkp2p/cash
Docs → https://docs.peer.xyz/developer/peer-cash
Prompt → https://peer.xyz/cash-sdk
Builders Club → https://t.me/zk_p2p/167174

## Support

Ask in the [Peer Builders Club](https://t.me/zk_p2p/167174) or ping [@andrewwilkinson](https://x.com/andrewwilkinson) on X.

## License

MIT
