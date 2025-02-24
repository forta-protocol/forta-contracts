const hre = require('hardhat');
const { ethers } = hre;
const { expect } = require('chai');
const { prepare, attach, deploy, deployUpgradeable } = require('../fixture');
const contractHelpers = require('../../scripts/utils/contractHelpers');

const min = (...args) => args.slice(1).reduce((x, y) => (x.lt(y) ? x : y), args[0]);

describe('VestingWallet', function () {
    prepare();

    beforeEach(async function () {
        this.now = await ethers.provider.getBlock('latest').then(({ timestamp }) => timestamp);
        this.start = this.now + 3600; // in 1 hour
        this.cliff = 1 * 365 * 86400; // 1 years
        this.end = this.start + 4 * 365 * 86400; // 4 years
        this.amount = ethers.utils.parseEther('100');
        this.schedule = Array(256)
            .fill()
            .map((_, i) =>
                ethers.BigNumber.from(i)
                    .mul(this.end - this.start)
                    .div(224)
                    .add(this.start)
            )
            .map((timestamp) => ({
                timestamp,
                vested: timestamp - this.start < this.cliff ? ethers.constants.Zero : min(this.amount.mul(timestamp.sub(this.start)).div(this.end - this.start), this.amount),
            }));

        this.rootchainmanager = await deploy(hre, 'RootChainManagerMock');
        this.predicate = await this.rootchainmanager.predicate().then((address) => attach(hre, 'PredicatMock', address));
        this.l2escrowfactory = { address: ethers.constants.AddressZero };
        this.l2escrowtemplate = { address: ethers.constants.AddressZero };

        this.vesting = await deployUpgradeable(
            hre,
            'VestingWalletV2',
            'uups',
            [
                this.accounts.other.address,
                this.accounts.admin.address,
                this.start,
                this.cliff,
                this.end - this.start, // duration
            ],
            {
                constructorArgs: [this.rootchainmanager.address, this.token.address, this.l2escrowfactory.address, this.l2escrowtemplate.address],
                unsafeAllow: 'delegatecall',
            }
        );

        await contractHelpers.overwriteUserTokenBalance(this.vesting.address, ethers.utils.parseUnits(this.amount.toString(), 'wei'), this.token.address);
    });

    it('rejects zero address for beneficiary', async function () {
        await expect(
            deployUpgradeable(
                hre,
                'VestingWalletV2',
                'uups',
                [
                    ethers.constants.AddressZero,
                    this.accounts.admin.address,
                    this.start,
                    this.cliff,
                    this.end - this.start, // duration
                ],
                {
                    constructorArgs: [this.rootchainmanager.address, this.token.address, this.l2escrowfactory.address, this.l2escrowtemplate.address],
                    unsafeAllow: 'delegatecall',
                }
            )
        ).to.be.revertedWith('ZeroAddress("beneficiary_")');
    });

    it('create vesting contract', async function () {
        expect(await this.vesting.beneficiary()).to.be.equal(this.accounts.other.address);
        expect(await this.vesting.owner()).to.be.equal(this.accounts.admin.address);
        expect(await this.vesting.start()).to.be.equal(this.start);
        expect(await this.vesting.cliff()).to.be.equal(this.cliff);
        expect(await this.vesting.duration()).to.be.equal(this.end - this.start);
    });

    describe('vesting schedule', function () {
        it('check vesting schedule', async function () {
            for (const { timestamp, vested } of this.schedule) {
                expect(await this.vesting.vestedAmount(this.token.address, timestamp)).to.be.equal(vested);
            }
        });

        it('execute vesting schedule', async function () {
            //early
            await expect(this.vesting.release(this.token.address))
                .to.emit(this.vesting, 'TokensReleased')
                .withArgs(this.token.address, ethers.constants.Zero)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.vesting.address, this.accounts.other.address, ethers.constants.Zero);

            // on schedule
            let released = ethers.constants.Zero;
            for (const { timestamp, vested } of this.schedule) {
                await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp.toNumber()]);

                await expect(this.vesting.release(this.token.address))
                    .to.emit(this.vesting, 'TokensReleased')
                    .withArgs(this.token.address, vested.sub(released))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(this.vesting.address, this.accounts.other.address, vested.sub(released));

                released = vested;

                expect(await this.token.balanceOf(this.vesting.address)).to.be.equal(this.amount.sub(vested));
                expect(await this.token.balanceOf(this.accounts.other.address)).to.be.equal(vested);
            }
        });
    });

    describe('delegate vote', function () {
        it('wrong caller', async function () {
            expect(await this.token.delegates(this.vesting.address)).to.be.equal(ethers.constants.AddressZero);

            await expect(this.vesting.delegate(this.token.address, this.accounts.other.address)).to.be.revertedWith(
                `DoesNotHaveAccess("${this.accounts.admin.address}", "beneficiary")`
            );

            expect(await this.token.delegates(this.vesting.address)).to.be.equal(ethers.constants.AddressZero);
        });

        it('authorized call', async function () {
            expect(await this.token.delegates(this.vesting.address)).to.be.equal(ethers.constants.AddressZero);

            await expect(this.vesting.connect(this.accounts.other).delegate(this.token.address, this.accounts.other.address))
                .to.emit(this.token, 'DelegateChanged')
                .withArgs(this.vesting.address, ethers.constants.AddressZero, this.accounts.other.address)
                .to.emit(this.token, 'DelegateVotesChanged')
                .withArgs(this.accounts.other.address, 0, this.amount);

            expect(await this.token.delegates(this.vesting.address)).to.be.equal(this.accounts.other.address);
        });
    });

    describe('bridge token', function () {
        it('protected', async function () {
            await expect(this.vesting.functions['bridge(uint256)'](this.amount)).to.be.revertedWith(`DoesNotHaveAccess("${this.accounts.admin.address}", "beneficiary")`);
        });

        it('beneficiary can bridge', async function () {
            const l2escrow = ethers.utils.getAddress(
                ethers.utils
                    .solidityKeccak256(
                        ['bytes1', 'address', 'bytes32', 'bytes32'],
                        [
                            '0xff',
                            this.l2escrowfactory.address,
                            ethers.utils.solidityKeccak256(['address', 'address'], [this.vesting.address, this.accounts.other.address]),
                            ethers.utils.keccak256(
                                ['0x3d602d80600a3d3981f3363d3d373d3d3d363d73', this.l2escrowtemplate.address.replace(/^0x/, ''), '5af43d82803e903d91602b57fd5bf3'].join('')
                            ),
                        ]
                    )
                    .slice(-40)
            );

            await expect(this.vesting.connect(this.accounts.other).functions['bridge(uint256)'](this.amount))
                .to.emit(this.token, 'Approval')
                .withArgs(this.vesting.address, this.predicate.address, this.amount)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.vesting.address, this.predicate.address, this.amount)
                .to.emit(this.token, 'Approval')
                .withArgs(this.vesting.address, this.predicate.address, 0)
                .to.emit(this.predicate, 'LockedERC20')
                .withArgs(this.vesting.address, l2escrow, this.token.address, this.amount)
                .to.emit(this.vesting, 'TokensBridged')
                .withArgs(l2escrow, this.accounts.other.address, this.amount);
        });
    });
});
