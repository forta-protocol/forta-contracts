import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import {SetDelegationFee as SetDelegationFeeEvent, Rewarded as RewardedDistributedEvent, RewardsDistributor as RewardsDistributorContract } from "../../generated/RewardsDistributor/RewardsDistributor";
import { ScannerPool, Subject, RewardEvent, Staker } from "../../generated/schema";
import { formatSubjectId } from "./utils";
import { events, transactions } from "@amxx/graphprotocol-utils";



function updateScannerPoolComission(subjectId: string, subjectType: i32, fee: BigInt, epochNumber: BigInt): void {
  // If subject type is node pool
  if(subjectType === 2) {
    const scannerPool = ScannerPool.load(subjectId);
    if(scannerPool) {
      scannerPool.oldCommission = scannerPool.commission;
      scannerPool.commission = BigDecimal.fromString(fee.toString());
      scannerPool.commissionSinceEpoch = epochNumber.toI32();
      scannerPool.save();
    }
  }
}

const calculatePoolAPYInEpoch = (rewardsDistributorAddress: Address,subjectId: string, subjectType: number, epoch: BigInt): string | null => {

  // If not a node pool
  if(subjectType !== 2) return null

  const nodePool = ScannerPool.load(subjectId);

  if(!nodePool || !nodePool.stakers) return null

  log.warning(`Finding delegators for nodePool {}`,[subjectId])
  // Find all delegators in pool
  const delegatedStakers: Staker[] = nodePool.stakers
    .map(stakerId => Staker.load(stakerId))
    .filter(staker => staker !== null && (staker.account !== nodePool.owner)) as Staker[]
  
  log.warning(`Found {} delegators for nodePool {}`,[delegatedStakers.length.toString(),subjectId])

  const rewardDistributor = RewardsDistributorContract.bind(rewardsDistributorAddress);

  // Check avalible rewards for thesse delegators at given epoch and sum them
  const totalDelegateRewardByStaker = delegatedStakers
    .map(staker => rewardDistributor.availableReward(subjectType, BigInt.fromString(subjectId), epoch ,Address.fromString(staker.account)))

  // Calculate totalDelegateRewards for current epoch
  const totalDelegateRewards = totalDelegateRewardByStaker.reduce((sum: BigInt, curVal) => sum.plus(curVal), BigInt.fromI32(0))

  log.warning(`Found {} delegator FORT rewards`,[totalDelegateRewards.toString()])

  // Calculate APY as string
  const totalDelegateStakeInEpoch = nodePool.stakeAllocated.minus(nodePool.stakeOwnedAllocated);

  log.warning(`Found {} delegator stake in this epoch `,[totalDelegateStakeInEpoch.toString()])

  const apy = (1 + (totalDelegateRewards.div(totalDelegateStakeInEpoch)).toI32()) ** (52 - 1);

  return apy.toString()
}


export function handleSetDelegationFee(event: SetDelegationFeeEvent): void {
  const subjectId = formatSubjectId(event.params.subject, event.params.subjectType);
  const subjectType = event.params.subjectType;
  const epochNumber = event.params.epochNumber;
  updateScannerPoolComission(subjectId, subjectType ,event.params.feeBps, epochNumber);
}

// Handler for when unclaimed rewards are distributed
export function handleRewardEvent(event: RewardedDistributedEvent): void {
  const subjectId = formatSubjectId(event.params.subject, event.params.subjectType);
  const subjectType = event.params.subjectType;
  const epochNumber = event.params.epochNumber;
  const amount = event.params.amount;
  const rewardDistributorAddress = event.address;

  const subject = Subject.load(subjectId);

  if(subject) {
    const apy = calculatePoolAPYInEpoch(rewardDistributorAddress, subjectId, subjectType, epochNumber)
    const rewardedEvent = new RewardEvent(events.id(event));
    rewardedEvent.subject = subjectId;
    rewardedEvent.amount = amount;
    rewardedEvent.epochNumber = epochNumber.toI32();
    rewardedEvent.transaction = transactions.log(event).id;
    rewardedEvent.timestamp = event.block.timestamp;
    rewardedEvent.apyForLastEpoch = apy;

    rewardedEvent.save();
  } else {
    log.warning(`Failed to save reward event because could not find subject type from transaction {}`, [event.transaction.hash.toHexString()])
  }
}