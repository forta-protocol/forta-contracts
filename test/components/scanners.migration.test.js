const { ethers, upgrades } = require('hardhat');
const { expect } = require('chai');
const { prepare } = require('../fixture');
const { BigNumber } = require('ethers');
const contractHelpers = require('../../scripts/utils/contractHelpers');

describe('Scanner Registry (Deprecation and migration)', function () {
    prepare();
    let SCANNERS;
    const chainId = 1;
    it('upgrade: deprecated implementation keeps storage', async function () {
        this.accounts.getAccount('scanner');

        const ScannerRegistry_0_1_3 = await ethers.getContractFactory('ScannerRegistry_0_1_3');
        this.scanners = await upgrades.deployProxy(ScannerRegistry_0_1_3, [this.contracts.access.address, 'Forta Scanners', 'FScanners'], {
            kind: 'uups',
            constructorArgs: [this.contracts.forwarder.address],
            unsafeAllow: ['delegatecall'],
        });
        await this.scanners.deployed();
        await this.scanners.connect(this.accounts.manager).setStakeThreshold({ min: '0', max: '500', activated: true }, chainId);
        const SCANNERS = [this.accounts.scanner, this.accounts.user1, this.accounts.user3];

        for (let i = 0; i < SCANNERS.length; i++) {
            const scannerId = SCANNERS[i].address;
            await this.scanners.connect(SCANNERS[i]).register(this.accounts.user1.address, chainId, `metadata-${i}`);
            await this.scanners.connect(this.accounts.user1).setManager(scannerId, this.accounts.user2.address, true);
            const mustDisable = i === SCANNERS.length - 1;
            const disabledFlags = mustDisable ? 1 : 0;
            if (mustDisable) {
                await this.scanners.connect(this.accounts.manager).disableScanner(scannerId, 0);
            }
            expect(await this.scanners.isEnabled(scannerId)).to.be.equal(!mustDisable);

            expect(await this.scanners.isManager(scannerId, this.accounts.user2.address)).to.be.equal(true);
            expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(1);
            expect(await this.scanners.getManagerAt(scannerId, 0)).to.be.equal(this.accounts.user2.address);
            expect(
                await this.scanners
                    .getScannerState(scannerId)
                    .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags.toNumber()])
            ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-${i}`, !mustDisable, disabledFlags]);
            expect(await this.scanners.isRegistered(scannerId)).to.be.equal(true);
            expect(await this.scanners.ownerOf(scannerId)).to.be.equal(this.accounts.user1.address);
        }

        this.scanners = await upgrades.upgradeProxy(this.scanners.address, await ethers.getContractFactory('ScannerRegistry'), {
            constructorArgs: [this.contracts.forwarder.address],
            unsafeAllow: ['delegatecall'],
            call: {
                fn: 'configureMigration(uint256, address)',
                args: [(await this.contracts.scanners.sunsettingTime()).toNumber() + 5000, await this.scannerPools.address],
            },
        });

        for (let i = 0; i < SCANNERS.length; i++) {
            const disabled = i === SCANNERS.length - 1;
            const scannerId = SCANNERS[i].address;

            expect(await this.scanners.isManager(scannerId, this.accounts.user2.address)).to.be.equal(true);
            expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(1);
            expect(await this.scanners.getManagerAt(scannerId, 0)).to.be.equal(this.accounts.user2.address);
            expect(
                await this.scanners
                    .getScannerState(scannerId)
                    .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags.toNumber()])
            ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-${i}`, !disabled, disabled ? 1 : 0]);
            expect(await this.scanners.isRegistered(scannerId)).to.be.equal(true);
            expect(await this.scanners.ownerOf(scannerId)).to.be.equal(this.accounts.user1.address);
            expect(await this.scanners.isEnabled(scannerId)).to.be.equal(!disabled);
        }
    });

    describe('Migration', () => {
        beforeEach(async function () {
            this.accounts.getAccount('scanner');

            const ScannerRegistry_0_1_3 = await ethers.getContractFactory('ScannerRegistry_0_1_3');
            this.scanners = await upgrades.deployProxy(ScannerRegistry_0_1_3, [this.contracts.access.address, 'Forta Scanners', 'FScanners'], {
                kind: 'uups',
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            await this.scanners.deployed();
            await this.subjectGateway.connect(this.accounts.admin).setStakeSubject(0, this.scanners.address);
            await this.scanners.connect(this.accounts.manager).setStakeThreshold({ min: '0', max: '500', activated: true }, chainId);
            await this.scannerPools.connect(this.accounts.manager).setManagedStakeThreshold({ min: '0', max: '500', activated: true }, chainId);
            await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, ethers.utils.parseEther('10000'), this.token.address);
            await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);

            SCANNERS = [this.accounts.scanner, this.accounts.user1, this.accounts.user2, this.accounts.user3, this.accounts.other];
            for (let i = 0; i < SCANNERS.length; i++) {
                await this.scanners.connect(SCANNERS[i]).register(this.accounts.user1.address, chainId, `metadata-${i}`);
                // TODO: test this with previous version of Staking (to enable deposit of SCANNER)
                // await this.staking.connect(this.accounts.user1).deposit(0, SCANNERS[i].address, '1000');
                // await this.staking.connect(this.accounts.user1).initiateWithdrawal(0, SCANNERS[i].address, '200');
            }
            // First scanner will be migrated as disabled
            await this.scanners.connect(SCANNERS[0]).disableScanner(SCANNERS[0].address, 1);

            const NewImplementation = await ethers.getContractFactory('ScannerRegistry');
            this.scanners = await upgrades.upgradeProxy(this.scanners.address, NewImplementation, {
                constructorArgs: [this.contracts.forwarder.address],
                unsafeAllow: ['delegatecall'],
            });
            const { timestamp } = await this.accounts.user1.provider.getBlock('latest');
            await this.scanners.connect(this.accounts.admin).configureMigration(timestamp + 5000, await this.scannerPools.address);
            // last scanner won't be migrated
            await this.scanners.connect(this.accounts.user1).setMigrationPrefrence(SCANNERS[SCANNERS.length - 1].address, true);

            const deployer = (await ethers.getSigners())[0];

            const ScannerToScannerPoolMigration = await ethers.getContractFactory('ScannerToScannerPoolMigration', deployer);
            this.registryMigration = await upgrades.deployProxy(ScannerToScannerPoolMigration, [this.access.address], {
                kind: 'uups',
                constructorArgs: [this.forwarder.address, this.scanners.address, this.scannerPools.address, this.staking.address],
                unsafeAllow: 'delegatecall',
            });

            this.access.connect(this.accounts.admin).grantRole(this.roles.SCANNER_2_SCANNER_POOL_MIGRATOR, this.registryMigration.address);
        });

        it('should not burn ScannerNodeRegistry without SCANNER_2_SCANNER_POOL_MIGRATOR_ROLE', async function () {
            await expect(this.scanners.connect(this.accounts.user1).deregisterScannerNode(SCANNERS[0].address)).to.be.revertedWith(
                `MissingRole("${this.roles.SCANNER_2_SCANNER_POOL_MIGRATOR}", "${this.accounts.user1.address}")`
            );
        });

        describe('migrate scanners - privileged path', function () {
            it('non-registered ScannerPool - 1 opted out scanner', async function () {
                const inputScannerPoolId = await this.registryMigration.SCANNER_POOL_NOT_MIGRATED();
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);

                await expect(
                    this.registryMigration.connect(this.accounts.manager).migrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        this.accounts.user1.address,
                        chainId
                    )
                )
                    .to.emit(this.registryMigration, 'MigrationExecuted')
                    .withArgs(4, 1, 1, true);
                let scannerPoolId = 1;
                expect(await this.scannerPools.balanceOf(this.accounts.user1.address)).to.eq(1);
                expect(await this.scannerPools.isRegistered(scannerPoolId)).to.eq(true);
                expect(await this.scannerPools.ownerOf(1)).to.eq(this.accounts.user1.address);
                expect(await this.scannerPools.totalScannersRegistered(1)).to.eq(SCANNERS.length - 1);
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(1);

                for (let i = 0; i < SCANNERS.length - 1; i++) {
                    const disabled = i === 0;
                    const scannerId = SCANNERS[i].address;
                    expect(await this.scanners.isRegistered(scannerId)).to.be.equal(false);
                    expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);
                    expect(
                        await this.scannerPools
                            .getScannerState(scannerId)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-${i}`, !disabled, disabled]);
                    expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(true);
                    expect(await this.scannerPools.isScannerRegisteredTo(scannerId, scannerPoolId)).to.be.equal(true);
                    expect(await this.scannerPools.registeredScannerAddressAtIndex(scannerPoolId, i)).to.be.equal(scannerId);
                    expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(disabled);
                    /*
                    expect(await this.staking.sharesOf(0, scannerId, this.accounts.user1.address)).to.be.equal(0);
                    expect(await this.staking.activeStakeFor(0, scannerId)).to.be.equal(0);
                    expect(await this.staking.inactiveSharesOf(0, scannerId, this.accounts.user1.address)).to.be.equal('200');
                    expect(await this.staking.inactiveStakeFor(0, scannerId)).to.be.equal(200);

                    expect(await this.staking.sharesOf(2, 1, this.accounts.user1.address)).to.be.equal(800 * 4);
                    expect(await this.staking.activeStakeFor(2, 1)).to.be.equal(800 * 4);
                    expect(await this.staking.inactiveSharesOf(2, 1, this.accounts.user1.address)).to.be.equal('0');
                    expect(await this.staking.inactiveStakeFor(2, 1)).to.be.equal(0);
                    */
                }
                const scannerId = SCANNERS[SCANNERS.length - 1].address;
                expect(await this.scanners.isRegistered(scannerId)).to.be.equal(true);
                expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);

                expect(
                    await this.scannerPools
                        .getScannerState(scannerId)
                        .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                ).to.be.deep.equal([false, ethers.constants.AddressZero, 0, ``, false, false]);

                expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(false);
                expect(await this.scannerPools.isScannerRegisteredTo(scannerId, 1)).to.be.equal(false);
                expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(false);
            });

            it('registered ScannerPool - 1 disabled scanner', async function () {
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);
                await this.scannerPools.connect(this.accounts.user1).registerScannerPool(chainId);
                const inputScannerPoolId = 1;
                await expect(
                    this.registryMigration.connect(this.accounts.manager).migrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        this.accounts.user1.address,
                        chainId
                    )
                )
                    .to.emit(this.registryMigration, 'MigrationExecuted')
                    .withArgs(4, 1, 1, false);
                let scannerPoolId = 1;
                expect(await this.scannerPools.balanceOf(this.accounts.user1.address)).to.eq(1);
                expect(await this.scannerPools.isRegistered(scannerPoolId)).to.eq(true);
                expect(await this.scannerPools.ownerOf(1)).to.eq(this.accounts.user1.address);
                expect(await this.scannerPools.totalScannersRegistered(1)).to.eq(SCANNERS.length - 1);
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(1);

                for (let i = 0; i < SCANNERS.length - 1; i++) {
                    const scannerId = SCANNERS[i].address;
                    const disabled = i === 0;

                    expect(await this.scanners.isRegistered(scannerId)).to.be.equal(false);
                    expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);
                    expect(
                        await this.scannerPools
                            .getScannerState(scannerId)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-${i}`, !disabled, disabled]);
                    expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(true);
                    expect(await this.scannerPools.isScannerRegisteredTo(scannerId, scannerPoolId)).to.be.equal(true);
                    expect(await this.scannerPools.registeredScannerAddressAtIndex(scannerPoolId, i)).to.be.equal(scannerId);
                    expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(disabled);
                    /*
                    expect(await this.staking.sharesOf(0, scannerId, this.accounts.user1.address)).to.be.equal(0);
                    expect(await this.staking.activeStakeFor(0, scannerId)).to.be.equal(0);
                    expect(await this.staking.inactiveSharesOf(0, scannerId, this.accounts.user1.address)).to.be.equal('200');
                    expect(await this.staking.inactiveStakeFor(0, scannerId)).to.be.equal(200);

                    expect(await this.staking.sharesOf(2, 1, this.accounts.user1.address)).to.be.equal(800 * 4);
                    expect(await this.staking.activeStakeFor(2, 1)).to.be.equal(800 * 4);
                    expect(await this.staking.inactiveSharesOf(2, 1, this.accounts.user1.address)).to.be.equal('0');
                    expect(await this.staking.inactiveStakeFor(2, 1)).to.be.equal(0);
                    */
                }
                const scannerId = SCANNERS[SCANNERS.length - 1].address;
                expect(await this.scanners.isRegistered(scannerId)).to.be.equal(true);
                expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);

                expect(
                    await this.scannerPools
                        .getScannerState(scannerId)
                        .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                ).to.be.deep.equal([false, ethers.constants.AddressZero, 0, ``, false, false]);

                expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(false);
                expect(await this.scannerPools.isScannerRegisteredTo(scannerId, 1)).to.be.equal(false);
                expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(false);
            });

            it('should not migrate if not MIGRATION_EXECUTOR_ROLE', async function () {
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);
                await this.scannerPools.connect(this.accounts.user1).registerScannerPool(chainId);
                const inputScannerPoolId = 1;
                await expect(
                    this.registryMigration.connect(this.accounts.user1).migrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        this.accounts.user1.address,
                        chainId
                    )
                ).to.be.revertedWith(`MissingRole("${this.roles.MIGRATION_EXECUTOR}", "${this.accounts.user1.address}")`);
            });

            it('should not migrate if not owner of the scanners', async function () {
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);
                await this.scannerPools.connect(this.accounts.user2).registerScannerPool(chainId);
                const inputScannerPoolId = 1;
                await expect(
                    this.registryMigration.connect(this.accounts.manager).migrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        this.accounts.user2.address,
                        chainId
                    )
                ).to.be.revertedWith(`SenderNotOwner("${this.accounts.user2.address}", 201990263407130541861732429012178345511141645967)`);
            });

            it('should not migrate if not owner of ScannerPool', async function () {
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);
                await this.scannerPools.connect(this.accounts.user2).registerScannerPool(chainId);
                const inputScannerPoolId = 1;
                await expect(
                    this.registryMigration.connect(this.accounts.manager).migrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        this.accounts.user1.address,
                        chainId
                    )
                ).to.be.revertedWith(`NotOwnerOfScannerPool("${this.accounts.user1.address}", ${inputScannerPoolId})`);
            });
        });

        describe('migrate scanners - self migration path', function () {
            it('non-registered ScannerPool - 1 disabled scanner', async function () {
                const inputScannerPoolId = await this.registryMigration.SCANNER_POOL_NOT_MIGRATED();
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);

                await expect(
                    this.registryMigration.connect(this.accounts.user1).selfMigrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        chainId
                    )
                )
                    .to.emit(this.registryMigration, 'MigrationExecuted')
                    .withArgs(4, 1, 1, true);
                let scannerPoolId = 1;
                expect(await this.scannerPools.balanceOf(this.accounts.user1.address)).to.eq(1);
                expect(await this.scannerPools.isRegistered(scannerPoolId)).to.eq(true);
                expect(await this.scannerPools.ownerOf(1)).to.eq(this.accounts.user1.address);
                expect(await this.scannerPools.totalScannersRegistered(1)).to.eq(SCANNERS.length - 1);
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(1);

                for (let i = 0; i < SCANNERS.length - 1; i++) {
                    const scannerId = SCANNERS[i].address;
                    const disabled = i === 0;
                    expect(await this.scanners.isRegistered(scannerId)).to.be.equal(false);
                    expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);
                    expect(
                        await this.scannerPools
                            .getScannerState(scannerId)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-${i}`, !disabled, disabled]);
                    expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(true);
                    expect(await this.scannerPools.isScannerRegisteredTo(scannerId, scannerPoolId)).to.be.equal(true);
                    expect(await this.scannerPools.registeredScannerAddressAtIndex(scannerPoolId, i)).to.be.equal(scannerId);
                    expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(disabled);
                }
                const scannerId = SCANNERS[SCANNERS.length - 1].address;
                expect(await this.scanners.isRegistered(scannerId)).to.be.equal(true);
                expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);

                expect(
                    await this.scannerPools
                        .getScannerState(scannerId)
                        .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                ).to.be.deep.equal([false, ethers.constants.AddressZero, 0, ``, false, false]);

                expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(false);
                expect(await this.scannerPools.isScannerRegisteredTo(scannerId, 1)).to.be.equal(false);
                expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(false);
            });

            it('registered ScannerPool - 1 disabled scanner', async function () {
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);
                await this.scannerPools.connect(this.accounts.user1).registerScannerPool(chainId);
                const inputScannerPoolId = 1;
                await expect(
                    this.registryMigration.connect(this.accounts.user1).selfMigrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        chainId
                    )
                )
                    .to.emit(this.registryMigration, 'MigrationExecuted')
                    .withArgs(4, 1, 1, false);
                let scannerPoolId = 1;
                expect(await this.scannerPools.balanceOf(this.accounts.user1.address)).to.eq(1);
                expect(await this.scannerPools.isRegistered(scannerPoolId)).to.eq(true);
                expect(await this.scannerPools.ownerOf(1)).to.eq(this.accounts.user1.address);
                expect(await this.scannerPools.totalScannersRegistered(1)).to.eq(SCANNERS.length - 1);
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(1);

                for (let i = 0; i < SCANNERS.length - 1; i++) {
                    const scannerId = SCANNERS[i].address;
                    const disabled = i === 0;
                    expect(await this.scanners.isRegistered(scannerId)).to.be.equal(false);
                    expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);
                    expect(
                        await this.scannerPools
                            .getScannerState(scannerId)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-${i}`, !disabled, disabled]);
                    expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(true);
                    expect(await this.scannerPools.isScannerRegisteredTo(scannerId, scannerPoolId)).to.be.equal(true);
                    expect(await this.scannerPools.registeredScannerAddressAtIndex(scannerPoolId, i)).to.be.equal(scannerId);
                    expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(disabled);
                }
                const scannerId = SCANNERS[SCANNERS.length - 1].address;
                expect(await this.scanners.isRegistered(scannerId)).to.be.equal(true);
                expect(await this.scanners.getManagerCount(scannerId)).to.be.equal(0);

                expect(
                    await this.scannerPools
                        .getScannerState(scannerId)
                        .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.operational, scanner.disabled])
                ).to.be.deep.equal([false, ethers.constants.AddressZero, 0, ``, false, false]);

                expect(await this.scannerPools.isScannerRegistered(scannerId)).to.be.equal(false);
                expect(await this.scannerPools.isScannerRegisteredTo(scannerId, 1)).to.be.equal(false);
                expect(await this.scannerPools.isScannerDisabled(scannerId)).to.be.equal(false);
            });

            it('should not migrate if not owner of the scanners', async function () {
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);
                await this.scannerPools.connect(this.accounts.user2).registerScannerPool(chainId);
                const inputScannerPoolId = 1;
                await expect(
                    this.registryMigration.connect(this.accounts.user2).selfMigrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        chainId
                    )
                ).to.be.revertedWith(`SenderNotOwner("${this.accounts.user2.address}", 201990263407130541861732429012178345511141645967)`);
            });

            it('should not migrate if not owner of ScannerPool', async function () {
                expect(await this.scanners.balanceOf(this.accounts.user1.address)).to.eq(SCANNERS.length);
                await this.scannerPools.connect(this.accounts.user2).registerScannerPool(chainId);
                const inputScannerPoolId = 1;
                await expect(
                    this.registryMigration.connect(this.accounts.user1).selfMigrate(
                        SCANNERS.map((x) => x.address),
                        inputScannerPoolId,
                        chainId
                    )
                ).to.be.revertedWith(`NotOwnerOfScannerPool("${this.accounts.user1.address}", ${inputScannerPoolId})`);
            });
        });

        describe('ScannerNodeRegistry migration data source', function () {
            let nonMigrated, migrated;
            beforeEach(async function () {
                nonMigrated = SCANNERS[SCANNERS.length - 1].address;
                migrated = SCANNERS[1].address;
                const inputScannerPoolId = await this.registryMigration.SCANNER_POOL_NOT_MIGRATED();

                await this.registryMigration.connect(this.accounts.manager).migrate(
                    SCANNERS.map((x) => x.address),
                    inputScannerPoolId,
                    this.accounts.user1.address,
                    1
                );

                await this.scannerPools.connect(this.accounts.user1).updateScannerMetadata(migrated, 'migrated');
                await this.scannerPools.connect(this.accounts.user1).disableScanner(migrated);
            });

            describe('should return correct data', function () {
                it('during migration', async function () {
                    expect(await this.scanners.isEnabled(nonMigrated)).to.equal(true);
                    expect(await this.scanners.isEnabled(migrated)).to.equal(false);

                    expect(
                        await this.scanners.getScanner(nonMigrated).then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-4`]);
                    expect(
                        await this.scanners
                            .getScannerState(nonMigrated)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-4`, true, BigNumber.from(0)]);
                    expect(
                        await this.scanners.getScanner(migrated).then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `migrated`]);
                    expect(
                        await this.scanners
                            .getScannerState(migrated)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `migrated`, false, BigNumber.from(1)]);
                });

                it('after migration ends', async function () {
                    await ethers.provider.send('evm_setNextBlockTimestamp', [(await this.scanners.sunsettingTime()).toNumber() + 1]);
                    await ethers.provider.send('evm_mine');

                    expect(await this.scanners.isEnabled(nonMigrated)).to.equal(false);
                    expect(await this.scanners.isEnabled(migrated)).to.equal(false);

                    expect(
                        await this.scanners.getScanner(nonMigrated).then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-4`]);
                    expect(
                        await this.scanners
                            .getScannerState(nonMigrated)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `metadata-4`, false, BigNumber.from(0)]);
                    expect(
                        await this.scanners.getScanner(migrated).then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `migrated`]);
                    expect(
                        await this.scanners
                            .getScannerState(migrated)
                            .then((scanner) => [scanner.registered, scanner.owner, scanner.chainId.toNumber(), scanner.metadata, scanner.enabled, scanner.disabledFlags])
                    ).to.be.deep.equal([true, this.accounts.user1.address, chainId, `migrated`, false, BigNumber.from(1)]);
                });
            });
        });
    });
});
