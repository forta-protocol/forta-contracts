// SPDX-License-Identifier: UNLICENSED
// See Forta Network License: https://github.com/forta-protocol/forta-contracts/blob/master/LICENSE.md

pragma solidity ^0.8.9;

import "../stake_subjects/StakeSubjectGateway.sol";
import "../FortaStakingUtils.sol";
import "../../../tools/Distributions.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Timers.sol";
import "./Accumulators.sol";
import "./IRewardsDistributor.sol";

uint256 constant MAX_BPS = 10000;

contract RewardsDistributor is BaseComponentUpgradeable, SubjectTypeValidator, IRewardsDistributor {
    
    using Timers for Timers.Timestamp;
    using Accumulators for Accumulators.Accumulator;
    using Distributions for Distributions.Balances;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    IERC20 public immutable rewardsToken;

    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    StakeSubjectGateway private immutable _subjectGateway;

    string public constant version = "0.1.0";
    uint256 public constant DEFAULT_FEE_BPS = 0 ;// 5;

    struct DelegatedAccStake {
        Accumulators.Accumulator delegated;
        Accumulators.Accumulator delegators;
        Accumulators.Accumulator delegatorsTotal;
        mapping(address => Accumulators.Accumulator) delegatorsPortions;
    }
    // delegated share id => DelegatedAccStake
    mapping(uint256 => DelegatedAccStake) private _accStakes;
    // share => epoch => amount
    mapping (uint256 => mapping(uint256 => uint256)) private _rewardsPerEpoch;
    // share => epoch => address => claimed
    mapping (uint256 => mapping(uint256 => mapping(address => bool))) private _claimedRewardsPerEpoch;

    // share => epoch => uint256
    mapping (uint256 => mapping (uint256 => uint256)) public feeBpsPerEpoch;

    // TODO
    // mapping(uint256 => Timers.Timestamp) private _delegationParamsTimers;
    uint64 public delegationParamsDelay;

    event Rewarded(uint8 indexed subjectType, uint256 indexed subject, uint32 blockNumber, uint256 value);
    //event ClaimedRewards(uint8 indexed subjectType, uint256 indexed subject, address indexed to, uint256 value);
    event DelegationParamsDelaySet(uint64 delay);

    error RewardingNonRegisteredSubject(uint8 subjectType, uint256 subject);
    error AlreadyClaimed();
    error SetFeeNotReady();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(
        address _forwarder,
        address _rewardsToken,
        address __subjectGateway
    ) initializer ForwardedContext(_forwarder) {
        if (_rewardsToken == address(0)) revert ZeroAddress("_rewardsToken");
        if (__subjectGateway == address(0)) revert ZeroAddress("__subjectGateway");
        rewardsToken = IERC20(_rewardsToken);
        _subjectGateway = StakeSubjectGateway(__subjectGateway);
    }

    function initialize(address _manager, uint64 _delegationParamsDelay) public initializer {
        __BaseComponentUpgradeable_init(_manager);

        if (_delegationParamsDelay == 0) revert ZeroAmount("_delegationParamsDelay");
        delegationParamsDelay = _delegationParamsDelay;
        emit DelegationParamsDelaySet(_delegationParamsDelay);
    }

    function didAddStake(
        uint8 subjectType,
        uint256 subject,
        uint256 stakeAmount,
        uint256 sharesAmount,
        address staker
    ) onlyRole(ALLOCATOR_CONTRACT_ROLE) external {
        // TODO: set default fee
        bool delegated = getSubjectTypeAgency(subjectType) == SubjectStakeAgency.DELEGATED;
        if (delegated) {
            uint256 shareId = FortaStakingUtils.subjectToActive(subjectType, subject);
            DelegatedAccStake storage s = _accStakes[shareId];
            s.delegated.addRate(stakeAmount);
        } else {
            uint8 delegatedType = getDelegatedSubjectType(subjectType);
            uint256 shareId = FortaStakingUtils.subjectToActive(delegatedType, subject);
            DelegatedAccStake storage s = _accStakes[shareId];
            s.delegators.addRate(stakeAmount);

            s.delegatorsTotal.addRate(sharesAmount);
            s.delegatorsPortions[staker].addRate(sharesAmount);
        }
    }

    function didRemoveStake(
        uint8 subjectType,
        uint256 subject,
        uint256 stakeAmount,
        uint256 sharesAmount,
        address staker
    ) onlyRole(ALLOCATOR_CONTRACT_ROLE) external {
        bool delegated = getSubjectTypeAgency(subjectType) == SubjectStakeAgency.DELEGATED;
        if (delegated) {
            uint256 shareId = FortaStakingUtils.subjectToActive(subjectType, subject);
            DelegatedAccStake storage s = _accStakes[shareId];
            s.delegated.subRate(stakeAmount);
        } else {
            uint8 delegatedType = getDelegatedSubjectType(subjectType);
            uint256 shareId = FortaStakingUtils.subjectToActive(delegatedType, subject);
            DelegatedAccStake storage s = _accStakes[shareId];
            s.delegators.subRate(stakeAmount);

            if (staker != address(0)) {
                s.delegatorsTotal.subRate(sharesAmount);
                s.delegatorsPortions[staker].subRate(sharesAmount);
            }
        }
    }

    function reward(uint8 subjectType, uint256 subjectId, uint256 amount, uint256 epochNumber) onlyRole(REWARDER_ROLE) external {
        if (subjectType != NODE_RUNNER_SUBJECT) revert InvalidSubjectType(subjectType);
        if (!_subjectGateway.isRegistered(subjectType, subjectId)) revert RewardingNonRegisteredSubject(subjectType, subjectId);
        uint256 shareId = FortaStakingUtils.subjectToActive(subjectType, subjectId);
        _rewardsPerEpoch[shareId][epochNumber] = amount;
    }

    function availableReward(uint8 subjectType, uint256 subjectId, uint256 epochNumber, address staker) public view returns (uint256) {
        // TODO: if subjectType is node runner, check staker is owner of nft

        bool delegator = getSubjectTypeAgency(subjectType) == SubjectStakeAgency.DELEGATOR;

        uint256 shareId = delegator
            ? FortaStakingUtils.subjectToActive(getDelegatedSubjectType(subjectType), subjectId)
            : FortaStakingUtils.subjectToActive(subjectType, subjectId);

        return _availableReward(shareId, delegator, epochNumber, staker);
    }

    function _availableReward(uint256 shareId, bool delegator, uint256 epochNumber, address staker) internal view returns (uint256) {
        if (_claimedRewardsPerEpoch[shareId][epochNumber][staker]) {
            return 0;
        }

        DelegatedAccStake storage s = _accStakes[shareId];

        uint256 N = s.delegated.getValueAtEpoch(epochNumber);
        uint256 D = s.delegators.getValueAtEpoch(epochNumber);
        uint256 T = N + D;

        if (T == 0) {
            return 0;
        }

        uint256 feeBps = feeBpsPerEpoch[shareId][epochNumber];

        uint256 R = _rewardsPerEpoch[shareId][epochNumber];
        uint256 RD = Math.mulDiv(R, D, T);
        uint256 fee = RD * feeBps / MAX_BPS; // mulDiv not necessary - feeBps is small

        if (delegator) {
            uint256 r = RD - fee;
            uint256 d = s.delegatorsPortions[staker].getValueAtEpoch(epochNumber);
            uint256 DT = s.delegatorsTotal.getValueAtEpoch(epochNumber);
            return Math.mulDiv(r, d, DT);
        } else {
            uint256 RN = Math.mulDiv(R, N, T);
            return RN + fee;
        }
    }

    // TODO: accept an array of multiple epochs to claim
    function claimRewards(uint8 subjectType, uint256 subjectId, uint256 epochNumber) external {
        uint256 shareId;
        if (subjectType == NODE_RUNNER_SUBJECT) {
            shareId = FortaStakingUtils.subjectToActive(subjectType, subjectId); } else if (subjectType ==  DELEGATOR_NODE_RUNNER_SUBJECT) {
            shareId = FortaStakingUtils.subjectToActive(getDelegatedSubjectType(subjectType), subjectId);
        }
        if (_claimedRewardsPerEpoch[shareId][epochNumber][_msgSender()]) revert AlreadyClaimed();
        _claimedRewardsPerEpoch[shareId][epochNumber][_msgSender()] = true;
        uint256 epochRewards = availableReward(subjectType, subjectId, epochNumber, _msgSender());
        SafeERC20.safeTransfer(rewardsToken, _msgSender(), epochRewards);
    }

    function setFeeBps(
        uint8 subjectType,
        uint256 subject,
        uint256 feeBps
    ) external onlyAgencyType(subjectType, SubjectStakeAgency.DELEGATED) {
        if (_subjectGateway.ownerOf(subjectType, subject) != _msgSender()) revert SenderNotOwner(_msgSender(), subject);

        uint256 shareId = FortaStakingUtils.subjectToActive(subjectType, subject);

        // TODO
        // Timers.Timestamp storage timer = _delegationParamsTimers[shareId];
        // if (!timer.isExpired()) revert SetComissionNotReady();

        // TODO: getEpochNumberForTimestamp(block.timestamp + 1.5 weeks) ??
        feeBpsPerEpoch[shareId][getEpochNumber() + 1] = feeBps;

        // TODO
        // uint64 deadline = SafeCast.toUint64(block.timestamp) + delegationParamsDelay;
        // timer.setDeadline(deadline);
    }

    function setDelegationsParamDelay(uint64 newDelay) external onlyRole(STAKING_ADMIN_ROLE) {
        if (newDelay == 0) revert ZeroAmount("newDelay");
        delegationParamsDelay = newDelay;
        emit DelegationParamsDelaySet(newDelay);
    }

    function getEpochNumber() public view returns(uint256) {
        return Accumulators.getEpochNumber();
    }

    // TODO: function sweep
}
