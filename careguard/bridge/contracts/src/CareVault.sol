// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title CareVault — coffre de santé d'un foyer, piloté par des agents sous le contrôle d'un aidant
/// @notice Un paiement d'agent exige DEUX choses : l'appel de l'agent transaction ET une signature
///         EIP-712 valide de l'agent sécurité. Les plafonds s'appliquent même si les deux sont compromis.
/// @dev Aucune donnée de santé on-chain : seulement des hashes, une catégorie et des montants.
contract CareVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Catégories : 1 médecin, 2 paramédical, 3 pharmacie, 4 aide à domicile
    struct Provider {
        address payout;
        uint8 category;
        uint8 sector; // 1 ou 2 (conventionnement)
        uint64 activeAt; // payable à partir de cet instant
        bool exists;
    }

    struct Rule {
        uint128 perTxCap;
        uint128 dailyCap;
    }

    /// Répartition estimée par l'agent montants (unités tUSD8), conservée pour l'audit
    struct Breakdown {
        uint64 secu;
        uint64 mutuelle;
        uint64 resteACharge;
    }

    struct PaymentOrder {
        bytes32 invoiceHash;
        bytes32 providerId;
        uint8 category;
        uint256 amount;
        Breakdown breakdown;
        bytes32 baremeHash;
        uint256 deadline; // fin de validité de la signature de sécurité
    }

    struct Pending {
        PaymentOrder order;
        bool open;
    }

    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "SecurityApproval(bytes32 invoiceHash,bytes32 providerId,uint8 category,uint256 amount,uint256 deadline)"
    );

    IERC20 public immutable token;
    address public immutable guardian;
    uint256 public immutable providerDelay;

    address public transactionAgent;
    address public securitySigner;
    uint64 public agentsExpiry;
    bool public agentsRevoked;
    uint256 public approvalThreshold;

    mapping(bytes32 => Provider) public providers;
    mapping(uint8 => Rule) public rules;
    mapping(uint8 => mapping(uint256 => uint256)) public spentPerDay;
    mapping(bytes32 => bool) public invoiceUsed;
    Pending[] private _pending;

    // Erreurs lisibles : l'interface les traduit pour l'aidante
    error NotGuardian();
    error ZeroAddress();
    error NotTransactionAgent();
    error AgentsAreRevoked();
    error AgentsExpired();
    error ApprovalExpired();
    error BadSecuritySignature();
    error UnknownProvider();
    error ProviderNotYetActive(uint64 activeAt);
    error CategoryMismatch();
    error InvoiceAlreadyUsed();
    error ZeroAmount();
    error AboveTxCap(uint256 cap);
    error AboveDailyCap(uint256 cap);
    error NotPending();

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AgentsSet(address transactionAgent, address securitySigner, uint64 expiry);
    event AgentsRevoked();
    event RuleSet(uint8 indexed category, uint128 perTxCap, uint128 dailyCap);
    event ApprovalThresholdSet(uint256 threshold);
    event ProviderAdded(bytes32 indexed providerId, address payout, uint8 category, uint8 sector, uint64 activeAt);
    event ProviderRemoved(bytes32 indexed providerId);
    event PaymentQueued(uint256 indexed pendingId, bytes32 indexed invoiceHash, bytes32 indexed providerId, uint256 amount);
    event PaymentExecuted(
        bytes32 indexed invoiceHash,
        bytes32 indexed providerId,
        address indexed payout,
        uint256 amount,
        Breakdown breakdown,
        bytes32 baremeHash,
        bool approvedByGuardian
    );
    event PaymentRejected(uint256 indexed pendingId, bytes32 indexed invoiceHash);

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(IERC20 token_, address guardian_, uint256 providerDelay_) EIP712("CareGuard", "1") {
        if (address(token_) == address(0) || guardian_ == address(0)) revert ZeroAddress();
        token = token_;
        guardian = guardian_;
        providerDelay = providerDelay_;
    }

    // ───────────── Fonds ─────────────

    function deposit(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(address to, uint256 amount) external onlyGuardian nonReentrant {
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // ───────────── Règles (aidante) ─────────────

    function setAgents(address transactionAgent_, address securitySigner_, uint64 expiry) external onlyGuardian {
        if (transactionAgent_ == address(0) || securitySigner_ == address(0)) revert ZeroAddress();
        transactionAgent = transactionAgent_;
        securitySigner = securitySigner_;
        agentsExpiry = expiry;
        agentsRevoked = false;
        emit AgentsSet(transactionAgent_, securitySigner_, expiry);
    }

    /// Coupe immédiatement les deux agents
    function revokeAgents() external onlyGuardian {
        agentsRevoked = true;
        emit AgentsRevoked();
    }

    function setRule(uint8 category, uint128 perTxCap, uint128 dailyCap) external onlyGuardian {
        rules[category] = Rule(perTxCap, dailyCap);
        emit RuleSet(category, perTxCap, dailyCap);
    }

    function setApprovalThreshold(uint256 threshold) external onlyGuardian {
        approvalThreshold = threshold;
        emit ApprovalThresholdSet(threshold);
    }

    /// Ajouter (ou modifier) un soignant relance toujours le délai : un « nouveau RIB » n'est jamais payable tout de suite
    function addProvider(bytes32 providerId, address payout, uint8 category, uint8 sector) external onlyGuardian {
        if (payout == address(0)) revert ZeroAddress();
        uint64 activeAt = uint64(block.timestamp + providerDelay);
        providers[providerId] = Provider(payout, category, sector, activeAt, true);
        emit ProviderAdded(providerId, payout, category, sector, activeAt);
    }

    function removeProvider(bytes32 providerId) external onlyGuardian {
        delete providers[providerId];
        emit ProviderRemoved(providerId);
    }

    // ───────────── Paiement par les agents ─────────────

    function hashApproval(PaymentOrder calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(APPROVAL_TYPEHASH, o.invoiceHash, o.providerId, o.category, o.amount, o.deadline))
        );
    }

    /// @return executed vrai si payé immédiatement, faux si mis en attente de l'aidante
    /// @return pendingId identifiant de l'attente (type(uint256).max si payé)
    function agentPay(PaymentOrder calldata o, bytes calldata securitySig)
        external
        nonReentrant
        returns (bool executed, uint256 pendingId)
    {
        _checkAuth(o, securitySig);
        address payout = _checkAndConsumeLimits(o);

        if (o.amount > approvalThreshold) {
            pendingId = _pending.length;
            _pending.push();
            Pending storage pd = _pending[pendingId];
            PaymentOrder memory m = o;
            pd.order = m;
            pd.open = true;
            emit PaymentQueued(pendingId, o.invoiceHash, o.providerId, o.amount);
            return (false, pendingId);
        }

        _execute(o, payout, false);
        return (true, type(uint256).max);
    }

    // ───────────── Double validation (aidante) ─────────────

    function approve(uint256 pendingId) external onlyGuardian nonReentrant {
        Pending storage pd = _pending[pendingId];
        if (!pd.open) revert NotPending();
        pd.open = false;
        Provider memory p = providers[pd.order.providerId];
        if (!p.exists) revert UnknownProvider();
        _execute(pd.order, p.payout, true);
    }

    /// La facture reste marquée comme utilisée : elle ne pourra pas être resoumise
    function reject(uint256 pendingId) external onlyGuardian {
        Pending storage pd = _pending[pendingId];
        if (!pd.open) revert NotPending();
        pd.open = false;
        emit PaymentRejected(pendingId, pd.order.invoiceHash);
    }

    function pendingCount() external view returns (uint256) {
        return _pending.length;
    }

    function getPending(uint256 pendingId) external view returns (Pending memory) {
        return _pending[pendingId];
    }

    // ───────────── Interne ─────────────

    function _checkAuth(PaymentOrder calldata o, bytes calldata securitySig) internal view {
        if (msg.sender != transactionAgent) revert NotTransactionAgent();
        if (agentsRevoked) revert AgentsAreRevoked();
        if (block.timestamp > agentsExpiry) revert AgentsExpired();
        if (block.timestamp > o.deadline) revert ApprovalExpired();
        if (ECDSA.recover(hashApproval(o), securitySig) != securitySigner) revert BadSecuritySignature();
    }

    function _checkAndConsumeLimits(PaymentOrder calldata o) internal returns (address payout) {
        Provider memory p = providers[o.providerId];
        if (!p.exists) revert UnknownProvider();
        if (block.timestamp < p.activeAt) revert ProviderNotYetActive(p.activeAt);
        if (p.category != o.category) revert CategoryMismatch();
        if (invoiceUsed[o.invoiceHash]) revert InvoiceAlreadyUsed();
        if (o.amount == 0) revert ZeroAmount();

        Rule memory r = rules[o.category];
        if (o.amount > r.perTxCap) revert AboveTxCap(r.perTxCap);
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentPerDay[o.category][day] + o.amount;
        if (spent > r.dailyCap) revert AboveDailyCap(r.dailyCap);

        invoiceUsed[o.invoiceHash] = true;
        spentPerDay[o.category][day] = spent;
        return p.payout;
    }

    function _execute(PaymentOrder memory o, address payout, bool byGuardian) internal {
        token.safeTransfer(payout, o.amount);
        emit PaymentExecuted(o.invoiceHash, o.providerId, payout, o.amount, o.breakdown, o.baremeHash, byGuardian);
    }
}
