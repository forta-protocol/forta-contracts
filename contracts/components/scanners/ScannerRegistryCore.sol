// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";

import "../BaseComponent.sol";

contract ScannerRegistryCore is
    BaseComponent,
    ERC721Upgradeable
{
    event ScannerUpdated(uint256 indexed scannerId, uint256 indexed chainId);

    modifier onlyOwnerOf(uint256 scannerId) {
        require(_msgSender() == ownerOf(scannerId), "Restricted to scanner owner");
        _;
    }

    function adminRegister(uint256 scannerId, address owner, uint256 chainId) public onlyRole(SCANNER_ADMIN_ROLE) {
        _mint(owner, scannerId);

        _beforeScannerUpdate(scannerId, chainId);
        _scannerUpdate(scannerId, chainId);
        _afterScannerUpdate(scannerId, chainId);
    }

    function register(address owner, uint256 chainId) public {
        uint256 scannerId = uint256(uint160(_msgSender()));
        _mint(owner, scannerId);

        _beforeScannerUpdate(scannerId, chainId);
        _scannerUpdate(scannerId, chainId);
        _afterScannerUpdate(scannerId, chainId);
    }

    /**
     * Hook: Scanner metadata change (create)
     */
    function _beforeScannerUpdate(uint256 scannerId, uint256 chainId) internal virtual {
    }

    function _scannerUpdate(uint256 scannerId, uint256 chainId) internal virtual {
        emit ScannerUpdated(scannerId, chainId);
    }

    function _afterScannerUpdate(uint256 scannerId, uint256 chainId) internal virtual {
        _emitHook(abi.encodeWithSignature("hook_afterScannerUpdate(uint256)", scannerId));
    }

    uint256[50] private __gap;
}