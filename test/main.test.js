const { ethers, upgrades } = require('hardhat');
const { expect } = require('chai');
const { prepare, attach, deploy, deployUpgradeable } = require('./fixture');

describe('Fortify', function () {
  prepare();

  it('check deployment', async function () {
    expect(await this.token.hasRole(this.roles.UPGRADER,    this.accounts.upgrader.address));
    expect(await this.token.hasRole(this.roles.MINTER,      this.accounts.minter.address));
    expect(await this.token.hasRole(this.roles.WHITELISTER, this.accounts.whitelister.address));
  });

  describe('spread whitelist', function () {
    it('not authorized', async function () {
      await expect(this.token.connect(this.accounts.whitelist).grantWhitelister(this.accounts.other.address))
        .to.be.revertedWith(`AccessControl: account ${this.accounts.whitelist.address.toLowerCase()} is missing role ${this.roles.WHITELISTER}`);
    });

    it('authorized', async function () {
      await expect(this.token.connect(this.accounts.whitelister).grantWhitelister(this.accounts.other.address))
        .to.emit(this.token, 'RoleGranted')
        .withArgs(this.roles.WHITELISTER, this.accounts.other.address, this.token.address);
    });
  });

  describe('mint', function () {
    describe('non-authorized', function () {
      it('to non-whitelisted', async function () {
        await expect(this.token.connect(this.accounts.whitelister).mint(this.accounts.nonwhitelist.address, 1))
          .to.be.revertedWith(`AccessControl: account ${this.accounts.whitelister.address.toLowerCase()} is missing role ${this.roles.MINTER}`);
      });

      it('to whitelisted', async function () {
        await expect(this.token.connect(this.accounts.whitelister).mint(this.accounts.whitelist.address, 1))
          .to.be.revertedWith(`AccessControl: account ${this.accounts.whitelister.address.toLowerCase()} is missing role ${this.roles.MINTER}`);
      });
    });

    describe('non-authorized', function () {
      it('to non-whitelisted', async function () {
        await expect(this.token.connect(this.accounts.minter).mint(this.accounts.nonwhitelist.address, 1))
          .to.be.revertedWith(`Fortify: receiver is not whitelisted`);
      });

      it('to whitelisted', async function () {
        await expect(this.token.connect(this.accounts.minter).mint(this.accounts.whitelist.address, 1))
          .to.emit(this.token, 'Transfer')
          .withArgs(ethers.constants.AddressZero, this.accounts.whitelist.address, 1);
      });
    });
  });

});
