const { ethers, network, upgrades } = require('hardhat');
const { expect } = require('chai');
const { prepare } = require('../fixture');
const contractHelpers = require('../../scripts/utils/contractHelpers');

const AGENT_SUBJECT = 1;

const prepareCommit = (...args) => ethers.utils.solidityKeccak256(['bytes32', 'address', 'string', 'uint256[]'], args);

describe('Forta Staking Parameters', function () {
    prepare();

    beforeEach(async function () {
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, ethers.utils.parseEther('1000'), this.token.address);
        await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);
    });

    describe('Agents', function () {
        const AGENT_ID_1 = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        const AGENT_ID_2 = ethers.utils.hexlify(ethers.utils.randomBytes(32));

        beforeEach(async function () {
            const args1 = [AGENT_ID_1, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
            await this.agents.prepareAgent(prepareCommit(...args1));
            await network.provider.send('evm_increaseTime', [300]);
            await this.agents.connect(this.accounts.other).createAgent(...args1);
            const args2 = [AGENT_ID_2, this.accounts.user1.address, 'Metadata2', [1, 3, 4, 500]];
            await this.agents.prepareAgent(prepareCommit(...args2));
            await network.provider.send('evm_increaseTime', [300]);
            await this.agents.connect(this.accounts.other).createAgent(...args2);
        });
        it('happy path', async function () {
            expect(await this.subjectGateway.minStakeFor(AGENT_SUBJECT, AGENT_ID_1)).to.equal(0);
            expect(await this.agents.isStakedOverMin(AGENT_ID_1)).to.equal(true);

            await expect(this.agents.connect(this.accounts.manager).setStakeThreshold({ max: '500', min: '100', activated: true }))
                .to.emit(this.agents, 'StakeThresholdChanged')
                .withArgs('100', '500', true);
            expect(await this.subjectGateway.minStakeFor(AGENT_SUBJECT, AGENT_ID_1)).to.equal(100);
            expect(await this.subjectGateway.maxStakeFor(AGENT_SUBJECT, AGENT_ID_1)).to.equal(500);

            expect(await this.agents.isStakedOverMin(AGENT_ID_1)).to.equal(false);
            await this.staking.connect(this.accounts.user1).deposit(AGENT_SUBJECT, AGENT_ID_1, '101');
            expect(await this.agents.isStakedOverMin(AGENT_ID_1)).to.equal(true);
        });

        it('changing general minimum stake reflects on previous staked values', async function () {
            await this.agents.connect(this.accounts.manager).setStakeThreshold({ max: '500', min: '100', activated: true });
            await this.staking.connect(this.accounts.user1).deposit(AGENT_SUBJECT, AGENT_ID_1, '101');

            await this.agents.connect(this.accounts.manager).setStakeThreshold({ max: '500', min: '200', activated: true });

            expect(await this.agents.isStakedOverMin(AGENT_ID_1)).to.equal(false);

            await this.agents.connect(this.accounts.manager).setStakeThreshold({ max: '500', min: '10', activated: true });

            expect(await this.agents.isStakedOverMin(AGENT_ID_1)).to.equal(true);
        });

        it('same stake min for all agents', async function () {
            await this.agents.connect(this.accounts.manager).setStakeThreshold({ max: '500', min: '100', activated: true });
            await this.staking.connect(this.accounts.user1).deposit(AGENT_SUBJECT, AGENT_ID_1, '101');
            await this.staking.connect(this.accounts.user1).deposit(AGENT_SUBJECT, AGENT_ID_2, '200');
            expect(await this.agents.connect(this.accounts.user1).isStakedOverMin(AGENT_ID_1)).to.equal(true);
            expect(await this.agents.connect(this.accounts.user1).isStakedOverMin(AGENT_ID_2)).to.equal(true);
            await this.agents.connect(this.accounts.manager).setStakeThreshold({ max: '500', min: '300', activated: true });
            expect(await this.agents.connect(this.accounts.user1).isStakedOverMin(AGENT_ID_1)).to.equal(false);
            expect(await this.agents.connect(this.accounts.user1).isStakedOverMin(AGENT_ID_2)).to.equal(false);
        });

        it('cannot stake on unknown agent', async function () {
            await expect(this.staking.connect(this.accounts.user1).deposit(AGENT_SUBJECT, '8743926583', '101')).to.be.revertedWith('StakeInactiveOrSubjectNotFound()');
        });

        it('cannot set unauthorized', async function () {
            await expect(this.agents.connect(this.accounts.user1).setStakeThreshold({ max: '500', min: '100', activated: true })).to.be.revertedWith(
                `MissingRole("${this.roles.AGENT_ADMIN}", "${this.accounts.user1.address}")`
            );
        });

        it('cannot set min > max', async function () {
            await expect(this.agents.connect(this.accounts.manager).setStakeThreshold({ max: '50', min: '100', activated: true })).to.be.revertedWith(
                `StakeThresholdMaxLessOrEqualMin()`
            );
        });
    });

    describe('Set up', function () {
        let subjectGateway;

        beforeEach(async function () {
            const StakeSubjectGateway = await ethers.getContractFactory('StakeSubjectGateway');
            subjectGateway = await upgrades.deployProxy(StakeSubjectGateway, [this.contracts.access.address, this.contracts.staking.address], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await subjectGateway.deployed();
        });
        it('admin methods must be called by admin', async function () {
            await expect(subjectGateway.connect(this.accounts.user1).setStakeSubject(0, this.contracts.staking.address)).to.be.revertedWith(
                `MissingRole("${this.roles.DEFAULT_ADMIN}", "${this.accounts.user1.address}")`
            );
        });

        it('admin methods cannot be called with address 0', async function () {
            await expect(subjectGateway.connect(this.accounts.admin).setStakeSubject(0, ethers.constants.AddressZero)).to.be.revertedWith('ZeroAddress("subject")');
        });

        it('subject type must be valid', async function () {
            await expect(subjectGateway.connect(this.accounts.admin).setStakeSubject(4, this.contracts.staking.address)).to.be.revertedWith('InvalidSubjectType(4)');
        });
    });
});
