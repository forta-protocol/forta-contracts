const hre = require('hardhat');
const ethers = hre.ethers;
const migrate = require('../scripts/deployments/platform');
const contractHelpers = require('../scripts/utils/contractHelpers');
const DEBUG = require('debug')('forta:migration');

function prepare(config = {}) {
    before(async function () {
        // list signers
        this.accounts = await ethers.getSigners();
        this.accounts.getAccount = (name) => this.accounts[name] || (this.accounts[name] = this.accounts.shift());
        ['admin', 'manager', 'minter', 'treasure', 'user1', 'user2', 'user3', 'other'].map((name) => this.accounts.getAccount(name));

        // migrate
        await migrate(
            Object.assign({
                force: true,
                deployer: this.accounts.admin,
                childChainManagerProxy: config.adminAsChildChainManagerProxy && this.accounts.admin.address,
                childChain: config.childChain ?? true,
            })
        ).then((env) => Object.assign(this, env));
        DEBUG('Fixture: migrated');

        // mock contracts
        this.contracts.sink = await contractHelpers.deploy(hre, 'Sink');
        this.contracts.otherToken = await contractHelpers.deployUpgradeable(hre, 'Forta', 'uups', [this.deployer.address]);
        DEBUG('Fixture: mock contracts');

        // Set admin as default signer for all contracts
        Object.assign(this, this.contracts);

        // setup roles
        await Promise.all(
            [
                this.staking.connect(this.accounts.admin).setTreasury(this.accounts.treasure.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.ENS_MANAGER, this.accounts.admin.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.UPGRADER, this.accounts.admin.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.AGENT_ADMIN, this.accounts.manager.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.SCANNER_ADMIN, this.accounts.manager.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.SCANNER_POOL_ADMIN, this.accounts.manager.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.DISPATCHER, this.accounts.manager.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.REWARDER, this.accounts.manager.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.SCANNER_VERSION, this.accounts.admin.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.SCANNER_BETA_VERSION, this.accounts.admin.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.SLASHER, this.contracts.slashing.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.STAKING_ADMIN, this.accounts.admin.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.STAKING_CONTRACT, this.contracts.staking.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.ALLOCATOR_CONTRACT, this.contracts.stakeAllocator.address),
                this.access.connect(this.accounts.admin).grantRole(this.roles.MIGRATION_EXECUTOR, this.accounts.manager.address),
            ].map((txPromise) => txPromise.then((tx) => tx.wait()).catch(() => {}))
        );

        DEBUG('Fixture: setup roles');

        // Prep for tests that need minimum stake
        if (config.stake) {
            if (!config.adminAsChildChainManagerProxy) {
                await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, ethers.utils.parseEther('10000'), this.token.address);
            }
            this.accounts.staker = this.accounts.user1;
            await this.token.connect(this.accounts.staker).approve(this.staking.address, ethers.constants.MaxUint256);
            this.stakingSubjects = {};
            this.stakingSubjects.SCANNER = 0;
            this.stakingSubjects.AGENT = 1;
            this.stakingSubjects.SCANNER_POOL = 2;
            this.stakingSubjects.UNDEFINED = 255;
            this.subjectAgency = {};
            this.subjectAgency.UNDEFINED = 0;
            this.subjectAgency.DIRECT = 1;
            this.subjectAgency.DELEGATED = 2;
            this.subjectAgency.DELEGATOR = 3;
            this.subjectAgency.MANAGED = 4;

            if (config.stake.agents) {
                await this.agents
                    .connect(this.accounts.manager)
                    .setStakeThreshold({ max: config.stake.agents.max, min: config.stake.agents.min, activated: config.stake.agents.activated });
            }
            if (config.stake.scanners) {
                // DEPRECATION NOTICE: scanners
                await this.scanners
                    .connect(this.accounts.manager)
                    .setStakeThreshold({ max: config.stake.scanners.max, min: config.stake.scanners.min, activated: config.stake.scanners.activated }, 1);
                await this.scannerPools
                    .connect(this.accounts.manager)
                    .setManagedStakeThreshold({ max: config.stake.scanners.max, min: config.stake.scanners.min, activated: config.stake.scanners.activated }, 1);
            }

            DEBUG('Fixture: stake configured');
        }

        // Increase time to after migration
        await ethers.provider.send('evm_setNextBlockTimestamp', [(await this.scanners.sunsettingTime()).toNumber() + 1]);
        await ethers.provider.send('evm_mine');

        // eslint-disable-next-line no-undef
        __SNAPSHOT_ID__ = await ethers.provider.send('evm_snapshot');
    });

    beforeEach(async function () {
        // eslint-disable-next-line no-undef
        await ethers.provider.send('evm_revert', [__SNAPSHOT_ID__]);
        // eslint-disable-next-line no-undef
        __SNAPSHOT_ID__ = await ethers.provider.send('evm_snapshot');
    });
}

module.exports = {
    prepare,
    getFactory: contractHelpers.getFactory,
    attach: contractHelpers.attach,
    deploy: contractHelpers.deploy,
    deployUpgradeable: contractHelpers.deployUpgradeable,
    performUpgrade: contractHelpers.performUpgrade,
};
