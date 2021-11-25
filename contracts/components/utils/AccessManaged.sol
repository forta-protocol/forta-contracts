// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/IAccessControl.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "../Roles.sol";

abstract contract AccessManaged is Context {
    IAccessControl private _accessControl;

    event AccessManagerUpdated(address indexed newAddressManager);
    error MissingRole(bytes32 role, address account);

    modifier onlyRole(bytes32 role) {
        if (!hasRole(role, _msgSender())) {
            revert MissingRole(role, _msgSender());
        }
        _;
    }

    constructor(address manager) {
        _accessControl = IAccessControl(manager);
        emit AccessManagerUpdated(manager);
    }

    function hasRole(bytes32 role, address account) internal view returns (bool) {
        return _accessControl.hasRole(role, account);
    }

    function setAccessManager(address newManager) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _accessControl = IAccessControl(newManager);
        emit AccessManagerUpdated(newManager);
    }
}
