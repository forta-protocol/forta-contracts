// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../BaseComponentUpgradeable.sol";

/**
 * Contract that will trigger software autoupdate of the Scanner Node software.
 * Forta Governance, through SCANNER_VERSION_ROLE, will propose and approve updates and
 * the nodes will listen to the resulting event, downloading the new version from IPFS
 */
contract ScannerNodeVersion is BaseComponentUpgradeable {

    /**
     * Version of the scanner image software the network expects (IPFS hash)
     * Starts empty
     */
    string public scannerNodeVersion;

    event ScannerNodeVersionUpdated(string newVersion, string oldVersion);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address forwarder) initializer ForwardedContext(forwarder) {}

    function initialize(
        address __manager,
        address __router
    ) public initializer {
        __AccessManaged_init(__manager);
        __Routed_init(__router);
        __UUPSUpgradeable_init();
        
    }

    function setScannerNodeVersion(string calldata version) public onlyRole(SCANNER_VERSION_ROLE) {
        require(
            keccak256(abi.encodePacked(scannerNodeVersion)) != keccak256(abi.encodePacked(version)),
            "must update to different scannerNodeVersion"
        );
        emit ScannerNodeVersionUpdated(version, scannerNodeVersion);
        scannerNodeVersion = version;
    }

    uint256[49] private __gap;
}
