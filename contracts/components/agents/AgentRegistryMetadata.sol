// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./AgentRegistryCore.sol";

abstract contract AgentRegistryMetadata is AgentRegistryCore {
    struct AgentMetadata {
        uint256 version;
        string metadata;
        uint256[] chainIds;
    }

    mapping(uint256 => AgentMetadata) private _agentMetadata;
    mapping(bytes32 => bool) private _agentMetadataUniqueness;

    error MetadataNotUnique(bytes32 hash);

    /**
     * @notice Gets agent metadata, version and chain Ids.
     * @param agentId ERC1155 token id of the agent.
     * @return version of the agent.
     * @return metadata IPFS pointer.
     * @return chainIds the agent wants to run in.
     */
    function getAgent(uint256 agentId) public view returns (uint256 version, string memory metadata, uint256[] memory chainIds) {
        return (
            _agentMetadata[agentId].version,
            _agentMetadata[agentId].metadata,
            _agentMetadata[agentId].chainIds
        );
    }

    /**
     * @notice logic for agent update.
     * @dev checks metadata uniqueness and updates agent metadata and version.
     * @param agentId ERC1155 token id of the agent to be created or updated.
     * @param newMetadata IPFS pointer to agent's metadata JSON.
     * @param newChainIds ordered list of chainIds where the agent wants to run.
     */
    function _agentUpdate(uint256 agentId, string memory newMetadata, uint256[] calldata newChainIds) internal virtual override {
        super._agentUpdate(agentId, newMetadata, newChainIds);

        bytes32 oldHash = keccak256(bytes(_agentMetadata[agentId].metadata));
        bytes32 newHash = keccak256(bytes(newMetadata));
        if (_agentMetadataUniqueness[newHash]) revert MetadataNotUnique(newHash);
        _agentMetadataUniqueness[newHash] = true;
        _agentMetadataUniqueness[oldHash] = false;

        uint256 version = _agentMetadata[agentId].version + 1;
        _agentMetadata[agentId] = AgentMetadata({ version: version, metadata: newMetadata, chainIds: newChainIds });
    }

    uint256[48] private __gap;
}
