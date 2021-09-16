// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/utils/Timers.sol";
import "@openzeppelin/contracts/utils/structs/BitMaps.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

import "../permissions/AccessManaged.sol";

contract AgentRegistryCore is
    AccessManagedUpgradeable,
    ERC721Upgradeable
{
    using BitMaps for BitMaps.BitMap;
    using Timers for Timers.Timestamp;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant AGENT_MANAGER_ROLE = keccak256("AGENT_MANAGER_ROLE");

    enum Slot {
        OWNER,
        ADMIN,
        length
    }

    struct AgentMetadata {
        uint256 version;
        string metadata;
        uint256[] chainIds;
    }

    mapping(uint256 => BitMaps.BitMap) private _disabled;
    mapping(uint256 => AgentMetadata) private _agentMetadata;
    mapping(bytes32 => Timers.Timestamp) private _frontrunProtection;

    event AgentCommitted(bytes32 indexed commit, uint64 deadline);
    event AgentUpdated(uint256 indexed agentId, uint256 version, string metadata, uint256[] chainIds);
    event AgentEnabled(uint256 indexed agentId, Slot slot, bool enabled);

    modifier onlyOwnerOf(uint256 agentId) {
        require(_msgSender() == ownerOf(agentId), "Restricted to agent owner");
        _;
    }

    modifier onlySorted(uint256[] memory array) {
        for (uint256 i = 1; i < array.length; ++i ) {
            require(array[i] > array[i-1], "Values must be sorted");
        }
        _;
    }

    function getAgent(uint256 agentId) public view returns (AgentMetadata memory) {
        return _agentMetadata[agentId];
    }

    function prepareAgent(bytes32 commit) public {
        uint64 deadline = uint64(block.timestamp + 5 minutes);

        require(_frontrunProtection[commit].isUnset(), "Agent already committed");
        _frontrunProtection[commit].setDeadline(deadline);
        emit AgentCommitted(commit, deadline);
    }

    function createAgent(uint256 agentId, address owner, string calldata metadata, uint256[] calldata chainIds) public onlySorted(chainIds) {
        bytes32 commit = keccak256(abi.encodePacked(agentId, owner, metadata, chainIds));
        require(_frontrunProtection[commit].isExpired(), "Agent commitment is not ready");

        _mint(owner, agentId);
        _setAgent(agentId, metadata, chainIds);
    }

    function updateAgent(uint256 agentId, string calldata metadata, uint256[] calldata chainIds) public onlySorted(chainIds) onlyOwnerOf(agentId) {
        _setAgent(agentId, metadata, chainIds);
    }

    function _setAgent(uint256 agentId, string memory newMetadata, uint256[] calldata newChainIds) internal {
        _beforeAgentUpdate(agentId, newMetadata, newChainIds);

        uint256 version = _agentMetadata[agentId].version + 1;
        _agentMetadata[agentId] = AgentMetadata({ version: version, metadata: newMetadata, chainIds: newChainIds });
        emit AgentUpdated(agentId, version, newMetadata, newChainIds);
    }

    /**
     * @dev Enable/Disable agent
     */
    function isEnabled(uint256 agentId) public view virtual returns (bool) {
        return _disabled[agentId]._data[0] == 0; // Slot.length < 256 → we don't have to loop
    }

    function enableAgent(uint256 agentId, Slot slot) public virtual onlyOwnerOf(agentId) {
        if (slot == Slot.OWNER) { require(_msgSender() == ownerOf(agentId)); }
        if (slot == Slot.ADMIN) { require(hasRole(AGENT_MANAGER_ROLE, _msgSender())); }
        _enable(agentId, slot, true);
    }

    function disableAgent(uint256 agentId, Slot slot) public virtual onlyOwnerOf(agentId) {
        if (slot == Slot.OWNER) { require(_msgSender() == ownerOf(agentId)); }
        if (slot == Slot.ADMIN) { require(hasRole(AGENT_MANAGER_ROLE, _msgSender())); }
        _enable(agentId, slot, false);
    }

    function _enable(uint256 agentId, Slot slot, bool enable) internal {
        _beforeAgentEnable(agentId, slot, enable);
        _disabled[agentId].setTo(uint8(slot), enable);
        emit AgentEnabled(agentId, slot, enable);
    }

    function _getDisableFlags(uint256 agentId) internal view returns (uint256) {
        return _disabled[agentId]._data[0];
    }

    /**
     * Hook: Agent metadata change (create/update)
     */
    function _beforeAgentUpdate(uint256 agentId, string memory newMetadata, uint256[] calldata newChainIds) internal virtual {}

    /**
     * Hook: Agent is enabled/disabled
     */
    function _beforeAgentEnable(uint256 agentId, Slot slot, bool enable) internal virtual {}
}
