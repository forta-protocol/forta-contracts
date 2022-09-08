const { ethers, upgrades, network } = require('hardhat');
const { expect } = require('chai');
const { prepare } = require('../fixture');
const { subjectToActive, subjectToInactive } = require('../../scripts/utils/staking.js');

const prepareCommit = (...args) => ethers.utils.solidityKeccak256(['bytes32', 'address', 'string', 'uint256[]'], args);

let originalScanners, agents;
describe('Upgrades testing', function () {
    prepare();

    describe('Agent Registry', async function () {
        it(' 0.1.1 -> 0.1.5', async function () {
            const AgentRegistry_0_1_1 = await ethers.getContractFactory('AgentRegistry_0_1_1');
            agents = await upgrades.deployProxy(AgentRegistry_0_1_1, [this.contracts.access.address, this.contracts.router.address, 'Forta Agents', 'FAgents'], {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await agents.deployed();

            //create agent
            const AGENT_ID = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const args = [AGENT_ID, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
            await agents.prepareAgent(prepareCommit(...args));
            await network.provider.send('evm_increaseTime', [300]);
            await expect(agents.connect(this.accounts.other).createAgent(...args));

            // Checks
            //expect(await this.agents.isCreated(AGENT_ID)).to.be.equal(true); //Does not exist in 0.1.1
            expect(await agents.name()).to.be.equal('Forta Agents');
            expect(await agents.symbol()).to.be.equal('FAgents');
            expect(await agents.ownerOf(AGENT_ID)).to.be.equal(this.accounts.user1.address);
            expect(
                await agents.getAgent(AGENT_ID).then((agent) => [agent.version.toNumber(), agent.metadata, agent.chainIds.map((chainId) => chainId.toNumber())])
            ).to.be.deep.equal([1, args[2], args[3]]);
            await agents.connect(this.accounts.user1).enableAgent(AGENT_ID, 1);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(true);
            await agents.connect(this.accounts.user1).disableAgent(AGENT_ID, 1);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(false);
            expect(await agents.connect(this.accounts.user1).getAgentCount()).to.be.equal(1);
            const AgentRegistry_0_1_2 = await ethers.getContractFactory('AgentRegistry_0_1_2');
            agents = await upgrades.upgradeProxy(agents.address, AgentRegistry_0_1_2, {
                call: {
                    fn: 'setStakeController(address)',
                    args: [this.contracts.stakingParameters.address],
                },
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });
            await agents.connect(this.accounts.user1).disableAgent(AGENT_ID, 1);
            expect(await agents.getStakeController()).to.be.equal(this.contracts.stakingParameters.address);
            expect(await agents.version()).to.be.equal('0.1.2');
            expect(await agents.isCreated(AGENT_ID)).to.be.equal(true);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(false);
            await agents.connect(this.accounts.user1).enableAgent(AGENT_ID, 1);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(true);
            expect(await agents.name()).to.be.equal('Forta Agents');
            expect(await agents.symbol()).to.be.equal('FAgents');

            const AgentRegistry_0_1_4 = await ethers.getContractFactory('AgentRegistry_0_1_4');
            agents = await upgrades.upgradeProxy(agents.address, AgentRegistry_0_1_4, {
                call: {
                    fn: 'setStakeController(address)',
                    args: [this.contracts.stakingParameters.address],
                },
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });
            await agents.connect(this.accounts.user1).disableAgent(AGENT_ID, 1);
            expect(await agents.getStakeController()).to.be.equal(this.contracts.stakingParameters.address);
            expect(await agents.version()).to.be.equal('0.1.4');
            expect(await agents.isRegistered(AGENT_ID)).to.be.equal(true);
            expect(await agents.getDisableFlags(AGENT_ID)).to.be.equal([2]);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(false);
            await agents.connect(this.accounts.user1).enableAgent(AGENT_ID, 1);
            expect(await agents.getDisableFlags(AGENT_ID)).to.be.equal([0]);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(true);
            expect(await agents.name()).to.be.equal('Forta Agents');
            expect(await agents.symbol()).to.be.equal('FAgents');
        });
    });

    describe('Scanner Registry', async function () {
        it(' 0.1.0 -> 0.1.2', async function () {
            this.accounts.getAccount('scanner');
            const ScannerRegistry_0_1_0 = await ethers.getContractFactory('ScannerRegistry_0_1_0');
            originalScanners = await upgrades.deployProxy(ScannerRegistry_0_1_0, [this.contracts.access.address, this.contracts.router.address, 'Forta Scanners', 'FScanners'], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await originalScanners.deployed();

            const SCANNERS = [this.accounts.scanner, this.accounts.user1];

            var chainId = 1;
            for (var i = 0; i < SCANNERS.length; i++) {
                const scannerId = SCANNERS[i].address;
                await originalScanners.connect(SCANNERS[i]).register(this.accounts.user1.address, chainId);
                await originalScanners.connect(this.accounts.user1).setManager(scannerId, this.accounts.user2.address, true);
                await originalScanners.connect(this.accounts.manager).disableScanner(scannerId, 0);

                expect(await originalScanners.isEnabled(scannerId)).to.be.equal(false);
                expect(await originalScanners.isManager(scannerId, this.accounts.user2.address)).to.be.equal(true);
                expect(await originalScanners.getManagerCount(scannerId)).to.be.equal(1);
                expect(await originalScanners.getManagerAt(scannerId, 0)).to.be.equal(this.accounts.user2.address);

                expect(await originalScanners.getScanner(scannerId)).to.be.equal(chainId);
                // expect(await this.scanners.isRegistered(SCANNER_ID)).to.be.equal(true); Not existing in previous
                expect(await originalScanners.ownerOf(scannerId)).to.be.equal(this.accounts.user1.address);
                expect(await originalScanners.isEnabled(scannerId)).to.be.equal(false);
                chainId++;
            }
            chainId = 1;

            const NewImplementation = await ethers.getContractFactory('ScannerRegistry');
            const scannerRegistry = await upgrades.upgradeProxy(originalScanners.address, NewImplementation, {
                call: {
                    fn: 'setStakeController(address)',
                    args: [this.contracts.stakingParameters.address],
                },
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });
            await this.contracts.stakingParameters.setStakeSubjectHandler(0, scannerRegistry.address);
            await scannerRegistry.connect(this.accounts.manager).setStakeThreshold({ max: '100', min: '0', activated: true }, 1);

            await this.contracts.access.grantRole(this.roles.SCANNER_ADMIN, this.accounts.admin.address);
            for (const scanner of SCANNERS) {
                const scannerId = scanner.address;
                expect(await scannerRegistry.getStakeController()).to.be.equal(this.contracts.stakingParameters.address);
                expect(await scannerRegistry.version()).to.be.equal('0.1.2');
                expect(await scannerRegistry.isEnabled(scannerId)).to.be.equal(false);
                expect(await scannerRegistry.isManager(scannerId, this.accounts.user2.address)).to.be.equal(true);
                expect(await scannerRegistry.getManagerCount(scannerId)).to.be.equal(1);
                expect(await scannerRegistry.getManagerAt(scannerId, 0)).to.be.equal(this.accounts.user2.address);

                expect(await scannerRegistry.getScanner(scannerId).then((scanner) => [scanner.chainId.toNumber(), scanner.metadata])).to.be.deep.equal([chainId, '']);
                expect(await scannerRegistry.isRegistered(scannerId)).to.be.equal(true);
                expect(await scannerRegistry.ownerOf(scannerId)).to.be.equal(this.accounts.user1.address);
                expect(await scannerRegistry.isEnabled(scannerId)).to.be.equal(false);

                await scannerRegistry.connect(this.accounts.admin).adminUpdate(scannerId, 55, 'metadata');
                expect(await scannerRegistry.getScanner(scannerId).then((scanner) => [scanner.chainId.toNumber(), scanner.metadata])).to.be.deep.equal([55, 'metadata']);
                chainId++;
            }
        });
    });
    describe('FortaStaking', async function () {
        it('0.1.0 -> 0.1.1', async function () {
            this.accounts.getAccount('scanner');
            const STAKING_PARAMS = { max: '1000', min: '100', activated: true };

            const DELAY = 123123;
            const TREASURY = await ethers.Wallet.createRandom().address;
            const FortaStaking_0_1_0 = await ethers.getContractFactory('FortaStaking_0_1_0');
            this.staking = await upgrades.deployProxy(FortaStaking_0_1_0, [this.access.address, this.router.address, this.token.address, DELAY, TREASURY], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await this.staking.deployed();

            const FortaStakingParameters_0_1_0 = await ethers.getContractFactory('FortaStakingParameters_0_1_0');
            this.stakingParameters = await upgrades.deployProxy(FortaStakingParameters_0_1_0, [this.access.address, this.router.address, this.staking.address], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await this.stakingParameters.deployed();
            await this.stakingParameters.setStakeSubjectHandler(0, this.scanners.address);
            await this.stakingParameters.setStakeSubjectHandler(1, this.agents.address);
            await this.agents.connect(this.accounts.manager).setStakeThreshold(STAKING_PARAMS);
            await this.scanners.connect(this.accounts.manager).setStakeThreshold(STAKING_PARAMS, 1);

            this.access.connect(this.accounts.admin).grantRole(this.roles.SLASHER, this.accounts.admin.address),

            await this.token.connect(this.accounts.minter).mint(this.accounts.user1.address, '100000000');
            await this.token.connect(this.accounts.minter).mint(this.accounts.user2.address, '100000000');
            await this.token.connect(this.accounts.minter).mint(this.accounts.admin.address, '100000000');

            await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);
            await this.token.connect(this.accounts.user2).approve(this.staking.address, ethers.constants.MaxUint256);
            await this.token.connect(this.accounts.admin).approve(this.staking.address, ethers.constants.MaxUint256);

            await this.scanners.connect(this.accounts.scanner).register(this.accounts.user1.address, 1, 'Scanner Metadata');
            const AGENT_ID = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const args = [AGENT_ID, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
            await this.agents.createAgent(...args);

            await this.staking.setStakingParametersManager(this.stakingParameters.address);
            await this.staking.connect(this.accounts.user1).deposit(0, this.accounts.scanner.address, '100');

            await this.staking.connect(this.accounts.user1).initiateWithdrawal(0, this.accounts.scanner.address, '50');

            await this.staking.connect(this.accounts.admin).freeze(0, this.accounts.scanner.address, true);
            await this.staking.connect(this.accounts.user2).reward(0, this.accounts.scanner.address, '100');

            await this.staking.connect(this.accounts.user1).deposit(1, AGENT_ID, '100');
            await this.staking.connect(this.accounts.admin).slash(1, AGENT_ID, '50');
            await this.staking.connect(this.accounts.user1).initiateWithdrawal(1, AGENT_ID, '50');
            await this.staking.connect(this.accounts.admin).reward(1, AGENT_ID, '200');
            expect(await this.staking.activeStakeFor(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.inactiveStakeFor(0, this.accounts.scanner.address)).to.be.equal('50');

            expect(await this.staking.sharesOf(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.inactiveSharesOf(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.totalShares(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.totalInactiveShares(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.isFrozen(0, this.accounts.scanner.address)).to.be.equal(true);
            expect(await this.staking.availableReward(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('100');

            expect(await this.staking.activeStakeFor(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.inactiveStakeFor(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.sharesOf(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.inactiveSharesOf(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('25');
            expect(await this.staking.totalShares(1, AGENT_ID)).to.be.equal('50');
            expect(await this.staking.totalInactiveShares(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.isFrozen(1, AGENT_ID)).to.be.equal(false);
            expect(await this.staking.availableReward(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('200');

            expect(await this.staking.totalActiveStake()).to.be.equal('75');
            expect(await this.staking.totalInactiveStake()).to.be.equal('75');

            const FortaStaking_0_1_1 = await ethers.getContractFactory('FortaStaking_0_1_1');
            this.staking = await upgrades.upgradeProxy(this.staking.address, FortaStaking_0_1_1, {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });

            expect(await this.staking.activeStakeFor(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.inactiveStakeFor(0, this.accounts.scanner.address)).to.be.equal('50');

            expect(await this.staking.sharesOf(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.inactiveSharesOf(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.totalShares(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.totalInactiveShares(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.isFrozen(0, this.accounts.scanner.address)).to.be.equal(true);
            expect(await this.staking.availableReward(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('100');

            expect(await this.staking.activeStakeFor(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.inactiveStakeFor(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.sharesOf(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.inactiveSharesOf(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('25');
            expect(await this.staking.totalShares(1, AGENT_ID)).to.be.equal('50');
            expect(await this.staking.totalInactiveShares(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.isFrozen(1, AGENT_ID)).to.be.equal(false);
            expect(await this.staking.availableReward(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('200');

            expect(await this.staking.totalActiveStake()).to.be.equal('75');
            expect(await this.staking.totalInactiveStake()).to.be.equal('75');

            expect(await this.staking.stakeToActiveShares(subjectToActive(0, this.accounts.scanner.address), '10')).to.be.equal('10');
            expect(await this.staking.stakeToInactiveShares(subjectToInactive(0, this.accounts.scanner.address), '10')).to.be.equal('10');
            expect(await this.staking.activeSharesToStake(subjectToActive(0, this.accounts.scanner.address), '10')).to.be.equal('10');
            expect(await this.staking.inactiveSharesToStake(subjectToInactive(0, this.accounts.scanner.address), '10')).to.be.equal('10');

            expect(await this.staking.stakeToActiveShares(subjectToActive(1, AGENT_ID), '10')).to.be.equal('20');
            expect(await this.staking.stakeToInactiveShares(subjectToInactive(1, AGENT_ID), '10')).to.be.equal('10');
            expect(await this.staking.activeSharesToStake(subjectToActive(1, AGENT_ID), '10')).to.be.equal('5');
            expect(await this.staking.inactiveSharesToStake(subjectToInactive(1, AGENT_ID), '10')).to.be.equal('10');
        });
    });
});
