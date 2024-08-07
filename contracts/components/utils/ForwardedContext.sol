// SPDX-License-Identifier: UNLICENSED
// See Forta Network License: https://github.com/forta-network/forta-contracts/blob/master/LICENSE.md

pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";

abstract contract ForwardedContext is ContextUpgradeable {

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _trustedForwarder;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address trustedForwarder) {
        // WARNING: do not set this address to other than a deployed Forwarder instance.
        // Forwarder is critical infrastructure with privileged address, it is safe for the limited
        // functionality of the Forwarder contract, any other EOA or contract could be a security issue.
        _trustedForwarder = trustedForwarder;
    }

    /**
     * @notice Gets sender of the transaction.
     * @return sender address of sender of the transaction of signer if meta transaction.
     */
    function _msgSender() internal view virtual override returns (address sender) {
        return super._msgSender();
    }

    /**
     * @notice Gets msg.data of the transaction.
     * @return msg.data of the transaction of msg.data.
     */
    function _msgData() internal view virtual override returns (bytes calldata) {
        return super._msgData();
    }
}
