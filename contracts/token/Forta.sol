// SPDX-License-Identifier: UNLICENSED
// See Forta Network License: https://github.com/forta-network/forta-contracts/blob/master/LICENSE.md

pragma solidity ^0.8.9;

import "./FortaCommon.sol";

/**
 * This version of the Forta token is living on the root (or parent) chain. That would be:
 * - Mainnet for production
 * - Sepolia for testing
 */
contract Forta is FortaCommon {
    uint256 public constant SUPPLY = 1000000000e18;

    /**
     * @notice Initializer method, access point to initialize inheritance tree.
     * @param admin address for the ADMIN_ROLE of the token.
     */
    function initialize(address admin) public initializer {
        __FortaCommon_init(admin);
    }

    /**
     * @notice Contract version
     * @dev Since FortaCommon is IVersioned, Forta is deployed in L1 and FortaBridgedPolygon in L2,
     * we need to implement the interface with a method instead of immutable variable.
     * @return version of FORT deployed in L1
     */
    function version() external pure virtual override returns(string memory) {
        return "0.2.1";
    }

    uint256[50] private __gap; 
}
