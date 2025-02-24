const hre = require('hardhat');
const { ethers, upgrades, network } = hre;
const { expect } = require('chai');
const { prepare, deploy } = require('../fixture');
const { subjectToActive, subjectToInactive } = require('../../scripts/utils/staking.js');
const loadEnv = require('../../scripts/loadEnv');
const contractHelpers = require('../../scripts/utils/contractHelpers');

const prepareCommit = (...args) => ethers.utils.solidityKeccak256(['bytes32', 'address', 'string', 'uint256[]'], args);

let originalScanners, agents, mockRouter;
describe('Upgrades testing', function () {
    prepare();
    before(async () => {
        mockRouter = await deploy(hre, await ethers.getContractFactory('MockRouter'));
    });

    describe('Agent Registry', async function () {
        it(' 0.1.1 -> 0.1.6', async function () {
            const AgentRegistry_0_1_1 = await ethers.getContractFactory('AgentRegistry_0_1_1');
            agents = await upgrades.deployProxy(AgentRegistry_0_1_1, [this.contracts.access.address, mockRouter.address, 'Forta Agents', 'FAgents'], {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await agents.deployed();
            //create agent
            const AGENT_ID = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const args = [AGENT_ID, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
            await agents.prepareAgent(prepareCommit(...args));
            await network.provider.send('evm_increaseTime', [300]);
            await agents.connect(this.accounts.user1).createAgent(...args);

            // Checks
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
                    args: [this.contracts.subjectGateway.address],
                },
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });
            await agents.connect(this.accounts.user1).disableAgent(AGENT_ID, 1);
            expect(await agents.getStakeController()).to.be.equal(this.contracts.subjectGateway.address);
            expect(await agents.version()).to.be.equal('0.1.2');
            expect(await agents.ownerOf(AGENT_ID)).to.be.equal(this.accounts.user1.address);
            expect(
                await agents.getAgent(AGENT_ID).then((agent) => [agent.agentVersion.toNumber(), agent.metadata, agent.chainIds.map((chainId) => chainId.toNumber())])
            ).to.be.deep.equal([1, args[2], args[3]]);
            expect(await agents.isCreated(AGENT_ID)).to.be.equal(true);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(false);
            await agents.connect(this.accounts.user1).enableAgent(AGENT_ID, 1);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(true);
            expect(await agents.name()).to.be.equal('Forta Agents');
            expect(await agents.symbol()).to.be.equal('FAgents');

            const AgentRegistry_0_1_4 = await ethers.getContractFactory('AgentRegistry_0_1_4');
            agents = await upgrades.upgradeProxy(agents.address, AgentRegistry_0_1_4, {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });
            await agents.connect(this.accounts.user1).disableAgent(AGENT_ID, 1);
            expect(await agents.getStakeController()).to.be.equal(this.contracts.subjectGateway.address);
            expect(await agents.version()).to.be.equal('0.1.4');
            expect(await agents.isRegistered(AGENT_ID)).to.be.equal(true);
            expect(await agents.getDisableFlags(AGENT_ID)).to.be.equal([2]);
            expect(await agents.ownerOf(AGENT_ID)).to.be.equal(this.accounts.user1.address);
            expect(
                await agents.getAgent(AGENT_ID).then((agent) => [agent.agentVersion.toNumber(), agent.metadata, agent.chainIds.map((chainId) => chainId.toNumber())])
            ).to.be.deep.equal([1, args[2], args[3]]);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(false);
            await agents.connect(this.accounts.user1).enableAgent(AGENT_ID, 1);
            expect(await agents.getDisableFlags(AGENT_ID)).to.be.equal([0]);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(true);
            expect(await agents.name()).to.be.equal('Forta Agents');
            expect(await agents.symbol()).to.be.equal('FAgents');

            const AgentRegistry = await ethers.getContractFactory('AgentRegistry');
            agents = await upgrades.upgradeProxy(agents.address, AgentRegistry, {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await agents.connect(this.accounts.user1).disableAgent(AGENT_ID, 1);
            expect(await agents.getSubjectHandler()).to.be.equal(this.contracts.subjectGateway.address);
            expect(await agents.version()).to.be.equal('0.1.6');
            expect(await agents.isRegistered(AGENT_ID)).to.be.equal(true);
            expect(await agents.getDisableFlags(AGENT_ID)).to.be.equal([2]);
            expect(await agents.ownerOf(AGENT_ID)).to.be.equal(this.accounts.user1.address);
            expect(
                await agents.getAgent(AGENT_ID).then((agent) => [agent.agentVersion.toNumber(), agent.metadata, agent.chainIds.map((chainId) => chainId.toNumber())])
            ).to.be.deep.equal([1, args[2], args[3]]);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(false);
            await agents.connect(this.accounts.user1).enableAgent(AGENT_ID, 1);
            expect(await agents.getDisableFlags(AGENT_ID)).to.be.equal([0]);
            expect(await agents.connect(this.accounts.user1).isEnabled(AGENT_ID)).to.be.equal(true);
            expect(await agents.name()).to.be.equal('Forta Agents');
            expect(await agents.symbol()).to.be.equal('FAgents');
        });
    });

    describe('Scanner Registry', async function () {
        it(' 0.1.0 -> 0.1.4', async function () {
            this.accounts.getAccount('scanner');
            const ScannerRegistry_0_1_0 = await ethers.getContractFactory('ScannerRegistry_0_1_0');
            originalScanners = await upgrades.deployProxy(ScannerRegistry_0_1_0, [this.contracts.access.address, mockRouter.address, 'Forta Scanners', 'FScanners'], {
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

            const ScannerRegistry_0_1_2 = await ethers.getContractFactory('ScannerRegistry_0_1_2');
            let scannerRegistry = await upgrades.upgradeProxy(originalScanners.address, ScannerRegistry_0_1_2, {
                call: {
                    fn: 'setStakeController(address)',
                    args: [this.contracts.subjectGateway.address],
                },
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });
            await this.contracts.subjectGateway.setStakeSubject(0, scannerRegistry.address);
            await scannerRegistry.connect(this.accounts.manager).setStakeThreshold({ max: '100', min: '0', activated: true }, 1);

            await this.contracts.access.grantRole(this.roles.SCANNER_ADMIN, this.accounts.admin.address);
            expect(await scannerRegistry.getStakeController()).to.be.equal(this.contracts.subjectGateway.address);
            expect(await scannerRegistry.version()).to.be.equal('0.1.2');
            for (const scanner of SCANNERS) {
                const scannerId = scanner.address;
                expect(await scannerRegistry.isEnabled(scannerId)).to.be.equal(false);
                expect(await scannerRegistry.isManager(scannerId, this.accounts.user2.address)).to.be.equal(true);
                expect(await scannerRegistry.getManagerCount(scannerId)).to.be.equal(1);
                expect(await scannerRegistry.getManagerAt(scannerId, 0)).to.be.equal(this.accounts.user2.address);

                expect(await scannerRegistry.getScanner(scannerId).then((scanner) => [scanner.chainId.toNumber(), scanner.metadata])).to.be.deep.equal([chainId, '']);
                expect(
                    await scannerRegistry
                        .getScannerState(scannerId)
                        .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags.toNumber()])
                ).to.be.deep.equal([true, this.accounts.user1.address, chainId, '', false, 1]);

                expect(await scannerRegistry.isRegistered(scannerId)).to.be.equal(true);
                expect(await scannerRegistry.ownerOf(scannerId)).to.be.equal(this.accounts.user1.address);
                expect(await scannerRegistry.isEnabled(scannerId)).to.be.equal(false);

                await scannerRegistry.connect(this.accounts.admin).adminUpdate(scannerId, 55, 'metadata');
                expect(await scannerRegistry.getScanner(scannerId).then((scanner) => [scanner.chainId.toNumber(), scanner.metadata])).to.be.deep.equal([55, 'metadata']);
                chainId++;
            }

            chainId = 1;

            const NewImplementation = await ethers.getContractFactory('ScannerRegistry');
            scannerRegistry = await upgrades.upgradeProxy(originalScanners.address, NewImplementation, {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
                unsafeSkipStorageCheck: true,
            });
            await this.contracts.subjectGateway.setStakeSubject(0, scannerRegistry.address);
            await scannerRegistry.connect(this.accounts.manager).setStakeThreshold({ max: '100', min: '0', activated: true }, 1);
            const network = await this.accounts.user1.provider.getNetwork();

            await scannerRegistry
                .connect(this.accounts.admin)
                .configureMigration(loadEnv.MIGRATION_DURATION(network.chainId) + (await ethers.provider.getBlock('latest')).timestamp, this.contracts.scannerPools.address);
            await this.contracts.access.grantRole(this.roles.SCANNER_ADMIN, this.accounts.admin.address);
            expect(await scannerRegistry.getSubjectHandler()).to.be.equal(this.contracts.subjectGateway.address);
            expect(await scannerRegistry.version()).to.be.equal('0.1.4');
            for (const scanner of SCANNERS) {
                const scannerId = scanner.address;

                expect(await scannerRegistry.isEnabled(scannerId)).to.be.equal(false);
                expect(await scannerRegistry.isManager(scannerId, this.accounts.user2.address)).to.be.equal(true);
                expect(await scannerRegistry.getManagerCount(scannerId)).to.be.equal(1);
                expect(await scannerRegistry.getManagerAt(scannerId, 0)).to.be.equal(this.accounts.user2.address);

                expect(await scannerRegistry.getScanner(scannerId).then((scanner) => [scanner.chainId.toNumber(), scanner.metadata])).to.be.deep.equal([55, 'metadata']);
                expect(
                    await scannerRegistry
                        .getScannerState(scannerId)
                        .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags.toNumber()])
                ).to.be.deep.equal([true, this.accounts.user1.address, 55, 'metadata', false, 1]);
                expect(await scannerRegistry.isRegistered(scannerId)).to.be.equal(true);
                expect(await scannerRegistry.ownerOf(scannerId)).to.be.equal(this.accounts.user1.address);
                expect(await scannerRegistry.isEnabled(scannerId)).to.be.equal(false);

                chainId++;
            }
        });
    });

    describe('FortaStaking', async function () {
        it('0.1.0 -> 0.1.2', async function () {
            this.accounts.getAccount('scanner');
            const STAKING_PARAMS = { max: '1000', min: '100', activated: true };

            const DELAY = 123123;
            const TREASURY = await ethers.Wallet.createRandom().address;
            const FortaStaking_0_1_0 = await ethers.getContractFactory('FortaStaking_0_1_0');
            this.staking = await upgrades.deployProxy(FortaStaking_0_1_0, [this.access.address, mockRouter.address, this.token.address, DELAY, TREASURY], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await this.staking.deployed();

            const FortaStakingParameters_0_1_1 = await ethers.getContractFactory('FortaStakingParameters_0_1_1');
            this.subjectGateway = await upgrades.deployProxy(FortaStakingParameters_0_1_1, [this.access.address, mockRouter.address, this.staking.address], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await this.subjectGateway.deployed();
            const ScannerRegistry_0_1_3 = await ethers.getContractFactory('ScannerRegistry_0_1_3');
            // Router is deprecated, just set an address
            this.scanners = await upgrades.deployProxy(ScannerRegistry_0_1_3, [this.contracts.access.address, 'Forta Scanners', 'FScanners'], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await this.scanners.deployed();
            await this.subjectGateway.setStakeSubjectHandler(0, this.scanners.address);
            await this.subjectGateway.setStakeSubjectHandler(1, this.agents.address);
            await this.agents.connect(this.accounts.manager).setStakeThreshold(STAKING_PARAMS);
            await this.scanners.connect(this.accounts.manager).setStakeThreshold(STAKING_PARAMS, 1);

            this.access.connect(this.accounts.admin).grantRole(this.roles.SLASHER, this.accounts.admin.address),
            await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, ethers.utils.parseUnits('100000000', 'wei'), this.token.address);
            await contractHelpers.overwriteUserTokenBalance(this.accounts.user2.address, ethers.utils.parseUnits('100000000', 'wei'), this.token.address);
            await contractHelpers.overwriteUserTokenBalance(this.accounts.admin.address, ethers.utils.parseUnits('100000000', 'wei'), this.token.address);

            await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);
            await this.token.connect(this.accounts.user2).approve(this.staking.address, ethers.constants.MaxUint256);
            await this.token.connect(this.accounts.admin).approve(this.staking.address, ethers.constants.MaxUint256);

            await this.scanners.connect(this.accounts.scanner).register(this.accounts.user1.address, 1, 'Scanner Metadata');
            const AGENT_ID = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const args = [AGENT_ID, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
            await this.agents.createAgent(...args);

            await this.staking.setStakingParametersManager(this.subjectGateway.address);
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
            });

            const StakeSubjectGateway = await ethers.getContractFactory('StakeSubjectGateway');
            this.subjectGateway = await upgrades.upgradeProxy(this.subjectGateway.address, StakeSubjectGateway, {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
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

            const FortaStaking = await ethers.getContractFactory('FortaStaking');
            this.staking = await upgrades.upgradeProxy(this.staking.address, FortaStaking, {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            let i = 0;
            await this.staking.configureStakeHelpers(this.subjectGateway.address, this.stakeAllocator.address);
            await this.subjectGateway.setStakeSubject(2, this.scannerPools.address);
            await this.scannerPools.registerScannerPool(1);
            await this.access.grantRole(this.roles.STAKING_CONTRACT, this.staking.address);
            await this.staking.deposit(2, 1, '100');
            await this.staking.initiateWithdrawal(2, 1, '50');

            expect(await this.staking.subjectGateway()).to.be.equal(this.subjectGateway.address);

            expect(await this.staking.activeStakeFor(2, 1)).to.be.equal('50');
            // expect(await this.stakeAllocator.allocatedStakeFor(2, 1)).to.be.equal('50');

            expect(await this.staking.inactiveStakeFor(2, 1)).to.be.equal('50');

            expect(await this.staking.activeStakeFor(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.inactiveStakeFor(0, this.accounts.scanner.address)).to.be.equal('50');

            expect(await this.staking.sharesOf(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.inactiveSharesOf(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.totalShares(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.totalInactiveShares(0, this.accounts.scanner.address)).to.be.equal('50');
            expect(await this.staking.isFrozen(0, this.accounts.scanner.address)).to.be.equal(true);
            // expect(await this.staking.availableReward(0, this.accounts.scanner.address, this.accounts.user1.address)).to.be.equal('100');

            expect(await this.staking.activeStakeFor(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.inactiveStakeFor(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.sharesOf(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('50');
            expect(await this.staking.inactiveSharesOf(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('25');
            expect(await this.staking.totalShares(1, AGENT_ID)).to.be.equal('50');
            expect(await this.staking.totalInactiveShares(1, AGENT_ID)).to.be.equal('25');
            expect(await this.staking.isFrozen(1, AGENT_ID)).to.be.equal(false);
            // expect(await this.staking.availableReward(1, AGENT_ID, this.accounts.user1.address)).to.be.equal('200');

            expect(await this.staking.totalActiveStake()).to.be.equal('125');
            expect(await this.staking.totalInactiveStake()).to.be.equal('125');

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
