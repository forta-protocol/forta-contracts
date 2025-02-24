const { NonceManager } = require('@ethersproject/experimental');
const DEBUG = require('debug')('forta:utils');
const process = require('process');
const { kebabizeContractName } = require('./stringUtils');

// override process.env with dotenv
Object.assign(process.env, require('dotenv').config().parsed);

const getDefaultProvider = async (hre, baseProvider, feeData = {}) => {
    if (!baseProvider) {
        baseProvider = hre.ethers.provider;
    }
    const DEFAULT_FEE_DATA = {
        maxFeePerGas: hre.ethers.utils.parseUnits('400', 'gwei'),
        maxPriorityFeePerGas: hre.ethers.utils.parseUnits('20', 'gwei'),
    };
    const provider = new hre.ethers.providers.FallbackProvider([baseProvider], 1);
    provider.getFeeData = () => Promise.resolve(Object.assign(DEFAULT_FEE_DATA, feeData));
    return provider;
};

const getDefaultDeployer = async (hre, provider, networkName, noHardhat) => {
    let mnemonic;
    // TODO: Fix approach to fetching Polygon mainnet mnemonic

    if (networkName === 'Polygon Mainnet') {
        // first, try to match with polygon mainnet name
        mnemonic = process.env[`POLYGON_MNEMONIC`];
        console.log(`POLYGON_MNEMONIC`);
    } else if (!networkName && !noHardhat) {
        // if no network name is specified and hardhat should be used, use the default mnemonic
        mnemonic = 'test test test test test test test test test test test junk';
    } else {
        // finally, just try to deduce from the network name
        mnemonic = process.env[`${networkName.toUpperCase()}_MNEMONIC`];
        console.log(`${networkName.toUpperCase()}_MNEMONIC`);
    }
    const baseDeployer = hre.ethers.Wallet.fromMnemonic(mnemonic);
    const deployer = new NonceManager(baseDeployer).connect(provider);
    await deployer.getTransactionCount().then((nonce) => deployer.setTransactionCount(nonce));
    deployer.address = await deployer.getAddress();
    return deployer;
};

/*********************************************************************************************************************
 *                                                Blockchain helpers                                                 *
 *********************************************************************************************************************/

function getFactory(hre, name) {
    return hre.ethers.getContractFactory(name);
}

function attach(hre, factory, address) {
    return (typeof factory === 'string' ? getFactory(hre, factory) : Promise.resolve(factory)).then((contract) => contract.attach(address));
}

function deploy(hre, factory, params = []) {
    return (typeof factory === 'string' ? getFactory(hre, factory) : Promise.resolve(factory)).then((contract) => contract.deploy(...params)).then((f) => f.deployed());
}

function deployUpgradeable(hre, factory, kind, params = [], opts = {}) {
    return (typeof factory === 'string' ? getFactory(hre, factory) : Promise.resolve(factory))
        .then((contract) => hre.upgrades.deployProxy(contract, params, { kind, ...opts }))
        .then((f) => f.deployed());
}

async function performUpgrade(hre, proxy, contractName, opts = {}) {
    let contract = await getFactory(hre, contractName);
    const afterUpgradeContract = await hre.upgrades.upgradeProxy(proxy.address, contract, opts);
    return afterUpgradeContract;
}

async function proposeUpgrade(hre, contractName, opts = {}, cache) {
    const proxyAddress = await cache.get(`${kebabizeContractName(contractName)}.address`);
    const proposal = await hre.defender.proposeUpgrade(proxyAddress, contractName, opts);
    return proposal.url;
}

async function tryFetchContract(hre, contractName, args = [], cache) {
    const contract = await hre.ethers.getContractFactory(contractName);
    const key = kebabizeContractName(contractName);
    const deployed = await resumeOrDeploy(hre, cache, key, () => contract.deploy(...args)).then((address) => contract.attach(address));
    return deployed;
}

async function tryFetchProxy(hre, contractName, kind = 'uups', args = [], opts = {}, cache) {
    let contract = await hre.ethers.getContractFactory(contractName);
    const key = kebabizeContractName(contractName);
    const deployed = await resumeOrDeploy(hre, cache, key, () => hre.upgrades.deployProxy(contract, args, { kind, ...opts })).then((address) => contract.attach(address));
    return deployed;
}

