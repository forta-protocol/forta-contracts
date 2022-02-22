// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

error ZeroAddress(string name);
error ZeroAmount(string name);
error EmptyArray(string name);
error UnorderedArray(string name);

error SenderNotOwner(address sender, uint256 ownedId);

error StakedUnderMinimum(uint256 subject);

error DoesNotHavePermission(address sender, uint8 permission, uint256 id);