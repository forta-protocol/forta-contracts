// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../staking/IMinimumStakeController.sol";
import "../staking/FortaStakingSubjectTypes.sol";
import "../Roles.sol";
import "./AccessManaged.sol";

abstract contract MinStakeAwareUpgradeable is AccessManagedUpgradeable {
    IMinimumStakeController private _minStakeController;

    event MinimumStakeControllerUpdated(address indexed newMinStakeController);

    function __MinStakeAwareUpgradeable_init(address minStakeController) internal initializer {
        _setMinStakeController(minStakeController);
    }

    function _setMinStakeController(address minStakeController) private {
        require(minStakeController != address(0), "MinStakeAwareUpgradeable: minStakeController cannot be address(0)");
        _minStakeController = IMinimumStakeController(minStakeController);
        emit MinimumStakeControllerUpdated(minStakeController);
    }

    function setMinStakeController(address minStakeController) public onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMinStakeController(minStakeController);
    }

    function _isStakedOverMinimum(uint8 subjectType, uint256 subject) internal view returns(bool) {
        return _minStakeController.isStakedOverMinimum(subjectType, subject);
    }

    function _getMinStake(uint8 subjectType) internal view returns (uint256) {
        return _minStakeController.getMinStake(subjectType);
    }

    uint256[49] private __gap;
}
