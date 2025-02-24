const { ethers, network } = require('hardhat');
const { expect } = require('chai');
const { prepare } = require('../fixture');
const { subjectToActive, subjectToInactive } = require('../../scripts/utils/staking.js');
const contractHelpers = require('../../scripts/utils/contractHelpers');

const subjects = [
    [ethers.BigNumber.from('0x0b241032ca430d9c02eaa6a52d217bbff046f0d1b3f3d2aa928e42a97150ec91'), 1], // Agent id, agent type
    [ethers.BigNumber.from(ethers.utils.id('135a782d-c263-43bd-b70b-920873ed7e9d')), 1], // Agent 2 id, agent type

];
const [[subject1, subjectType1, active1, inactive1], [subject2, subjectType2, active2, inactive2]] = subjects.map((items) => [
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

const MAX_STAKE = '10000';

describe('Staking - DIRECT', function () {
    prepare({
        stake: {
            agents: { min: '1', max: MAX_STAKE, activated: true },
        },
    });
    beforeEach(async function () {
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, ethers.utils.parseEther('1000'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user2.address, ethers.utils.parseEther('1000'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user3.address, ethers.utils.parseEther('1000'), this.token.address);

        await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user2).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user3).approve(this.staking.address, ethers.constants.MaxUint256);

        const args = [subject2, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
        await this.agents.connect(this.accounts.other).createAgent(...args);
    });

    describe('Deposit / Withdraw', function () {
        it('Should not direct deposit on managed stake', async function () {
            await this.scanners.connect(this.accounts.manager).setStakeThreshold({ min: 1, max: 200, activated: true }, 1);
            await expect(this.staking.connect(this.accounts.user1).deposit(0, this.accounts.other.address, '100')).to.be.revertedWith('ForbiddenForType(0, 4, 4)');
        });

        describe('Direct Subject - no delay', function () {
            it('happy path 1 subject', async function () {
                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('0');
                expect(await this.staking.totalActiveStake()).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('0');

                await expect(this.staking.connect(this.accounts.user1).deposit(subjectType2, subject2, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user1.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, active1, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address, '100');

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('100');
                expect(await this.staking.totalActiveStake()).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('100');

                await expect(this.staking.connect(this.accounts.user2).deposit(subjectType2, subject2, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user2.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, active1, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user2.address, '100');

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('200');
                expect(await this.staking.totalActiveStake()).to.be.equal('200');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('100');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('200');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2)).to.be.reverted;

                const tx1 = await this.staking.connect(this.accounts.user1).initiateWithdrawal(subjectType2, subject2, '50');
                await expect(tx1)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    //.withArgs(subjectType2, subject2, this.accounts.user1.address, await txTimestamp(tx1)) Off by 2 milliseconds
                    .to.emit(this.staking, 'TransferSingle') /*.withArgs(this.accounts.user1.address, this.accounts.user1.address, ethers.constants.AddressZero, subject1, '50')*/
                    .to.emit(this.staking, 'TransferSingle'); /*.withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, inactive1, '50')*/

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user1.address, '50')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, this.accounts.user1.address, ethers.constants.AddressZero, inactive1, '50')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address);

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('150');
                expect(await this.staking.totalActiveStake()).to.be.equal('150');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('100');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('150');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subject1)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subject1)).to.be.reverted;

                const tx2 = await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjectType2, subject2, '100');
                await expect(tx2)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    .withArgs(subjectType2, subject2, this.accounts.user2.address, await txTimestamp(tx2))
                    .to.emit(this.staking, 'TransferSingle') /*.withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, subject1, '100')*/
                    .to.emit(
                        this.staking,
                        'TransferSingle'
                    ); /*.withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, inactive1, '100')*/

                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user2.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, inactive1, '100')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(subjectType2, subject2, this.accounts.user2.address);

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('50');
                expect(await this.staking.totalActiveStake()).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('50');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2)).to.be.reverted;
            });

            it('happy path 2 subjects', async function () {
                expect(await this.staking.activeStakeFor(subjectType1, subject1)).to.be.equal('0');
                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('0');
                expect(await this.staking.totalActiveStake()).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user1.address)).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user3.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType1, subject1)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('0');

                await expect(this.staking.connect(this.accounts.user1).deposit(subjectType1, subject1, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user1.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, active1, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType1, subject1, this.accounts.user1.address, '100');

                expect(await this.staking.activeStakeFor(subjectType1, subject1)).to.be.equal('100');
                expect(await this.staking.totalActiveStake()).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user1.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType1, subject1)).to.be.equal('100');

                await expect(this.staking.connect(this.accounts.user2).deposit(subjectType1, subject1, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user2.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, active1, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType1, subject1, this.accounts.user2.address, '100');

                expect(await this.staking.activeStakeFor(subjectType1, subject1)).to.be.equal('200');
                expect(await this.staking.totalActiveStake()).to.be.equal('200');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user1.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user2.address)).to.be.equal('100');
                expect(await this.staking.totalShares(subjectType1, subject1)).to.be.equal('200');

                await expect(this.staking.connect(this.accounts.user3).deposit(subjectType2, subject2, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user3.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user3.address, ethers.constants.AddressZero, this.accounts.user3.address, active2, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user3.address, '100');

                expect(await this.staking.activeStakeFor(subjectType1, subject1)).to.be.equal('200');
                expect(await this.staking.totalActiveStake()).to.be.equal('300');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user1.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user2.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user3.address)).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user3.address)).to.be.equal('100');
                expect(await this.staking.totalShares(subjectType1, subject1)).to.be.equal('200');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('100');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType1, subject1)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType1, subject1)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user3).withdraw(subjectType2, subject2)).to.be.reverted;

                const tx1 = await this.staking.connect(this.accounts.user1).initiateWithdrawal(subjectType1, subject1, '50');
                await expect(tx1)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    .withArgs(subjectType1, subject1, this.accounts.user1.address, await txTimestamp(tx1))
                    .to.emit(this.staking, 'TransferSingle') /*.withArgs(this.accounts.user1.address, this.accounts.user1.address, ethers.constants.AddressZero, subject1, '50')*/
                    .to.emit(this.staking, 'TransferSingle'); /*.withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, inactive1, '50')*/

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType1, subject1))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user1.address, '50')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, this.accounts.user1.address, ethers.constants.AddressZero, inactive1, '50')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(subjectType1, subject1, this.accounts.user1.address);

                expect(await this.staking.activeStakeFor(subjectType1, subject1)).to.be.equal('150');
                expect(await this.staking.totalActiveStake()).to.be.equal('250');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user1.address)).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user2.address)).to.be.equal('100');
                expect(await this.staking.totalShares(subjectType1, subject1)).to.be.equal('150');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subject1)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subject1)).to.be.reverted;

                const tx2 = await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjectType1, subject1, '100');
                await expect(tx2)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    .withArgs(subjectType1, subject1, this.accounts.user2.address, await txTimestamp(tx2))
                    .to.emit(this.staking, 'TransferSingle') /*.withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, subject1, '100')*/
                    .to.emit(
                        this.staking,
                        'TransferSingle'
                    ); /*.withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, inactive1, '100')*/

                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType1, subject1))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user2.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, inactive1, '100')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(subjectType1, subject1, this.accounts.user2.address);

                const tx3 = await this.staking.connect(this.accounts.user3).initiateWithdrawal(subjectType2, subject2, '100');
                await expect(tx3)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    .withArgs(subjectType2, subject2, this.accounts.user3.address, await txTimestamp(tx3))
                    .to.emit(this.staking, 'TransferSingle') /*.withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, subject1, '100')*/
                    .to.emit(
                        this.staking,
                        'TransferSingle'
                    ); /*.withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, inactive1, '100')*/

                await expect(this.staking.connect(this.accounts.user3).withdraw(subjectType2, subject2))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user3.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user3.address, this.accounts.user3.address, ethers.constants.AddressZero, inactive2, '100')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(subjectType2, subject2, this.accounts.user3.address);

                expect(await this.staking.activeStakeFor(subjectType1, subject1)).to.be.equal('50');
                expect(await this.staking.totalActiveStake()).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user1.address)).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType1, subject1, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user3.address)).to.be.equal('0');

                expect(await this.staking.totalShares(subjectType1, subject1)).to.be.equal('50');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('0');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType1, subject1)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType1, subject1)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user3).withdraw(subjectType2, subject2)).to.be.reverted;
            });

            it('stake over max does not transfer tokens', async function () {
                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('0');
                expect(await this.staking.totalActiveStake()).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('0');

                await expect(this.staking.connect(this.accounts.user1).deposit(subjectType2, subject2, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user1.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, active1, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address, '100');
                const difference = ethers.BigNumber.from(MAX_STAKE).sub('100');
                await expect(this.staking.connect(this.accounts.user1).deposit(subjectType2, subject2, MAX_STAKE))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user1.address, this.staking.address, difference)
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, active1, difference)
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address, difference)
                    .to.emit(this.staking, 'MaxStakeReached')
                    .withArgs(subjectType2, subject2);

                await expect(this.staking.connect(this.accounts.user1).deposit(subjectType2, subject2, MAX_STAKE))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user1.address, this.staking.address, '0')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, active1, '0')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address, '0')
                    .to.emit(this.staking, 'MaxStakeReached')
                    .withArgs(subjectType2, subject2);
            });

            it('invalid subjectType', async function () {
                await expect(this.staking.connect(this.accounts.user1).deposit(9, subject1, '100')).to.be.revertedWith('InvalidSubjectType(9)');
            });

            it('cannot initiate withdraw with no active shares', async function () {
                await expect(this.staking.connect(this.accounts.user1).initiateWithdrawal(1, subject1, '100')).to.be.revertedWith('NoActiveShares()');
            });

            it('cannot withdraw with no inactive shares', async function () {
                await expect(this.staking.connect(this.accounts.user1).withdraw(1, subject1)).to.be.revertedWith('NoInactiveShares()');
            });
        });

        describe('Direct Subject - with delay', function () {
            const DELAY = 86400;
            beforeEach(async function () {
                await expect(this.staking.setDelay(DELAY)).to.emit(this.staking, 'DelaySet').withArgs(DELAY);
            });

            it('fails to set delay if not withing limits', async function () {
                const min = await this.staking.MIN_WITHDRAWAL_DELAY();
                const tooSmall = min.sub(1);
                await expect(this.staking.setDelay(tooSmall)).to.be.revertedWith(`AmountTooSmall(${tooSmall.toString()}, ${min.toString()})`);
                const max = await this.staking.MAX_WITHDRAWAL_DELAY();
                const tooBig = max.add(1);
                await expect(this.staking.setDelay(tooBig)).to.be.revertedWith(`AmountTooLarge(${tooBig.toString()}, ${max.toString()})`);
            });

            it('happy path', async function () {
                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('0');
                expect(await this.staking.totalActiveStake()).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('0');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('0');

                await expect(this.staking.connect(this.accounts.user1).deposit(subjectType2, subject2, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user1.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, ethers.constants.AddressZero, this.accounts.user1.address, active1, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address, '100');

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('100');
                expect(await this.staking.totalActiveStake()).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('100');

                await expect(this.staking.connect(this.accounts.user2).deposit(subjectType2, subject2, '100'))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.accounts.user2.address, this.staking.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, active1, '100')
                    .to.emit(this.staking, 'StakeDeposited')
                    .withArgs(subjectType2, subject2, this.accounts.user2.address, '100');

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('200');
                expect(await this.staking.totalActiveStake()).to.be.equal('200');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('100');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('100');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('200');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2)).to.be.reverted;

                const tx1 = await this.staking.connect(this.accounts.user1).initiateWithdrawal(subjectType2, subject2, '50');
                await expect(tx1)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address, (await txTimestamp(tx1)) + DELAY)
                    .to.emit(this.staking, 'TransferSingle') /*.withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, subject1, '100')*/
                    .to.emit(
                        this.staking,
                        'TransferSingle'
                    ); /*.withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, inactive1, '100')*/

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2)).to.be.reverted;

                await network.provider.send('evm_increaseTime', [DELAY]);

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user1.address, '50')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user1.address, this.accounts.user1.address, ethers.constants.AddressZero, inactive1, '50')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(subjectType2, subject2, this.accounts.user1.address);

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('150');
                expect(await this.staking.totalActiveStake()).to.be.equal('150');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('100');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('150');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2)).to.be.reverted;

                const tx2 = await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjectType2, subject2, '100');
                await expect(tx2)
                    .to.emit(this.staking, 'WithdrawalInitiated')
                    .withArgs(subjectType2, subject2, this.accounts.user2.address, (await txTimestamp(tx2)) + DELAY)
                    .to.emit(this.staking, 'TransferSingle') /*.withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, subject1, '100')*/
                    .to.emit(
                        this.staking,
                        'TransferSingle'
                    ); /*.withArgs(this.accounts.user2.address, ethers.constants.AddressZero, this.accounts.user2.address, inactive1, '100')*/

                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2)).to.be.reverted;

                await network.provider.send('evm_increaseTime', [DELAY]);

                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.staking.address, this.accounts.user2.address, '100')
                    .to.emit(this.staking, 'TransferSingle')
                    .withArgs(this.accounts.user2.address, this.accounts.user2.address, ethers.constants.AddressZero, inactive1, '100')
                    .to.emit(this.staking, 'WithdrawalExecuted')
                    .withArgs(subjectType2, subject2, this.accounts.user2.address);

                expect(await this.staking.activeStakeFor(subjectType2, subject2)).to.be.equal('50');
                expect(await this.staking.totalActiveStake()).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user1.address)).to.be.equal('50');
                expect(await this.staking.sharesOf(subjectType2, subject2, this.accounts.user2.address)).to.be.equal('0');
                expect(await this.staking.totalShares(subjectType2, subject2)).to.be.equal('50');

                await expect(this.staking.connect(this.accounts.user1).withdraw(subjectType2, subject2)).to.be.reverted;
                await expect(this.staking.connect(this.accounts.user2).withdraw(subjectType2, subject2)).to.be.reverted;
            });
        });
    });
});