async function getContractVersion(hre, contract, deployParams = {}) {
    if (contract) {
        try {
            return contract['version'] ? await contract.version() : '0.0.0';
        } catch (e) {
            // Version not introduced in deployed contract yet
            return '0.0.0';
        }
    } else if (deployParams.address && deployParams.provider) {
        try {
            const abi = `[{"inputs": [],"name": "version","outputs": [{"internalType": "string","name": "","type": "string"}],"stateMutability": "view","type": "function"}]`;
            const versioned = new hre.ethers.Contract(deployParams.address, JSON.parse(abi), deployParams.provider);
            return await versioned.version();
        } catch (e) {
            console.log(e);
            // Version not introduced in source code yet
            return '0.0.0';
        }
    }
    throw new Error(`Cannot get contract version for ${contract} or ${deployParams}. Provide contract object or deployParams`);
}

async function resumeOrDeploy(hre, cache, key, deploy) {
    let txHash = await cache?.get(`${key}-deploy-tx`);
    let address = await cache?.get(`${key}.address`);
    DEBUG('resumeOrDeploy', key, txHash, address);

    if (!txHash && !address) {
        const contract = await deploy();
        txHash = contract.deployTransaction.hash;
        DEBUG('Saving pending...', txHash);
        await cache?.set(`${key}-deploy-tx`, txHash);
        await contract.deployed();
        address = contract.address;
    } else if (!address) {
        address = await hre.ethers.provider
            .getTransaction(txHash)
            .then((tx) => tx.wait())
            .then((receipt) => receipt.contractAddress);
    }
    await cache?.set(`${key}.address`, address);
    return address;
}

const getBlockExplorerDomain = (hre) => {
    const network = hre.network.name;
    switch (network) {
        case 'mainnet':
            return 'etherscan.io';
        case 'goerli':
            return `${network}.etherscan.io`;
        case 'polygon':
        case 'matic':
            return 'polygonscan.com';
        case 'mumbai':
            return 'mumbai.polygonscan.com';
        case 'amoy':
            return 'www.oklink.com/amoy';
        case 'sepolia':
            return 'sepolia.etherscan.io';
        case 'basesepolia':
            return 'sepolia.basescan.org'
    }
};

// Minting workaround, due `mint()` removal
// Manually overwrite token balance of `userAddress` to `tokenAmount`
async function overwriteUserTokenBalance(userAddress, tokenAmount, tokenAddress) {
    // To derive `balancesMappingStorageSlot`:
    // 1. Run `cat artifacts/build-info/*.json | jq '.output.contracts."contracts/token/Forta.sol".Forta.storageLayout'`
    // 2. Look for the { "label": "_balances" , "slot": <value> } (i.e. `_balances` mapping)
    // 3. Set `balancesMappingStorageSlot` equal to the value for `"slot"`
    const balancesMappingStorageSlot = 151;
    // Compute the slot for `userAddress` specific `_balances` entry:
    // keccak256(abi.encode(address, mappingSlot))
    const userBalanceSlotKey = (new ethers.utils.AbiCoder()).encode(
        ["address", "uint256"],
        [userAddress, balancesMappingStorageSlot]
    );
    const userBalanceStorageSlot = ethers.utils.keccak256(userBalanceSlotKey);
    const tokenAmountInHex = ethers.utils.hexValue(tokenAmount);

    await network.provider.send("hardhat_setStorageAt", [
        tokenAddress,
        userBalanceStorageSlot,
        ethers.utils.hexZeroPad(tokenAmountInHex, 32),
    ]);
}

module.exports = {
    getDefaultProvider,
    getDefaultDeployer,
    getFactory,
    attach,
    deploy,
    deployUpgradeable,
    performUpgrade,
    proposeUpgrade,
    tryFetchContract,
    tryFetchProxy,
    getContractVersion,
    getBlockExplorerDomain,
    overwriteUserTokenBalance
};
