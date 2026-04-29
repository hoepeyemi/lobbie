// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Reference hook for ENS rotation / CCIP routing (NOT deployed by Lobbie)
/// @notice Lobbie off-chain derives `routingDigest`-compatible bytes from `sessionKey` (see backend `deriveEnsCcipRoutingParam`).
/// Wire your resolver + EIP-3668 gateways to map `(ensNode, routing digest)` → payout / delegate addresses.
/// Multicoin `addr(bytes32,uint256)` and CCIP `OffchainLookup` behavior follow ENS specifications.
interface ILobbieEnsRotationPolicy {
    /// @param ensNode `namehash(normalizedEnsName)`
    /// @param routingDigest Operator-defined encoding of Lobbie’s opaque routing bucket (often keccak256(bytes) of UTF-8 hex from HTTP).
    /// @return signer Effective execution identity for this bucket (rotation policy lives HERE, not in Lobbie).
    function resolveRotationSigner(bytes32 ensNode, bytes32 routingDigest) external view returns (address signer);
}
