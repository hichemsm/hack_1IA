/**
 * ABI de CareVault (sous-ensemble utilisé par les agents et l'interface).
 * Après modification du contrat : `pnpm abi` régénère ce fichier depuis contracts/out.
 */
const breakdown = {
  name: "breakdown",
  type: "tuple",
  components: [
    { name: "secu", type: "uint64" },
    { name: "mutuelle", type: "uint64" },
    { name: "resteACharge", type: "uint64" },
  ],
} as const;

const paymentOrder = {
  name: "o",
  type: "tuple",
  components: [
    { name: "invoiceHash", type: "bytes32" },
    { name: "providerId", type: "bytes32" },
    { name: "category", type: "uint8" },
    { name: "amount", type: "uint256" },
    breakdown,
    { name: "baremeHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const careVaultAbi = [
  // écriture
  {
    type: "function", name: "agentPay", stateMutability: "nonpayable",
    inputs: [paymentOrder, { name: "securitySig", type: "bytes" }],
    outputs: [{ name: "executed", type: "bool" }, { name: "pendingId", type: "uint256" }],
  },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "pendingId", type: "uint256" }], outputs: [] },
  { type: "function", name: "reject", stateMutability: "nonpayable", inputs: [{ name: "pendingId", type: "uint256" }], outputs: [] },
  { type: "function", name: "revokeAgents", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function", name: "addProvider", stateMutability: "nonpayable",
    inputs: [
      { name: "providerId", type: "bytes32" }, { name: "payout", type: "address" },
      { name: "category", type: "uint8" }, { name: "sector", type: "uint8" },
    ],
    outputs: [],
  },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },

  // lecture
  {
    type: "function", name: "providers", stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "payout", type: "address" }, { name: "category", type: "uint8" }, { name: "sector", type: "uint8" },
      { name: "activeAt", type: "uint64" }, { name: "exists", type: "bool" },
    ],
  },
  { type: "function", name: "invoiceUsed", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "approvalThreshold", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "pendingCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "hashApproval", stateMutability: "view", inputs: [paymentOrder], outputs: [{ name: "", type: "bytes32" }] },

  // events (journal d'audit)
  {
    type: "event", name: "PaymentExecuted", anonymous: false,
    inputs: [
      { name: "invoiceHash", type: "bytes32", indexed: true },
      { name: "providerId", type: "bytes32", indexed: true },
      { name: "payout", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { ...breakdown, indexed: false },
      { name: "baremeHash", type: "bytes32", indexed: false },
      { name: "approvedByGuardian", type: "bool", indexed: false },
    ],
  },
  {
    type: "event", name: "PaymentQueued", anonymous: false,
    inputs: [
      { name: "pendingId", type: "uint256", indexed: true },
      { name: "invoiceHash", type: "bytes32", indexed: true },
      { name: "providerId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "event", name: "AgentsRevoked", anonymous: false, inputs: [] },

  // erreurs (décodées puis traduites par l'agent transaction)
  { type: "error", name: "NotGuardian", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "NotTransactionAgent", inputs: [] },
  { type: "error", name: "AgentsAreRevoked", inputs: [] },
  { type: "error", name: "AgentsExpired", inputs: [] },
  { type: "error", name: "ApprovalExpired", inputs: [] },
  { type: "error", name: "BadSecuritySignature", inputs: [] },
  { type: "error", name: "UnknownProvider", inputs: [] },
  { type: "error", name: "ProviderNotYetActive", inputs: [{ name: "activeAt", type: "uint64" }] },
  { type: "error", name: "CategoryMismatch", inputs: [] },
  { type: "error", name: "InvoiceAlreadyUsed", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "AboveTxCap", inputs: [{ name: "cap", type: "uint256" }] },
  { type: "error", name: "AboveDailyCap", inputs: [{ name: "cap", type: "uint256" }] },
  { type: "error", name: "NotPending", inputs: [] },
  { type: "error", name: "ECDSAInvalidSignature", inputs: [] },
  { type: "error", name: "ECDSAInvalidSignatureLength", inputs: [{ name: "length", type: "uint256" }] },
  { type: "error", name: "ECDSAInvalidSignatureS", inputs: [{ name: "s", type: "bytes32" }] },
] as const;

/** Types EIP-712 signés par l'agent sécurité — identiques à APPROVAL_TYPEHASH dans CareVault.sol */
export const approvalTypes = {
  SecurityApproval: [
    { name: "invoiceHash", type: "bytes32" },
    { name: "providerId", type: "bytes32" },
    { name: "category", type: "uint8" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
