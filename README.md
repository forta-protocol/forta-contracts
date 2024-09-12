![image](https://user-images.githubusercontent.com/2632384/162202240-f42f201a-7871-442d-af51-9e5e8b5ddbe4.png)

# Forta Network Contracts

Smart Contracts of the [Forta Network](https://forta.org/)
This repo uses Hardhat as a development environment.

## What is Forta?

Forta is a decentralized, community-based monitoring network to detect threats and anomalies on DeFi, NFT, governance, bridges and other Web3 systems in real-time.

Given timely and relevant alerts about the security and health of owned or dependent systems, protocols and investors can react quickly to neutralize threats and prevent or minimize loss of funds.

Forta comprises a decentralized network of independent node operators that scan all transactions and block-by-block state changes for outlier transactions and threats. When an issue is detected, node operators send alerts to subscribers of potential risks, which enables them to take action

Leveraging Forta, developers can build detection bots and machine learning models, and run them on the decentralized Forta network to uncover anomalous activity on every blockchain transaction.

The contracts coordinate and govern Forta Network's Detection Bots (formerly Agents) and Scanner Pools.

# Contracts

## FORT token

- [Folder](https://github.com/forta-network/forta-contracts/tree/master/contracts/token)

FORT is the ERC-20 Token of the Forta Network. It acts as:
- Governance token (see our [path to decentralization](https://forta.org/blog/decentralizing-governance/))
- Network security mechanism via staking and slashing on participating subjects (Bots and Scanner Nodes).
- Network rewards.

FORT is deployed on Ethereum Mainnet and bridged to Polygon using [Polygon's PoS Bridge](https://docs.polygon.technology/docs/develop/ethereum-polygon/pos/getting-started/).

## Agent Registry (Bot registry)

- [Folder](https://github.com/forta-network/forta-contracts/tree/master/contracts/components/agents)

Contract responsible of Agent registration, updates, enabling, disabling and defining the Staking Threshold for agents.
Agents are identified by `uint256(keccak256(UUIDv4))`
Compliant with ERC-721 standard.

## Scanner Node Registry (in deprecation)

- [Folder](https://github.com/forta-network/forta-contracts/tree/master/contracts/components/scanners)

Contract responsible of Scanner Node registration, updates, enabling, disabling and defining the Staking Threshold for Scanner Nodes.
Scanners are identified by their EOA Address casted to `uint256`
Compliant with ERC-721 standard.

## Scanner Pool Registry
- [Folder](https://github.com/forta-network/forta-contracts/tree/master/contracts/components/scanner_pools)

A Scan
Contract responsible of Scanner Pool crNode registration, updates, enabling, disabling and defining the Staking Threshold for Scanner Nodes.
Scanners are identified by their EOA Address casted to `uint256`
Compliant with ERC-721 standard.

## Dispatch

- [Folder](https://github.com/forta-network/forta-contracts/blob/master/contracts/components/dispatch/Dispatch.sol)

Register of the assignments of Agents and Scanners, governed by the Assigner Software (off chain).

## Staking

- [Folder](https://github.com/forta-network/forta-contracts/tree/master/contracts/components/staking)

Contract handling staking of FORT tokens on subjects (participant of the network), slashing and reward distribution.
Deposited stake is represented by ERC-1155 shares, for active and inactive (withdrawal initiated, non-transferrable) stake.
Share ID is derived from the subject type, subject ID and it being active or inactive.

These contracts handle stake delegation for Scanner Pools and reward distribution between pool owner and delegators.

## ScannerNodeVersion

- [Folder](https://github.com/forta-network/forta-contracts/blob/master/contracts/components/scanners/ScannerNodeVersion.sol)

Holds the accepted Scanner Node software image IPFS hash. A change in the version will trigger Scanner Node autoupdate. New versions will be proposed by governance.

## Utils

### AccessManager

- [File](https://github.com/forta-network/forta-contracts/blob/master/contracts/components/access/AccessManager.sol)

[Access Control](https://docs.openzeppelin.com/contracts/4.x/api/access#AccessControl) Singleton for all contracts except Token and VestingWallets

### Forwarder

- [File](https://github.com/forta-network/forta-contracts/blob/master/contracts/components/metatx/Forwarder.sol)

Meta tx contract, based on the [Permit Singleton](https://github.com/amxx/permit).

## Vesting

### VestingWallet

- [Folder](https://github.com/forta-network/forta-contracts/tree/master/contracts/vesting)

Vesting contracts. Can bridge tokens to Polygon to a `StakingEscrow` contract destination so they can participate on staking.

### StakingEscrow

- [Folder](https://github.com/forta-network/forta-contracts/tree/master/contracts/vesting/escrow)

Contracts that allow vested token holders to stake on `FortaStaking`

# Audits

[Openzeppelin](https://github.com/forta-network/forta-contracts/blob/readme/audits/Forta%20Audit%20-%20Shared%20Report.pdf)

# Development



## Contract Versioning.

- Interface implementations previously deployed are under `_old` folders, for upgrade testing.
- Contracts no longer in use are under `_deprecated` folder.

## Testing

```
yarn
npm run test
```

## Querying the contracts

You can query a network deployment with the help of the `./scripts/releases/deployments/<network_id>.json` files and using ethers to attach contract factories to addresses.
There is a helper function to automate this process from console or scripts called `loadEnv()`

Example:

```
npx hardhat --network <network name from hardhat.config.js> console
> const e = require('./scripts/loadEnv')
> const d = await e.loadEnv()
> await d.contracts.scannerPool.ownerOf('1')
```

## Deployments

Deployment addresses are listed in `scripts/.cache-<chainID>.json`

### Latest versions (to test:)
To deploy the platform's contracts last version, as used by the tests (except `ScannerNodeVersion`):

`npx hardhat run --network <network> scripts/deployments/deploy-platform.js`

To see debug logs, we are using [debug package](https://www.npmjs.com/package/debug)

`DEBUG=* npx hardhat run --network <network> scripts/deploy-platform.js`

### Release process:

Read our [docs for our CI/CD contracts pipeline](https://github.com/forta-network/forta-contracts/blob/master/DEPLOYMENT_AND_ADMIN_ACTIONS.md) using Github Actions and [Openzeppelin Defender](https://docs.openzeppelin.com/defender/admin-api-reference).

Implemented by [Raúl Martínez](https://github.com/Ramarti) Based in the concept repo by [Santiago Palladino](https://github.com/spalladino/sample-contract-deploy-pipeline)

### Trigger admin actions:

Also covered in the [above pipeline!](https://github.com/forta-network/forta-contracts/blob/master/DEPLOYMENT_AND_ADMIN_ACTIONS.md)

## Development of upgrades.

This network is under active development, [so most of the components are `UUPSUpgradeable`](https://forum.openzeppelin.com/t/uups-proxies-tutorial-solidity-javascript/7786) and new implementations are deployed from time to time.

Upgrading a contract is a process with risk, storage layout collision might happen.
We follow good practices for [writing upgradeable contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable), using storage __gaps to "reserve" 50 storage slots per contract initially.
The process to develop, test and deploy new implementations are as follow:

1. Ensure that the contract inherits from `IVersioned` (if it is `BaseControllerUpgradeable` it will).
2. Bump the version accordingly. Contract versioning should follow semver and increment with each upgrade or deployment.
3. Develop according to good practices, modify __gap length to accommodate new state, add comments with storage accounting in contract variables and __gap values.
4. Write an upgradeability test in `test/components/upgrades.test.js`.
    1. Deploy an upgradeable proxy with the base implementation, found in `components/_old/<component_folder>/<ComponentName>_X_Y_Z`. 
        If not there, either:
        - Use `hardhat flatten` to generate a file with all the inheriting contracts.
        - Remove duplicate licenses and pragma statements.
        - Rename main component in flattened file to `<ComponentName>_X_Y_Z`.
        - If the contracts is deployed and the repo is not tagged and you are not sure if the exact files are in the current commit, generate a flattened version obtained from verified contracts in relevant block explorer (Etherscan, Polyscan...) and add it.
    2. Initialize all the state of the contract, assert the values are there.
    3. Upgrade to the new implementation
    4. Check the output from `upgrades-plugin`, if there is any problems fix them. Check the plugin [docs and faqs](https://docs.openzeppelin.com/upgrades-plugins/1.x/faq) if needed.
    5. Assert the values of the state have not changed.
5. Execute the script `scripts/storageToTable` to print a markdown table of the before and after implementations 
    - You may need to execute `test/components/upgrades.test.js` with `it.only(<relevant_test>)` so both old and new implementations are present in `.openzeppelin/unknown-31337.json`. Delete delete `.openzeppelin/unknown-31337.json` before executing the test so `storageToTable` finds the correct implementations.
6. Visualize and assert that the sum of the storage reserved is the same before and after, and that the new gaps are adjusted correctly. If the test in 4.5 passes this is probably correct, if that test fails, something will not add up.
7. Write a script to deploy the upgrade and execute the initializing methods needed.
8. Add a flattened version of the deployed implementation to `components/_old/<component_folder>/<ComponentName>_X_Y_Z`.


## Exporting ABIs for software that does not support custom errors.

Forta contracts use [Solidity's Custom Errors](https://blog.soliditylang.org/2021/04/21/custom-errors/) instead of `require(<test>, '<Error String>')`.

Some other parts of the system do not support this feature in ABIs yet. To generate compatible ABIs:

1. Compile contracts
2. `npx hardhat run scripts/abis-without-custom-errors.js`
3. Check `.abis-no-errors` folder.


## Mint and bridge TEST FORT L1 -> L2
1. Open `scripts/matic/enter.js` and edit `AMOUNT` to set the FORT to mint and bridge
2. `npx hardhat run --network goerli scripts/matic/enter.js`
3. Eventually, Polygon PoS Bridge will send the tokens to your wallet. It may take a while (10+ mins).
4. To stake, call `deposit(uint8 subjectType, uint256 subject, uint256 stakeValue)` in `FortaStaking` instance (check `scripts/.cache-80001.json -> staking -> address`)


## Bug Bounty

We have a [bug bounty program on Immunefi](https://immunefi.com/bounty/forta). Please report any security issues you find through the Immunefi dashboard, or reach out to [tech@forta.org](mailto:tech@forta.org)
