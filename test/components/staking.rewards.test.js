const { ethers, network } = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { prepare } = require('../fixture');
const { subjectToActive, subjectToInactive } = require('../../scripts/utils/staking.js');
const { signERC712ScannerRegistration } = require('../../scripts/utils/scannerRegistration');
const contractHelpers = require('../../scripts/utils/contractHelpers');

const subjects = [
    [ethers.BigNumber.from(ethers.utils.id('135a782d-c263-43bd-b70b-920873ed7e9d')), 1], // Agent id, agent type
    [ethers.BigNumber.from('1'), 2], // ScannerPool id, ScannerPool Type
    [ethers.BigNumber.from('2'), 2], // ScannerPool id, ScannerPool Type
];
const DELEGATOR_SUBJECT_TYPE = 3;

const ONE_DAY = 24 * 60 * 60;
const EPOCH_LENGTH = 7 * ONE_DAY;

const [
    [subject1, subjectType1, active1, inactive1],
    [SCANNER_POOL_ID, SCANNER_POOL_SUBJECT_TYPE, active2, inactive2],
    [SCANNER_POOL_ID_2, SCANNER_POOL_SUBJECT_TYPE_2, active3, inactive3],
] = subjects.map((items) => [items[0], items[1], subjectToActive(items[1], items[0]), subjectToInactive(items[1], items[0])]);

const MAX_STAKE = '10000';
const OFFSET = 4 * 24 * 60 * 60;

async function endCurrentEpoch() {
    const latestTimestamp = await helpers.time.latest();
    const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
    await helpers.time.increase(timeToNextEpoch);
}

