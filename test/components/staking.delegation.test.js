const { ethers, network } = require('hardhat');
const { expect } = require('chai');
const { prepare } = require('../fixture');
const { subjectToActive, subjectToInactive } = require('../../scripts/utils/staking.js');
const { signERC712ScannerRegistration } = require('../../scripts/utils/scannerRegistration');
const contractHelpers = require('../../scripts/utils/contractHelpers');

const subjects = [
    [ethers.BigNumber.from('1'), 2],
    [ethers.BigNumber.from('1'), 3],
    [ethers.BigNumber.from('2'), 2],
    [ethers.BigNumber.from('2'), 3],
];
const [[scannerPoolId, scannerPoolSubjectType, scannerPoolActive, scannerPoolInactive], [_, delegatorSubjectType, delegatorActive, delegatorInactive]] = subjects.map((items) => [
    items[0],
    items[1],
    subjectToActive(items[1], items[0]),
    subjectToInactive(items[1], items[0]),
]);
const txTimestamp = (tx) =>
    tx
        .wait()
        .then(({ blockNumber }) => ethers.provider.getBlock(blockNumber))
        .then(({ timestamp }) => timestamp);

const MAX_STAKE_MANAGED = '1000';
const MIN_STAKE_MANAGED = '100';

const STAKE = '10000';
const chainId = 1;
let SCANNERS;
let initiallyAllocated;
describe('Staking - Delegation', function () {
    prepare({
        stake: {
            scanners: { min: MIN_STAKE_MANAGED, max: MAX_STAKE_MANAGED, activated: true },
        },
    });

    beforeEach(async function () {
        SCANNERS = [this.accounts.other, this.accounts.minter, this.accounts.treasure];
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, ethers.utils.parseEther('1000'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user2.address, ethers.utils.parseEther('1000'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user3.address, ethers.utils.parseEther('1000'), this.token.address);

        await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user2).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user3).approve(this.staking.address, ethers.constants.MaxUint256);

        await this.scannerPools.connect(this.accounts.user1).registerScannerPool(chainId);
        expect(await this.scannerPools.ownerOf('1')).to.eq(this.accounts.user1.address);
        const network = await ethers.provider.getNetwork();
        initiallyAllocated = MIN_STAKE_MANAGED * SCANNERS.length;
        await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, initiallyAllocated);
        const verifyingContractInfo = {
            address: this.scannerPools.address,
            chainId: network.chainId,
        };
        for (const scanner of SCANNERS) {
            expect(await this.scannerPools.willNewScannerShutdownPool(scannerPoolId)).to.eq(false);
            const registration = {
                scanner: scanner.address,
                scannerPoolId: 1,
                chainId: chainId,
                metadata: 'metadata',
                timestamp: (await ethers.provider.getBlock('latest')).timestamp,
            };
            const signature = await signERC712ScannerRegistration(verifyingContractInfo, registration, scanner);
            await this.scannerPools.connect(this.accounts.user1).registerScannerNode(registration, signature);
            expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
        }
        expect(await this.scannerPools.willNewScannerShutdownPool(scannerPoolId)).to.eq(true);
    });

    describe('Subject Agency', function () {
        it('should know agency for subject types', async function () {
            expect(await this.staking.getSubjectTypeAgency(this.stakingSubjects.SCANNER)).to.eq(this.subjectAgency.MANAGED);
            expect(await this.staking.getSubjectTypeAgency(this.stakingSubjects.AGENT)).to.eq(this.subjectAgency.DIRECT);
            expect(await this.staking.getSubjectTypeAgency(this.stakingSubjects.SCANNER_POOL)).to.eq(this.subjectAgency.DELEGATED);
            expect(await this.staking.getSubjectTypeAgency(this.stakingSubjects.UNDEFINED)).to.eq(this.subjectAgency.UNDEFINED);
            expect(await this.staking.getSubjectTypeAgency(123)).to.eq(this.subjectAgency.UNDEFINED);
        });
    });

    describe('Allocation', function () {
        describe('On Deposit', function () {
            it('should allocate between all managed subjects', async function () {
                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, '100'))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '100', 100 + initiallyAllocated);

                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(100 + initiallyAllocated);
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(100 + initiallyAllocated);
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');

                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('133');
                expect(133).to.be.gt((await this.scannerPools.getManagedStakeThreshold(1)).min);
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
            });

            it('delegating over max goes to unallocated', async function () {
                const maxAllocated = MAX_STAKE_MANAGED * 3;
                const staked = maxAllocated - initiallyAllocated;
                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, staked, maxAllocated);

                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(maxAllocated);
                expect(await this.staking.activeStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(maxAllocated);
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.allocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.unallocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq(MAX_STAKE_MANAGED);
                expect(await this.stakeAllocator.allocatedOwnStakePerManaged(2, 1)).to.eq(MAX_STAKE_MANAGED);
                expect(await this.stakeAllocator.allocatedDelegatorsStakePerManaged(2, 1)).to.eq('0');

                await expect(this.staking.connect(this.accounts.user1).deposit(delegatorSubjectType, scannerPoolId, '200'))
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(delegatorSubjectType, scannerPoolId, true, '200', '200');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(maxAllocated);
                expect(await this.staking.activeStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('200');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(maxAllocated);
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.allocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.unallocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('200');
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq(MAX_STAKE_MANAGED);
                expect(await this.stakeAllocator.allocatedOwnStakePerManaged(2, 1)).to.eq(MAX_STAKE_MANAGED);
                expect(await this.stakeAllocator.allocatedDelegatorsStakePerManaged(2, 1)).to.eq('0');
            });

            it('allocation should be sensitive to managed subject disabling', async function () {
                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, '200'))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '200', initiallyAllocated + 200);
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(initiallyAllocated + 200);
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(initiallyAllocated + 200);
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('166');
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
                await this.scannerPools.connect(this.accounts.user1).disableScanner(SCANNERS[0].address);
                for (const scanner of SCANNERS) {
                    if (scanner === SCANNERS[0]) {
                        expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(false);
                    } else {
                        expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                    }
                }
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('250');
                await this.scannerPools.connect(this.accounts.user1).enableScanner(SCANNERS[0].address);
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('166');
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
            });

            it('allocation should be sensitive to managed subject disabling - with delegation', async function () {
                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, '200'))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '200', initiallyAllocated + 200);
                expect(await this.subjectGateway.minManagedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('100');
                expect(await this.subjectGateway.totalManagedSubjects(scannerPoolSubjectType, scannerPoolId)).to.eq('3');

                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('166');
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
                await this.scannerPools.connect(this.accounts.user1).disableScanner(SCANNERS[0].address);
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('250');
                for (const scanner of SCANNERS) {
                    if (scanner === SCANNERS[0]) {
                        expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(false);
                    } else {
                        expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                    }
                }
                await expect(this.staking.connect(this.accounts.user1).deposit(delegatorSubjectType, scannerPoolId, '100'))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(delegatorSubjectType, scannerPoolId, true, '100', '100');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(initiallyAllocated + 200);
                expect(await this.staking.activeStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('100');

                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq(initiallyAllocated + 200);
                expect(await this.stakeAllocator.allocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('100');
                expect(await this.stakeAllocator.allocatedManagedStake(scannerPoolSubjectType, scannerPoolId)).to.eq(initiallyAllocated + 300);

                await this.scannerPools.connect(this.accounts.user1).enableScanner(SCANNERS[0].address);
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('200');
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
            });

            it('active stake = allocated + unallocated', async function () {
                const expectedStake = Number(STAKE);
                const staked = expectedStake - initiallyAllocated;
                const maxAllocated = Number(MAX_STAKE_MANAGED) * SCANNERS.length;
                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked))
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address, staked)
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, maxAllocated, maxAllocated)
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, `${expectedStake - maxAllocated}`, `${expectedStake - maxAllocated}`);
                const active = await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId);
                expect(active).to.eq(expectedStake);

                const allocated = await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId);
                expect(allocated).to.eq(`${maxAllocated}`);
                const unallocated = await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId);
                const expectedUnallocated = expectedStake - maxAllocated;
                expect(unallocated).to.eq(`${expectedUnallocated}`);
                expect(allocated.add(unallocated)).to.eq(active);
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq(MAX_STAKE_MANAGED);
            });

            it('scanners should be disabled if scanner threshold rises over current stake', async function () {
                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, STAKE))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, `${Number(MAX_STAKE_MANAGED) * 3}`, `${Number(MAX_STAKE_MANAGED) * 3}`)
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address, STAKE);
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
                const newMin = `${Number(MAX_STAKE_MANAGED) + 1}`;
                await this.scannerPools.connect(this.accounts.manager).setManagedStakeThreshold({ max: STAKE, min: newMin, activated: true }, 1);
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(false);
                }
            });

            it('should not allow delegation if DELEGATE delegation under min', async function () {
                const staked = '2000';
                await this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, 200);
                await expect(this.staking.connect(this.accounts.user2).deposit(delegatorSubjectType, scannerPoolId, staked)).to.be.revertedWith(
                    'CannotDelegateStakeUnderMin(2, 1)'
                );
            });

            it('should not deposit if not owner of delegated/manager subject', async function () {
                const staked = '2000';
                await expect(this.staking.connect(this.accounts.user2).deposit(scannerPoolSubjectType, scannerPoolId, staked)).to.be.revertedWith(
                    `SenderCannotAllocateFor(${scannerPoolSubjectType}, ${scannerPoolId})`
                );
            });
        });

        describe('Unallocation and Manual Allocation', function () {
            it('should unallocate allocated stake', async function () {
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('1000');

                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
                const unallocated = '100';
                await expect(this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, unallocated))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, '100', '2900')
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '100', '100');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('2900');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('100');
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('966');
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
            });

            it('should revert if unallocating more than allocated', async function () {
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                const unallocated = '4000';
                await expect(this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, unallocated)).to.be.revertedWith(
                    `AmountTooLarge(${unallocated}, ${3000})`
                );

                await this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, '1000');
                await expect(this.stakeAllocator.connect(this.accounts.user1).allocateOwnStake(scannerPoolSubjectType, scannerPoolId, '2000')).to.be.revertedWith(
                    `AmountTooLarge(2000, 1000)`
                );
            });

            it('should disable managed subjects if unallocate under min managed', async function () {
                await this.scannerPools.connect(this.accounts.manager).setManagedStakeThreshold({ max: '10000', min: '1000', activated: true }, 1);
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('1000');

                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }
                const unallocated = '1000';
                await expect(this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, unallocated))
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '1000', '1000');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('2000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1000');
                expect(await this.stakeAllocator.allocatedStakePerManaged(2, 1)).to.eq('666');

                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(false);
                }
            });
            it('should allocate after unallocate', async function () {
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                const unallocated = '2000';
                await expect(this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, unallocated))
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '2000', '2000');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('2000');
                await expect(this.stakeAllocator.connect(this.accounts.user1).allocateOwnStake(scannerPoolSubjectType, scannerPoolId, '500'))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '500', '1500');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1500');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1500');
                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, '1000'))
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, true, '1000', '2500')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address, '1000');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('4000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('2500');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1500');
            });
            it('should not allocate if not owner of delegated/manager subject', async function () {
                const staked = '2000';
                await expect(this.stakeAllocator.connect(this.accounts.user2).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, staked)).to.be.revertedWith(
                    `SenderCannotAllocateFor(${scannerPoolSubjectType}, ${scannerPoolId})`
                );
                await expect(this.stakeAllocator.connect(this.accounts.user2).allocateOwnStake(scannerPoolSubjectType, scannerPoolId, staked)).to.be.revertedWith(
                    `SenderCannotAllocateFor(${scannerPoolSubjectType}, ${scannerPoolId})`
                );
            });
        });

        describe('On Init Withdraw', function () {
            it('burns from allocated', async function () {
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                await expect(this.staking.connect(this.accounts.user1).initiateWithdrawal(scannerPoolSubjectType, scannerPoolId, '2000'))
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, 0, 0)
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, '2000', '1000');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
            });

            it('burns from unallocated and allocated', async function () {
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                await this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, '2000');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('2000');
                await expect(this.staking.connect(this.accounts.user1).initiateWithdrawal(scannerPoolSubjectType, scannerPoolId, '2500'))
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, '2000', '2000')
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, '500', '500');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('500');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('500');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
            });

            it('burns from unallocated', async function () {
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                await this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, '3000');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                await expect(this.staking.connect(this.accounts.user1).initiateWithdrawal(scannerPoolSubjectType, scannerPoolId, '2500'))
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, '2500', '500');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('500');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('500');
            });

            it('unallocates delegators stake when scanner pool owner initiates withdrawal', async function () {
                // Confirm scanners in scanner pool are enabled and operational
                // before the delegation of any stake
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerDisabled(scanner.address)).to.eq(false);
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }

                // delegator stakes into the same scanner pool
                await this.staking.connect(this.accounts.user2).deposit(delegatorSubjectType, scannerPoolId, '100');

                // Confirm scanner pool has both the owner's and delegator's stake (owner staked 300; delegator staked 100)
                expect(await this.stakeAllocator.allocatedManagedStake(scannerPoolSubjectType, scannerPoolId)).to.eq('400');

                // Check the balances individually
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('300');
                expect(await this.stakeAllocator.allocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('100');
                // Confirm unallocated stake is zero because the stake is still allocated
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.unallocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');

                // Owner withdraws own stake to under minimum
                expect(await this.staking.connect(this.accounts.user1).initiateWithdrawal(scannerPoolSubjectType, scannerPoolId, '250'));
                // Confirm all of delegator's stake is now unallocated
                expect(await this.stakeAllocator.allocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.unallocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('100');

                // Confirm scanners in scanner pool are not disabled but are non-operational
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerDisabled(scanner.address)).to.eq(false);
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(false);
                }
            });

            it('does not unallocate delegators stake when scanner pool owner unallocates own stake to under min', async function () {
                // Confirm scanners in scanner pool are enabled and operational
                // before the delegation of any stake
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerDisabled(scanner.address)).to.eq(false);
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(true);
                }

                // delegator stakes into the same scanner pool
                await this.staking.connect(this.accounts.user2).deposit(delegatorSubjectType, scannerPoolId, '100');

                // Confirm scanner pool has both the owner's and delegator's stake (owner staked 300; delegator staked 100)
                expect(await this.stakeAllocator.allocatedManagedStake(scannerPoolSubjectType, scannerPoolId)).to.eq('400');

                // Check the balances individually
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('300');
                expect(await this.stakeAllocator.allocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('100');
                // Confirm unallocated stake is zero because the stake is still allocated
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.stakeAllocator.unallocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');

                // Owner unallocates own stake and allocated remains under minimum
                expect(await this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, '250'));
                // Confirm that the part of the owner's and all of the delegator's stake is now unallocated
                expect(await this.stakeAllocator.allocatedManagedStake(scannerPoolSubjectType, scannerPoolId)).to.eq('150');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('50');
                expect(await this.stakeAllocator.allocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('100');
                expect(await this.stakeAllocator.unallocatedStakeFor(delegatorSubjectType, scannerPoolId)).to.eq('0');

                // Confirm scanners in scanner pool are not disabled but are non-operational
                for (const scanner of SCANNERS) {
                    expect(await this.scannerPools.isScannerDisabled(scanner.address)).to.eq(false);
                    expect(await this.scannerPools.isScannerOperational(scanner.address)).to.eq(false);
                }
            });
        });

        describe('On Slashing', function () {
            it('burns from unallocated and allocated', async function () {
                const staked = 3000 - initiallyAllocated;
                await this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, staked);
                await this.stakeAllocator.connect(this.accounts.user1).unallocateOwnStake(scannerPoolSubjectType, scannerPoolId, '2000');
                await this.scannerPools.connect(this.accounts.manager).setManagedStakeThreshold({ max: '100000', min: '333', activated: true }, 1);
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('3000');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('1000');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('2000');
                expect(await this.scannerPools.isScannerOperational(SCANNERS[0].address)).to.eq(true);
                await this.access.connect(this.accounts.admin).grantRole(this.roles.SLASHER, this.accounts.admin.address);
                await expect(this.staking.connect(this.accounts.admin).slash(scannerPoolSubjectType, scannerPoolId, '2500', this.accounts.user1.address, 0))
                    .to.emit(this.stakeAllocator, 'UnallocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, '2000', 0)
                    .to.emit(this.stakeAllocator, 'AllocatedStake')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, false, '500', '500');
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('500');
                expect(await this.stakeAllocator.allocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('500');
                expect(await this.stakeAllocator.unallocatedStakeFor(scannerPoolSubjectType, scannerPoolId)).to.eq('0');
                expect(await this.scannerPools.isScannerOperational(SCANNERS[0].address)).to.eq(false);
            });
        });
    });

    describe('Deposit / Withdraw', function () {
        describe('Delegated', function () {
            const DELAY = 86400;
            beforeEach(async function () {
                await expect(this.staking.setDelay(DELAY)).to.emit(this.staking, 'DelaySet').withArgs(DELAY);
            });

            it('happy path', async function () {
                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.be.equal(initiallyAllocated);
                expect(await this.staking.totalActiveStake()).to.be.equal(initiallyAllocated);
                expect(await this.staking.sharesOf(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address)).to.be.equal(initiallyAllocated);
                expect(await this.staking.totalShares(scannerPoolSubjectType, scannerPoolId)).to.be.equal(initiallyAllocated);

                await expect(this.staking.connect(this.accounts.user1).deposit(scannerPoolSubjectType, scannerPoolId, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user1.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, scannerPoolActive, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address, '100');

                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.be.equal(100 + initiallyAllocated);
                expect(await this.staking.totalActiveStake()).to.be.equal(100 + initiallyAllocated);
                expect(await this.staking.sharesOf(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address)).to.be.equal(100 + initiallyAllocated);
                expect(await this.staking.totalShares(scannerPoolSubjectType, scannerPoolId)).to.be.equal(100 + initiallyAllocated);

                await expect(this.staking.connect(this.accounts.user1).withdraw(scannerPoolSubjectType, scannerPoolId)).to.be.reverted;

                const tx1 = await this.staking.connect(this.accounts.user1).initiateWithdrawal(scannerPoolSubjectType, scannerPoolId, '50');
                await expect(tx1)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address, (await txTimestamp(tx1)) + DELAY)
                    .to.emit(this.staking, 'TransferSingle');

                await expect(this.staking.connect(this.accounts.user1).withdraw(scannerPoolSubjectType, scannerPoolId)).to.be.reverted;

                await network.provider.send('evm_increaseTime', [DELAY]);

                await expect(this.staking.connect(this.accounts.user1).withdraw(scannerPoolSubjectType, scannerPoolId))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user1.address, '50')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, this.accounts.user1.address, ethers.constants.AddressZero, scannerPoolInactive, '50')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address);

                expect(await this.staking.activeStakeFor(scannerPoolSubjectType, scannerPoolId)).to.be.equal(50 + initiallyAllocated);
                expect(await this.staking.totalActiveStake()).to.be.equal(50 + initiallyAllocated);
                expect(await this.staking.sharesOf(scannerPoolSubjectType, scannerPoolId, this.accounts.user1.address)).to.be.equal(50 + initiallyAllocated);
                expect(await this.staking.totalShares(scannerPoolSubjectType, scannerPoolId)).to.be.equal(50 + initiallyAllocated);
            });
        });
    });
});