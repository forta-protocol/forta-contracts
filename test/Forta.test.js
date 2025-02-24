const { ethers } = require('hardhat');
const { expect } = require('chai');
const { prepare } = require('./fixture');

describe('Forta', function () {
    prepare({ mainnet: true });

    it('check deployment', async function () {
        expect(await this.token.hasRole(this.roles.ADMIN, this.accounts.admin.address));
        expect(await this.token.hasRole(this.roles.MINTER, this.accounts.minter.address));
    });

    it('returns correct version', async function () {
        currentVersion = '0.2.1';
        expect(await this.token.version()).to.be.equal(currentVersion)
    });

    // Skipped since removing forwarder/metatx functionality
    describe.skip('mint', function () {
        describe('non-authorized', function () {
            it('should not mint', async function () {
                await expect(this.token.connect(this.accounts.user1).mint(this.accounts.user1.address, 1)).to.be.revertedWith(
                    `AccessControl: account ${this.accounts.user1.address.toLowerCase()} is missing role ${this.roles.MINTER}`
                );
            });
        });

        describe('authorized', function () {
            it('should mint', async function () {
                await expect(this.token.connect(this.accounts.minter).mint(this.accounts.user1.address, 1))
                    .to.emit(this.token, 'Transfer')
                    .withArgs(ethers.constants.AddressZero, this.accounts.user1.address, 1);
            });

            it('should not mint over max', async function () {
                const maxPlusOne = ethers.utils.parseEther('1000000001');
                await expect(this.token.connect(this.accounts.minter).mint(this.accounts.user1.address, maxPlusOne)).to.be.revertedWith('MintingMoreThanSupply');
            });
        });
    });
});