let registration, signature, verifyingContractInfo;
describe('Staking Rewards', function () {
    prepare({
        stake: {
            agents: { min: '1', max: MAX_STAKE, activated: true },
            scanners: { min: '1', max: MAX_STAKE, activated: true },
        },
    });
    beforeEach(async function () {
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, ethers.utils.parseUnits('1000', 'wei'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user2.address, ethers.utils.parseUnits('1000', 'wei'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user3.address, ethers.utils.parseUnits('1000', 'wei'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.contracts.rewardsDistributor.address, ethers.utils.parseUnits('100000000', 'wei'), this.token.address);

        await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user2).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user3).approve(this.staking.address, ethers.constants.MaxUint256);

        const args = [subject1, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
        await this.agents.connect(this.accounts.other).createAgent(...args);
        await this.scannerPools.connect(this.accounts.user1).registerScannerPool(1);
        await this.scannerPools.connect(this.accounts.user2).registerScannerPool(2);

        this.accounts.getAccount('slasher');
        await this.access.connect(this.accounts.admin).grantRole(this.roles.SLASHER, this.accounts.slasher.address);

        this.accounts.getAccount('scanner');
        this.SCANNER_ID = this.accounts.scanner.address;
        const { chainId } = await ethers.provider.getNetwork();
        verifyingContractInfo = {
            address: this.contracts.scannerPools.address,
            chainId: chainId,
        };
        registration = {
            scanner: this.SCANNER_ID,
            scannerPoolId: 1,
            chainId: 1,
            metadata: 'metadata',
            timestamp: (await ethers.provider.getBlock('latest')).timestamp * 2, // avoiding expiration
        };
        signature = await signERC712ScannerRegistration(verifyingContractInfo, registration, this.accounts.scanner);
    });

    describe('Rewards tracking stake allocation', function () {
        beforeEach(async function () {
            const delay = await this.rewardsDistributor.delegationParamsEpochDelay();
            await this.rewardsDistributor.connect(this.accounts.admin).setDelegationParams(delay, 0);
        });

        it('should not allow rewarding twice', async function () {
            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();
            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);
            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2000', epoch);
            await expect(this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2000', epoch)).to.be.revertedWith(
                `AlreadyRewarded(${epoch})`
            );
        });

        it('should apply equal rewards with comission for stakes added at the same time', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '50');
            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('150');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            await this.staking.connect(this.accounts.user3).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2000', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('1000');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.closeTo('500', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user3.address)).to.be.closeTo('500', '1');

            const balanceBefore1 = await this.token.balanceOf(this.accounts.user1.address);
            const balanceBefore2 = await this.token.balanceOf(this.accounts.user2.address);

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);

            expect(await this.token.balanceOf(this.accounts.user1.address)).to.eq(balanceBefore1.add('1000'));
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.be.closeTo(balanceBefore2.add('500'), 1);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await expect(this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch])).to.be.revertedWith(
                'AlreadyClaimedByOwner()'
            );
            await expect(this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch])).to.be.revertedWith(
                'AlreadyClaimed()'
            );
        });

        it('should fail to reclaim for same pool and epoch even if pool ownership is transferred', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2000', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('2000');

            const balanceBefore1 = await this.token.balanceOf(this.accounts.user1.address);

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);

            expect(await this.token.balanceOf(this.accounts.user1.address)).to.eq(balanceBefore1.add('2000'));
            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');

            await expect(this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch])).to.be.revertedWith(
                'AlreadyClaimedByOwner()'
            );

            expect(await this.scannerPools.ownerOf(SCANNER_POOL_ID)).to.eq(this.accounts.user1.address);
            await this.scannerPools.connect(this.accounts.user1).transferFrom(this.accounts.user1.address, this.accounts.user2.address, SCANNER_POOL_ID);
            expect(await this.scannerPools.ownerOf(SCANNER_POOL_ID)).to.eq(this.accounts.user2.address);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await expect(this.rewardsDistributor.connect(this.accounts.user2).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch])).to.be.revertedWith(
                'AlreadyClaimedByOwner()'
            );

            const epochTwo = await this.rewardsDistributor.getCurrentEpochNumber();

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epochTwo, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epochTwo, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2000', epochTwo);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epochTwo, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epochTwo, this.accounts.user2.address)).to.be.equal('2000');
            await expect(this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epochTwo])).to.be.revertedWith(
                `SenderNotOwner("${this.accounts.user1.address}", ${SCANNER_POOL_ID})`
            );

            const balanceBefore2 = await this.token.balanceOf(this.accounts.user2.address);

            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epochTwo]);

            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(balanceBefore2.add('2000'));
            await expect(this.rewardsDistributor.connect(this.accounts.user2).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epochTwo])).to.be.revertedWith(
                'AlreadyClaimedByOwner()'
            );
        });

        it('should fail to reclaim if no rewards available', async function () {
            await expect(this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [1])).to.be.revertedWith(
                'ZeroAmount("epochRewards")'
            );
        });

        it('remove stake', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await this.staking.connect(this.accounts.user2).initiateWithdrawal(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1500', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.closeTo('1000', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.closeTo('500', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
        });

        it('slash stake', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await this.staking.connect(this.accounts.admin).setSlashDelegatorsPercent('20');
            await this.staking.connect(this.accounts.slasher).slash(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '20', ethers.constants.AddressZero, '0');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('180');
            expect(await this.stakeAllocator.allocatedStakeFor(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('84');
            expect(await this.stakeAllocator.allocatedStakeFor(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('96');

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1000', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.closeTo('484', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.closeTo('516', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
        });

        it('unallocate stake', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await this.stakeAllocator.connect(this.accounts.user1).unallocateDelegatorStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');
            expect(await this.stakeAllocator.allocatedStakeFor(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');
            expect(await this.stakeAllocator.allocatedStakeFor(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('0');

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1500', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.closeTo('1000', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.closeTo('500', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
        });

        it('allocate stake', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');
            await this.stakeAllocator.connect(this.accounts.user1).unallocateDelegatorStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');

            expect(await this.stakeAllocator.allocatedStakeFor(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');
            expect(await this.stakeAllocator.allocatedStakeFor(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('0');
            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await this.stakeAllocator.connect(this.accounts.user1).allocateDelegatorStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');
            expect(await this.stakeAllocator.allocatedStakeFor(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');
            expect(await this.stakeAllocator.allocatedStakeFor(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1500', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.closeTo('1000', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.closeTo('500', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
        });

        it('allocate stake ScannerPool', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');

            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');
            await this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '50');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('150');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await this.stakeAllocator.connect(this.accounts.user1).allocateOwnStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '50');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');
            expect(await this.stakeAllocator.allocatedStakeFor(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');
            expect(await this.stakeAllocator.allocatedStakeFor(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1000', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.closeTo('428', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.closeTo('571', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
        });

        it('share transfer ', async function () {
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');

            const latestTimestamp = await helpers.time.latest();
            const timeToNextEpoch = EPOCH_LENGTH - ((latestTimestamp - OFFSET) % EPOCH_LENGTH);
            await helpers.time.increase(Math.floor(timeToNextEpoch / 2));

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            const delegatorShares = subjectToActive(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID);
            await this.staking.connect(this.accounts.user2).safeTransferFrom(this.accounts.user2.address, this.accounts.user3.address, delegatorShares, '50', '0x');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');
            expect(await this.stakeAllocator.allocatedStakeFor(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');
            expect(await this.stakeAllocator.allocatedStakeFor(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('100');

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1000', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.closeTo('500', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.closeTo('375', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user3.address)).to.be.closeTo('125', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
        });

        it('use the current accumulated value in the first epoch and the initial rate in the second epoch', async function () {
            await endCurrentEpoch();
            const firstEpoch = await this.rewardsDistributor.getCurrentEpochNumber();

            // deposit on the fourth day: 100 tokens deposited for four days in the epoch (100 * 4 = 400)
            await helpers.time.increase(ONE_DAY * 3);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);

            // deposit on the seventh day: 400 tokens deposited for one day in the epoch (400 * 1 = 400)
            await helpers.time.increase(ONE_DAY * 3);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '400');

            await endCurrentEpoch();

            // deposit some more amounts to try to break the expected calculation
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await helpers.time.increase(ONE_DAY);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '200');

            // reward 1000
            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1000', firstEpoch);

            // the rewards should be 500 and equal because of the above `time × stake` logic in accumulation
            // 100 * 4 == 400 * 1
            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, firstEpoch, this.accounts.user1.address)).to.be.closeTo('500', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, firstEpoch, this.accounts.user2.address)).to.be.closeTo('500', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [firstEpoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [firstEpoch]);

            // note down the current epoch as the second one
            const secondEpoch = await this.rewardsDistributor.getCurrentEpochNumber();

            // deposit with a second delegator to try to break the distribution
            // it should not affect because only first epoch values should be used
            await this.staking.connect(this.accounts.user3).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '500');

            // end the current epoch
            await endCurrentEpoch();

            // reward 1000 again
            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1000', secondEpoch);

            // the rewards should not be equal this time but it should rely on first epoch's numbers
            // owner had 100, delegator had 400 so the 1000 should be distributed proportionally: 200 and 800
            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, secondEpoch, this.accounts.user1.address)).to.be.closeTo('200', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, secondEpoch, this.accounts.user2.address)).to.be.closeTo('800', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, secondEpoch, this.accounts.user3.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [secondEpoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [secondEpoch]);
        });

        it('pool owner only, first epoch', async function () {
            await endCurrentEpoch();
            const firstEpoch = await this.rewardsDistributor.getCurrentEpochNumber();

            // pool owner deposits in the middle of an epoch
            await helpers.time.increase(ONE_DAY * 3);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);

            await endCurrentEpoch();

            // reward 1000
            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1000', firstEpoch);

            // all should go to the pool owner
            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, firstEpoch, this.accounts.user1.address)).to.be.equal('1000');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [firstEpoch]);
        });

        it('pool owner and two delegators, first epoch', async function () {
            await endCurrentEpoch();
            const firstEpoch = await this.rewardsDistributor.getCurrentEpochNumber();

            // deposit on the fourth day: 100 tokens deposited for four days in the epoch (100 * 4 = 400)
            await helpers.time.increase(ONE_DAY * 3);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);

            // deposit on the seventh day: 400 tokens deposited for one day in the epoch (400 * 1 = 400)
            await helpers.time.increase(ONE_DAY * 3);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '200');
            await this.staking.connect(this.accounts.user3).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '200');

            await endCurrentEpoch();

            // deposit some more amounts to try to break the expected calculation
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await helpers.time.increase(ONE_DAY);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '200');

            // reward 1000
            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '1000', firstEpoch);

            // the rewards should be 500, 250 and 250 respectively because of
            // the accumulated stake in the first epoch
            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, firstEpoch, this.accounts.user1.address)).to.be.closeTo('500', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, firstEpoch, this.accounts.user2.address)).to.be.closeTo('250', '1');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, firstEpoch, this.accounts.user3.address)).to.be.closeTo('250', '1');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [firstEpoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [firstEpoch]);
            await this.rewardsDistributor.connect(this.accounts.user3).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [firstEpoch]);
        });

        it('should be able to set delegationParamsEpochDelay', async function () {
            // Was initialized with a value of 2
            const previousDelay = await this.rewardsDistributor.delegationParamsEpochDelay();

            const newDelay = 3;
            await this.rewardsDistributor.connect(this.accounts.admin).setDelegationParams(newDelay, 0);

            expect(await this.rewardsDistributor.delegationParamsEpochDelay()).to.not.be.equal(previousDelay);
            expect(await this.rewardsDistributor.delegationParamsEpochDelay()).to.be.equal(newDelay);
        });

        it('should be able to set defaultFeeBps, and set again to same value, but update delegationParamsEpochDelay', async function () {
            // Was initialized with a value of 1000
            const previousFeeBps = await this.rewardsDistributor.defaultFeeBps();
            // Was initialized with a value of 2
            const previousDelay = await this.rewardsDistributor.delegationParamsEpochDelay();

            console.log(`previousFeeBps: ${previousFeeBps}`);

            const newFeeBps = 10000;
            await this.rewardsDistributor.connect(this.accounts.admin).setDelegationParams(previousDelay, newFeeBps);

            expect(await this.rewardsDistributor.defaultFeeBps()).to.not.be.equal(previousFeeBps);
            expect(await this.rewardsDistributor.defaultFeeBps()).to.be.equal(newFeeBps);
            expect(await this.rewardsDistributor.delegationParamsEpochDelay()).to.be.equal(previousDelay);

            const newDelay = 1;

            await expect(this.rewardsDistributor.connect(this.accounts.admin).setDelegationParams(newDelay, newFeeBps))
                .to.emit(this.rewardsDistributor, 'SetDelegationParams')
                .withArgs(newDelay, newFeeBps);

            expect(await this.rewardsDistributor.defaultFeeBps()).to.be.equal(newFeeBps);
            expect(await this.rewardsDistributor.delegationParamsEpochDelay()).to.not.be.equal(previousDelay);
            expect(await this.rewardsDistributor.delegationParamsEpochDelay()).to.be.equal(newDelay);
        });
    });

    describe('Fee setting', function () {
        it('fee', async function () {
            await this.rewardsDistributor.connect(this.accounts.user1).setDelegationFeeBps(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2500');

            await helpers.time.increase(2 * (1 + EPOCH_LENGTH) /* 2 week */);
            const registration = {
                scanner: this.SCANNER_ID,
                scannerPoolId: 1,
                chainId: 1,
                metadata: 'metadata',
                timestamp: (await ethers.provider.getBlock('latest')).timestamp,
            };
            const signature = await signERC712ScannerRegistration(verifyingContractInfo, registration, this.accounts.scanner);
            // disable automine so deposits are instantaneous to simplify math
            await network.provider.send('evm_setAutomine', [false]);
            await this.staking.connect(this.accounts.user1).deposit(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '100');
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            await this.staking.connect(this.accounts.user2).deposit(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, '100');

            await network.provider.send('evm_setAutomine', [true]);
            await network.provider.send('evm_mine');

            expect(await this.stakeAllocator.allocatedManagedStake(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID)).to.be.equal('200');

            const epoch = await this.rewardsDistributor.getCurrentEpochNumber();

            await helpers.time.increase(1 + EPOCH_LENGTH /* 1 week */);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('0');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('0');

            await this.rewardsDistributor.connect(this.accounts.manager).reward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2000', epoch);

            expect(await this.rewardsDistributor.availableReward(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user1.address)).to.be.equal('1250');
            expect(await this.rewardsDistributor.availableReward(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, epoch, this.accounts.user2.address)).to.be.equal('750');

            await this.rewardsDistributor.connect(this.accounts.user1).claimRewards(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
            await this.rewardsDistributor.connect(this.accounts.user2).claimRewards(DELEGATOR_SUBJECT_TYPE, SCANNER_POOL_ID, [epoch]);
        });

        it('fee can be set to zero', async function () {
            await this.rewardsDistributor.connect(this.accounts.user2).setDelegationFeeBps(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID_2, '0');

            // fee not in effect yet - should return the default for the current epoch
            const defaultFeeBps = await this.rewardsDistributor.defaultFeeBps();
            const currentEpoch = await this.rewardsDistributor.getCurrentEpochNumber();
            expect(await this.rewardsDistributor.getDelegationFee(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID_2, currentEpoch)).to.be.equal(defaultFeeBps);

            await helpers.time.increase(2 * (1 + EPOCH_LENGTH) /* 2 weeks */);

            // fee is now in effect as zero
            const nextEpoch = await this.rewardsDistributor.getCurrentEpochNumber();
            expect(await this.rewardsDistributor.getDelegationFee(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID_2, nextEpoch)).to.be.equal('0');
        });

        it('fee can only be set by the owner of the pool', async function () {
            await expect(this.rewardsDistributor.connect(this.accounts.user2).setDelegationFeeBps(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2500')).to.be.revertedWith(
                `SenderNotOwner("${this.accounts.user2.address}", ${SCANNER_POOL_ID})`
            );
        });

        it('fee is in effect two periods after setting', async function () {
            const defaultRate = await this.rewardsDistributor.defaultFeeBps();
            let currentEpoch = await this.rewardsDistributor.getCurrentEpochNumber();
            await this.rewardsDistributor.connect(this.accounts.user1).setDelegationFeeBps(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2500');
            // fee still not in effect
            expect(await this.rewardsDistributor.getDelegationFee(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, currentEpoch)).to.be.eq(defaultRate);

            await helpers.time.increase(2 * (1 + EPOCH_LENGTH) /* 2 weeks */);

            currentEpoch = await this.rewardsDistributor.getCurrentEpochNumber();
            expect(await this.rewardsDistributor.getDelegationFee(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, currentEpoch)).to.be.eq('2500');

            await helpers.time.increase(2 * (1 + EPOCH_LENGTH) /* 2 weeks */);
            await this.rewardsDistributor.connect(this.accounts.user1).setDelegationFeeBps(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '3000');
            currentEpoch = await this.rewardsDistributor.getCurrentEpochNumber();
            expect(await this.rewardsDistributor.getDelegationFee(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, currentEpoch)).to.be.eq('2500');

            await helpers.time.increase(2 * (1 + EPOCH_LENGTH) /* 2 weeks */);

            currentEpoch = await this.rewardsDistributor.getCurrentEpochNumber();
            expect(await this.rewardsDistributor.getDelegationFee(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, currentEpoch)).to.be.eq('3000');
        });

        it('there is a cooldown period for fees', async function () {
            await this.rewardsDistributor.connect(this.accounts.user1).setDelegationFeeBps(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '2500');
            await expect(this.rewardsDistributor.connect(this.accounts.user1).setDelegationFeeBps(SCANNER_POOL_SUBJECT_TYPE, SCANNER_POOL_ID, '3000')).to.be.revertedWith(
                'SetDelegationFeeNotReady()'
            );
        });
    });
});
