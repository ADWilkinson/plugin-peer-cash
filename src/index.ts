/**
 * Package entry for `@zkp2p/plugin-peer-cash`. Exports the plugin as both the
 * default and a named export, plus the service, actions, provider, and
 * configuration types integrators may need.
 */

export {
  peerCashCapabilitiesAction,
  peerCashCashoutAction,
  peerCashEstimateAction,
  peerCashOrderStatusAction,
  peerCashOrdersAction,
  peerCashTopUpAction,
  peerCashWithdrawAction,
} from "./actions/index.js";
export {
  PEER_CASH_ENVIRONMENTS,
  type PeerCashConfig,
  type PeerCashEnvironment,
  resolvePeerCashConfig,
} from "./environment.js";
export { peerCashPlugin, peerCashPlugin as default } from "./plugin.js";
export { peerCashProvider } from "./providers/index.js";
export {
  gatePeerCashExecution,
  PEER_CASH_CONFIRM_ACTION,
  type PeerCashWriteParams,
  peerCashPendingKey,
  peerCashPreview,
} from "./security/confirmation.js";
export {
  getPeerCashService,
  PEER_CASH_SERVICE_TYPE,
  PeerCashService,
} from "./service.js";
export { BASE_CHAIN_ID, type ResolvedSigner, resolveSigner } from "./wallet.js";
