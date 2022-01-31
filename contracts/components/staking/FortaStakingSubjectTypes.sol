// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

uint8 constant SCANNER_SUBJECT = 0;
uint8 constant AGENT_SUBJECT = 1;

contract SubjectTypeValidator {

    modifier onlyValidSubjectType(uint8 subjectType) {
        require(
            subjectType == SCANNER_SUBJECT ||
            subjectType == AGENT_SUBJECT,
            "SubjectTypeValidator: invalid subjectType"
        );
        _;
    }
}
