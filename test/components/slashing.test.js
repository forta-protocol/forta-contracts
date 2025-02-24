const { ethers } = require('hardhat');
const { parseEther, id } = ethers.utils;
const { expect } = require('chai');
const { prepare } = require('../fixture');
const { BigNumber } = require('ethers');
const contractHelpers = require('../../scripts/utils/contractHelpers');

const subjects = [
    { id: '1', type: 2 }, // ScannerPools id, ScannerPool type
    { id: ethers.BigNumber.from(ethers.utils.id('135a782d-c263-43bd-b70b-920873ed7e9d')), type: 1 }, // Agent id, agent type
];

const MAX_STAKE = parseEther('10000');
const MIN_STAKE = parseEther('100');
const STAKING_DEPOSIT = parseEther('1000');

let slashTreasuryAddress, proposerPercent;

const STATES = {
    UNDEFINED: BigNumber.from('0'),
    CREATED: BigNumber.from('1'),
    REJECTED: BigNumber.from('2'),
    DISMISSED: BigNumber.from('3'),
    IN_REVIEW: BigNumber.from('4'),
    REVIEWED: BigNumber.from('5'),
    EXECUTED: BigNumber.from('6'),
    REVERTED: BigNumber.from('7'),
};

const EVIDENCE_FOR_STATE = (state) => {
    switch (state) {
        case STATES.CREATED:
            return ['CREATED evidence', '2'];
        case STATES.REJECTED:
            return ['REJECTED evidence', '2'];
        case STATES.DISMISSED:
            return ['DISMISSED evidence', '2'];
        case STATES.REVIEWED:
            return ['REVIEWED evidence', '2'];
        case STATES.REVERTED:
            return ['REVERTED evidence', '2'];
        case STATES.IN_REVIEW:
            return ['IN_REVIEW evidence', 'modifying'];
        default:
            throw new Error(`No need of evidence for ${state.toString()}`);
    }
};

const PROPOSAL_ID = BigNumber.from('1');

describe('Slashing Proposals', function () {
    prepare({
        stake: {
            agents: { min: MIN_STAKE, max: MAX_STAKE, activated: true },
            scanners: { min: MIN_STAKE, max: MAX_STAKE, activated: true },
        },
    });

    beforeEach(async function () {
        await this.access.connect(this.accounts.admin).grantRole(this.roles.SLASHING_ARBITER, this.accounts.user3.address);
        await this.access.connect(this.accounts.admin).grantRole(this.roles.SLASHER, this.accounts.admin.address);

        await contractHelpers.overwriteUserTokenBalance(this.accounts.user1.address, parseEther('100000'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user2.address, parseEther('100000'), this.token.address);
        await contractHelpers.overwriteUserTokenBalance(this.accounts.user3.address, parseEther('100000'), this.token.address);

        await this.token.connect(this.accounts.user1).approve(this.slashing.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user2).approve(this.slashing.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user3).approve(this.slashing.address, ethers.constants.MaxUint256);

        await this.token.connect(this.accounts.user1).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user2).approve(this.staking.address, ethers.constants.MaxUint256);
        await this.token.connect(this.accounts.user3).approve(this.staking.address, ethers.constants.MaxUint256);

        const args = [subjects[1].id, this.accounts.user1.address, 'Metadata1', [1, 3, 4, 5]];
        await this.agents.connect(this.accounts.other).createAgent(...args);
        await this.scannerPools.connect(this.accounts.user2).registerScannerPool(1);

        await this.staking.connect(this.accounts.user2).deposit(2, '1', STAKING_DEPOSIT);
        await this.staking.connect(this.accounts.user2).deposit(1, subjects[1].id, STAKING_DEPOSIT);

        slashTreasuryAddress = await this.staking.treasury();
        proposerPercent = await this.slashing.slashPercentToProposer();
    });

    describe('Correct Proposal Lifecycle', function () {
        it('From CREATED to EXECUTED', async function () {
            const initialDepositorBalance = await this.token.balanceOf(this.accounts.user2.address);
            const initialTreasuryBalance = await this.token.balanceOf(slashTreasuryAddress);

            await expect(
                this.slashing
                    .connect(this.accounts.user2)
                    .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED))
            )
                .to.emit(this.slashing, 'SlashProposalUpdated')
                .withArgs(
                    this.accounts.user2.address,
                    PROPOSAL_ID,
                    STATES.CREATED,
                    this.accounts.user2.address,
                    subjects[0].id,
                    subjects[0].type,
                    this.slashParams.reasons.OPERATIONAL_SLASH
                )
                .to.emit(this.slashing, 'DepositSubmitted')
                .withArgs(PROPOSAL_ID, STAKING_DEPOSIT)
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.CREATED, EVIDENCE_FOR_STATE(STATES.CREATED))
                .to.emit(this.slashing, 'MachineCreated')
                .withArgs(PROPOSAL_ID, STATES.CREATED)
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.UNDEFINED, STATES.CREATED)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.accounts.user2.address, this.slashing.address, STAKING_DEPOSIT)
                .to.emit(this.staking, 'Froze')
                .withArgs(subjects[0].type, subjects[0].id, this.slashing.address, true);

            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(true);
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.sub(STAKING_DEPOSIT));
            expect(await this.token.balanceOf(this.slashing.address)).to.eq(STAKING_DEPOSIT);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.CREATED);

            await expect(this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'DepositReturned')
                .withArgs(PROPOSAL_ID, this.accounts.user2.address, STAKING_DEPOSIT)
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.CREATED, STATES.IN_REVIEW)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.slashing.address, this.accounts.user2.address, STAKING_DEPOSIT);

            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance);
            expect(await this.token.balanceOf(this.slashing.address)).to.eq(BigNumber.from('0'));
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.IN_REVIEW);

            await expect(this.slashing.connect(this.accounts.user3).markAsReviewedSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.IN_REVIEW, STATES.REVIEWED);

            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.REVIEWED);

            const slashedAmount = parseEther('15');
            const proposerShare = slashedAmount.mul(proposerPercent).div('100');
            const treasuryShare = slashedAmount.sub(proposerShare);

            await expect(this.slashing.connect(this.accounts.admin).executeSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.REVIEWED, STATES.EXECUTED)
                .to.emit(this.staking, 'Froze')
                .withArgs(subjects[0].type, subjects[0].id, this.slashing.address, false)
                .to.emit(this.staking, 'Slashed')
                .withArgs(subjects[0].type, subjects[0].id, this.slashing.address, parseEther('15'))
                .to.emit(this.token, 'Transfer')
                .withArgs(this.staking.address, slashTreasuryAddress, treasuryShare)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.staking.address, this.accounts.user2.address, proposerShare);
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.add(proposerShare));
            expect(await this.token.balanceOf(slashTreasuryAddress)).to.eq(initialTreasuryBalance.add(treasuryShare));
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(false);
        });

        it('From CREATED to EXECUTED, modifying the proposal', async function () {
            const initialDepositorBalance = await this.token.balanceOf(this.accounts.user2.address);
            const initialTreasuryBalance = await this.token.balanceOf(slashTreasuryAddress);

            this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.sub(STAKING_DEPOSIT));

            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);

            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance);
            expect(await this.token.balanceOf(this.slashing.address)).to.eq(BigNumber.from('0'));
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.IN_REVIEW);

            // Modifying
            const EVIDENCE_CHANGE_SUBJECT1 = ['EVIDENCE_CHANGE_SUBJECT1'];
            const EVIDENCE_CHANGE_SUBJECT2 = ['EVIDENCE_CHANGE_SUBJECT2'];
            // Subject

            const oldProposal = await this.slashing.proposals(PROPOSAL_ID);
            await expect(
                this.slashing
                    .connect(this.accounts.user3)
                    .reviewSlashProposalParameters(PROPOSAL_ID, subjects[1].type, subjects[1].id, oldProposal.penaltyId, EVIDENCE_CHANGE_SUBJECT1)
            )
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.IN_REVIEW, EVIDENCE_CHANGE_SUBJECT1)
                .to.emit(this.staking, 'Froze')
                .withArgs(subjects[0].type, subjects[0].id, this.slashing.address, false)
                .to.emit(this.staking, 'Froze')
                .withArgs(subjects[1].type, subjects[1].id, this.slashing.address, true)
                .to.emit(this.slashing, 'SlashProposalUpdated')
                .withArgs(
                    this.accounts.user3.address,
                    PROPOSAL_ID,
                    STATES.IN_REVIEW,
                    this.accounts.user2.address,
                    subjects[1].id,
                    subjects[1].type,
                    this.slashParams.reasons.OPERATIONAL_SLASH
                );
            const subject = await this.slashing.getSubject(PROPOSAL_ID);
            expect(subject.subjectType).to.eq(subjects[1].type);
            expect(subject.subject).to.eq(subjects[1].id);

            expect(await this.staking.isFrozen(subjects[1].type, subjects[1].id)).to.eq(true);
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(false);

            // Penalty
            await expect(
                this.slashing
                    .connect(this.accounts.user3)
                    .reviewSlashProposalParameters(PROPOSAL_ID, subjects[1].type, subjects[1].id, this.slashParams.reasons.MISCONDUCT_SLASH, EVIDENCE_CHANGE_SUBJECT2)
            )
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.IN_REVIEW, EVIDENCE_CHANGE_SUBJECT2)
                .to.emit(this.slashing, 'SlashProposalUpdated')
                .withArgs(
                    this.accounts.user3.address,
                    PROPOSAL_ID,
                    STATES.IN_REVIEW,
                    this.accounts.user2.address,
                    subjects[1].id,
                    subjects[1].type,
                    this.slashParams.reasons.MISCONDUCT_SLASH
                );

            const newProposal = await this.slashing.proposals(PROPOSAL_ID);
            expect(newProposal.penaltyId).to.eq(this.slashParams.reasons.MISCONDUCT_SLASH);

            // Continue
            await expect(this.slashing.connect(this.accounts.user3).markAsReviewedSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.IN_REVIEW, STATES.REVIEWED);

            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.REVIEWED);

            const slashedAmount = parseEther('900');
            const proposerShare = slashedAmount.mul(proposerPercent).div('100');
            const treasuryShare = slashedAmount.sub(proposerShare);

            await expect(this.slashing.connect(this.accounts.admin).executeSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.REVIEWED, STATES.EXECUTED)
                .to.emit(this.staking, 'Froze')
                .withArgs(subjects[1].type, subjects[1].id, this.slashing.address, false)
                .to.emit(this.staking, 'Slashed')
                .withArgs(subjects[1].type, subjects[1].id, this.slashing.address, parseEther('900'))
                .to.emit(this.token, 'Transfer')
                .withArgs(this.staking.address, slashTreasuryAddress, treasuryShare)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.staking.address, this.accounts.user2.address, proposerShare);
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.add(proposerShare));
            expect(await this.token.balanceOf(slashTreasuryAddress)).to.eq(initialTreasuryBalance.add(treasuryShare));
            expect(await this.staking.isFrozen(subjects[1].type, subjects[1].id)).to.eq(false);
        });

        it('From CREATED to REJECTED', async function () {
            const initialDepositorBalance = await this.token.balanceOf(this.accounts.user2.address);
            const initialTreasuryBalance = await this.token.balanceOf(slashTreasuryAddress);

            await expect(
                this.slashing
                    .connect(this.accounts.user2)
                    .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED))
            )
                .to.emit(this.slashing, 'SlashProposalUpdated')
                .withArgs(
                    this.accounts.user2.address,
                    PROPOSAL_ID,
                    STATES.CREATED,
                    this.accounts.user2.address,
                    subjects[0].id,
                    subjects[0].type,
                    this.slashParams.reasons.OPERATIONAL_SLASH
                )
                .to.emit(this.slashing, 'DepositSubmitted')
                .withArgs(PROPOSAL_ID, this.accounts.user2.address, STAKING_DEPOSIT)
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.CREATED, EVIDENCE_FOR_STATE(STATES.CREATED))
                .to.emit(this.slashing, 'MachineCreated')
                .withArgs(PROPOSAL_ID, STATES.CREATED)
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.UNDEFINED, STATES.CREATED)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.accounts.user2.address, this.slashing.address, STAKING_DEPOSIT)
                .to.emit(this.staking, 'Froze')
                .withArgs(subjects[0].type, subjects[0].id, this.slashing.address, true);

            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(true);
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.sub(STAKING_DEPOSIT));
            expect(await this.token.balanceOf(this.slashing.address)).to.eq(STAKING_DEPOSIT);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.CREATED);

            await expect(this.slashing.connect(this.accounts.user3).rejectSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.REJECTED)))
                .to.emit(this.slashing, 'DepositSlashed')
                .withArgs(PROPOSAL_ID, this.accounts.user2.address, STAKING_DEPOSIT)
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.CREATED, STATES.REJECTED)
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.REJECTED, EVIDENCE_FOR_STATE(STATES.REJECTED))
                .to.emit(this.token, 'Transfer')
                .withArgs(this.slashing.address, slashTreasuryAddress, STAKING_DEPOSIT);

            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.sub(STAKING_DEPOSIT));
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.REJECTED);
            expect(await this.token.balanceOf(slashTreasuryAddress)).to.eq(initialTreasuryBalance.add(STAKING_DEPOSIT));
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(false);
        });

        it('From CREATED to DISMISSED', async function () {
            const initialDepositorBalance = await this.token.balanceOf(this.accounts.user2.address);
            const initialTreasuryBalance = await this.token.balanceOf(slashTreasuryAddress);

            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));

            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(true);
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.sub(STAKING_DEPOSIT));
            expect(await this.token.balanceOf(this.slashing.address)).to.eq(STAKING_DEPOSIT);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.CREATED);

            await expect(this.slashing.connect(this.accounts.user3).dismissSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.DISMISSED)))
                .to.emit(this.slashing, 'DepositReturned')
                .withArgs(PROPOSAL_ID, this.accounts.user2.address, STAKING_DEPOSIT)
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.CREATED, STATES.DISMISSED)
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.DISMISSED, EVIDENCE_FOR_STATE(STATES.DISMISSED))
                .to.emit(this.token, 'Transfer')
                .withArgs(this.slashing.address, this.accounts.user2.address, STAKING_DEPOSIT);

            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.DISMISSED);
            expect(await this.token.balanceOf(slashTreasuryAddress)).to.eq(initialTreasuryBalance);
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(false);
        });

        it('From CREATED to REVERTED by Arbiter', async function () {
            const initialDepositorBalance = await this.token.balanceOf(this.accounts.user2.address);
            const initialTreasuryBalance = await this.token.balanceOf(slashTreasuryAddress);

            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));

            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(true);
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.sub(STAKING_DEPOSIT));
            expect(await this.token.balanceOf(this.slashing.address)).to.eq(STAKING_DEPOSIT);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.CREATED);

            await expect(this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'DepositReturned')
                .withArgs(PROPOSAL_ID, this.accounts.user2.address, STAKING_DEPOSIT)
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.CREATED, STATES.IN_REVIEW)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.slashing.address, this.accounts.user2.address, STAKING_DEPOSIT);

            await expect(this.slashing.connect(this.accounts.user3).revertSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.REVERTED)))
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.IN_REVIEW, STATES.REVERTED)
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.REVERTED, EVIDENCE_FOR_STATE(STATES.REVERTED));

            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.REVERTED);
            expect(await this.token.balanceOf(slashTreasuryAddress)).to.eq(initialTreasuryBalance);
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(false);
        });

        it('From CREATED to REVERTED by Slasher', async function () {
            const initialDepositorBalance = await this.token.balanceOf(this.accounts.user2.address);
            const initialTreasuryBalance = await this.token.balanceOf(slashTreasuryAddress);

            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));

            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(true);
            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance.sub(STAKING_DEPOSIT));
            expect(await this.token.balanceOf(this.slashing.address)).to.eq(STAKING_DEPOSIT);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.CREATED);

            await expect(this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'DepositReturned')
                .withArgs(PROPOSAL_ID, this.accounts.user2.address, STAKING_DEPOSIT)
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.CREATED, STATES.IN_REVIEW)
                .to.emit(this.token, 'Transfer')
                .withArgs(this.slashing.address, this.accounts.user2.address, STAKING_DEPOSIT);

            await expect(this.slashing.connect(this.accounts.user3).markAsReviewedSlashProposal(PROPOSAL_ID))
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.IN_REVIEW, STATES.REVIEWED);

            await expect(this.slashing.connect(this.accounts.admin).revertSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.REVERTED)))
                .to.emit(this.slashing, 'StateTransition')
                .withArgs(PROPOSAL_ID, STATES.REVIEWED, STATES.REVERTED)
                .to.emit(this.slashing, 'EvidenceSubmitted')
                .withArgs(PROPOSAL_ID, STATES.REVERTED, EVIDENCE_FOR_STATE(STATES.REVERTED));

            expect(await this.token.balanceOf(this.accounts.user2.address)).to.eq(initialDepositorBalance);
            expect(await this.slashing.currentState(PROPOSAL_ID)).to.eq(STATES.REVERTED);
            expect(await this.token.balanceOf(slashTreasuryAddress)).to.eq(initialTreasuryBalance);
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(false);
        });
    });
    describe('State configuration', function () {
        it('should not have incorrect state transtions', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await expect(this.slashing.connect(this.accounts.user3).markAsReviewedSlashProposal(PROPOSAL_ID)).to.be.revertedWith(`InvalidStateTransition(1, 5)`);
        });
    });

    describe('Proposal lifecycle wrong auths', function () {
        it('should not move from CREATED if not authorized', async function () {
            this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await expect(this.slashing.connect(this.accounts.user2).markAsInReviewSlashProposal(PROPOSAL_ID)).to.be.revertedWith(
                `MissingRole("${id('SLASHING_ARBITER_ROLE')}", "${this.accounts.user2.address}")`
            );
            await expect(this.slashing.connect(this.accounts.user2).dismissSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.DISMISSED))).to.be.revertedWith(
                `MissingRole("${id('SLASHING_ARBITER_ROLE')}", "${this.accounts.user2.address}")`
            );
            await expect(this.slashing.connect(this.accounts.user2).rejectSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.REJECTED))).to.be.revertedWith(
                `MissingRole("${id('SLASHING_ARBITER_ROLE')}", "${this.accounts.user2.address}")`
            );
        });

        it('should not move from IN_REVIEW if not authorized', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);
            await expect(this.slashing.connect(this.accounts.user2).markAsReviewedSlashProposal(PROPOSAL_ID)).to.be.revertedWith(
                `MissingRole("${id('SLASHING_ARBITER_ROLE')}", "${this.accounts.user2.address}")`
            );
            await expect(this.slashing.connect(this.accounts.user2).revertSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.REVERTED))).to.be.revertedWith(
                `MissingRole("${id('SLASHING_ARBITER_ROLE')}", "${this.accounts.user2.address}")`
            );
        });

        it('should not move from REVIEWED if not authorized', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);
            await this.slashing.connect(this.accounts.user3).markAsReviewedSlashProposal(PROPOSAL_ID);
            await expect(this.slashing.connect(this.accounts.user2).executeSlashProposal(PROPOSAL_ID)).to.be.revertedWith(
                `MissingRole("${id('SLASHER_ROLE')}", "${this.accounts.user2.address}")`
            );
            await expect(this.slashing.connect(this.accounts.user2).revertSlashProposal(PROPOSAL_ID, EVIDENCE_FOR_STATE(STATES.REVERTED))).to.be.revertedWith(
                `MissingRole("${id('SLASHER_ROLE')}", "${this.accounts.user2.address}")`
            );
        });
    });

    describe('Proposal creation conditions', function () {
        it('should not propose if proposer does not have deposit', async function () {
            await this.token.connect(this.accounts.user2).transfer(this.accounts.user3.address, await this.token.balanceOf(this.accounts.user2.address));
            await expect(
                this.slashing
                    .connect(this.accounts.user2)
                    .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED))
            ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        });

        it('should not propose if subject is not registered', async function () {
            await expect(
                this.slashing
                    .connect(this.accounts.user2)
                    .proposeSlash(subjects[1].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED))
            ).to.be.revertedWith('NonRegisteredSubject');
        });

        it('should not propose if proposal has empty evidence', async function () {
            await expect(
                this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, [])
            ).to.be.revertedWith('ZeroAmount("evidence length")');
        });

        it('should not propose if proposal if evidence string too large', async function () {
            const longString = new Array(201).fill('+').reduce((prev, next) => prev + next, '');
            await expect(
                this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, [longString])
            ).to.be.revertedWith('StringTooLarge(201, 200)');
        });

        it('should not propose if proposal if evidence string too large', async function () {
            await expect(
                this.slashing
                    .connect(this.accounts.user2)
                    .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, ['1', '2', '3', '4', '5', '6'])
            ).to.be.revertedWith('ArrayTooBig(6, 5)');
        });

        it('should not propose if proposal has invalid subject type', async function () {
            await expect(
                this.slashing.connect(this.accounts.user2).proposeSlash(123, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED))
            ).to.be.revertedWith('InvalidSubjectType');
        });
    });

    describe('Review modification conditions', function () {
        it('should not modify if proposal nonexistent', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);
            await expect(
                this.slashing
                    .connect(this.accounts.user3)
                    .reviewSlashProposalParameters('2', subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.IN_REVIEW))
            ).to.be.revertedWith('InvalidState(4)');
        });

        it('should not modify if not in state', async function () {
            await expect(
                this.slashing
                    .connect(this.accounts.user3)
                    .reviewSlashProposalParameters(PROPOSAL_ID, subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.IN_REVIEW))
            ).to.be.revertedWith('InvalidState(4)');
        });

        it('should not modify if subject is not registered', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);
            await expect(
                this.slashing
                    .connect(this.accounts.user3)
                    .reviewSlashProposalParameters(PROPOSAL_ID, subjects[1].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.IN_REVIEW))
            ).to.be.revertedWith('NonRegisteredSubject');
        });
        it('should not modify if caller is not authorized', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);
            await expect(
                this.slashing
                    .connect(this.accounts.user2)
                    .reviewSlashProposalParameters(PROPOSAL_ID, subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.IN_REVIEW))
            ).to.be.revertedWith(`MissingRole("${id('SLASHING_ARBITER_ROLE')}", "${this.accounts.user2.address}")`);
        });

        it('should not modify if proposal has empty evidence', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.IN_REVIEW));
            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);
            await expect(
                this.slashing
                    .connect(this.accounts.user3)
                    .reviewSlashProposalParameters(PROPOSAL_ID, subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, [])
            ).to.be.revertedWith('ZeroAmount("evidence length")');
        });

        it('should not modify if proposal has invalid subject type', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.IN_REVIEW));
            await this.slashing.connect(this.accounts.user3).markAsInReviewSlashProposal(PROPOSAL_ID);
            await expect(
                this.slashing
                    .connect(this.accounts.user3)
                    .reviewSlashProposalParameters(PROPOSAL_ID, 65, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.IN_REVIEW))
            ).to.be.revertedWith('InvalidSubjectType');
        });
    });
    describe('Proposal dismissal conditions', function () {
        it('should not dismiss without evidence', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await expect(this.slashing.connect(this.accounts.user3).dismissSlashProposal(PROPOSAL_ID, [])).to.be.revertedWith('ZeroAmount("evidence length")');
        });
    });
    describe('Proposal rejection conditions', function () {
        it('should not reject without evidence', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));

            await expect(this.slashing.connect(this.accounts.user3).rejectSlashProposal(PROPOSAL_ID, [])).to.be.revertedWith('ZeroAmount("evidence length")');
        });
    });

    describe('Proposal revert conditions', function () {
        it('should not revert without evidence', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));

            await expect(this.slashing.connect(this.accounts.user3).dismissSlashProposal(PROPOSAL_ID, [])).to.be.revertedWith('ZeroAmount("evidence length")');
        });
    });
    describe('Slashing amounts', function () {
        beforeEach(async function () {
            const slashReasons = [ethers.utils.id('MIN_STAKE'), ethers.utils.id('MAX_POSSIBLE'), ethers.utils.id('CURRENT_STAKE')];
            const slashPenalties = [
                { mode: this.slashParams.penaltyModes.MIN_STAKE, percentSlashed: '10' },
                { mode: this.slashParams.penaltyModes.CURRENT_STAKE, percentSlashed: '95' },
                { mode: this.slashParams.penaltyModes.CURRENT_STAKE, percentSlashed: '30' },
            ];
            await this.slashing.connect(this.accounts.admin).setSlashPenalties(slashReasons, slashPenalties);
        });

        it('min stake', async function () {
            // All active stake
            await this.staking.connect(this.accounts.user2).deposit(subjects[1].type, subjects[1].id, STAKING_DEPOSIT);
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[1].type, subjects[1].id, ethers.utils.id('MIN_STAKE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('1')).to.eq(MIN_STAKE.mul('10').div('100'));
            await this.slashing.connect(this.accounts.user3).dismissSlashProposal('1', EVIDENCE_FOR_STATE(STATES.DISMISSED));

            // Mix active and inactive stake
            await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjects[1].type, subjects[1].id, MIN_STAKE.div(2));
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[1].type, subjects[1].id, ethers.utils.id('MIN_STAKE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('2')).to.eq(MIN_STAKE.mul('10').div('100'));
            await this.slashing.connect(this.accounts.user3).dismissSlashProposal('2', EVIDENCE_FOR_STATE(STATES.DISMISSED));

            // All inactive stake
            await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjects[1].type, subjects[1].id, MIN_STAKE.div(2));
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[1].type, subjects[1].id, ethers.utils.id('MIN_STAKE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('3')).to.eq(MIN_STAKE.mul('10').div('100'));
        });

        it('max possible stake', async function () {
            const maxSlashableStakePercent = await this.staking.MAX_SLASHABLE_PERCENT();
            const totalStake = await this.subjectGateway.totalStakeFor(subjects[0].type, subjects[0].id);
            const maxSlashable = totalStake.mul(maxSlashableStakePercent).div('100');

            // All active stake
            await this.staking.connect(this.accounts.user2).deposit(subjects[1].type, subjects[1].id, MIN_STAKE);
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, ethers.utils.id('MAX_POSSIBLE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('1')).to.eq(maxSlashable);
            await this.slashing.connect(this.accounts.user3).dismissSlashProposal('1', EVIDENCE_FOR_STATE(STATES.DISMISSED));

            // Mix active and inactive stake
            await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjects[1].type, subjects[1].id, MIN_STAKE.div(2));
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, ethers.utils.id('MAX_POSSIBLE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('2')).to.eq(maxSlashable);
            await this.slashing.connect(this.accounts.user3).dismissSlashProposal('2', EVIDENCE_FOR_STATE(STATES.DISMISSED));

            // All inactive stake
            await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjects[1].type, subjects[1].id, MIN_STAKE.div(2));
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, ethers.utils.id('MAX_POSSIBLE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('3')).to.eq(maxSlashable.toString());
        });

        it('current stake', async function () {
            // All active stake
            await this.staking.connect(this.accounts.user2).deposit(subjects[1].type, subjects[1].id, STAKING_DEPOSIT);
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, ethers.utils.id('CURRENT_STAKE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('1')).to.eq(STAKING_DEPOSIT.mul('30').div('100'));
            await this.slashing.connect(this.accounts.user3).dismissSlashProposal('1', EVIDENCE_FOR_STATE(STATES.DISMISSED));

            // Mix active and inactive stake
            await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjects[1].type, subjects[1].id, STAKING_DEPOSIT.div(2));
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, ethers.utils.id('CURRENT_STAKE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('2')).to.eq(STAKING_DEPOSIT.mul('30').div('100'));
            await this.slashing.connect(this.accounts.user3).dismissSlashProposal('2', EVIDENCE_FOR_STATE(STATES.DISMISSED));

            // All inactive stake
            await this.staking.connect(this.accounts.user2).initiateWithdrawal(subjects[1].type, subjects[1].id, STAKING_DEPOSIT.div(2));
            await this.slashing.connect(this.accounts.user2).proposeSlash(subjects[0].type, subjects[0].id, ethers.utils.id('CURRENT_STAKE'), EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.slashing.getSlashedStakeValue('3')).to.eq(STAKING_DEPOSIT.mul('30').div('100'));
        });
    });

    describe('Multiple slashing proposals', function () {
        it('a subject should not be unfrozen if it has active slash proposals', async function () {
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            await this.slashing
                .connect(this.accounts.user2)
                .proposeSlash(subjects[0].type, subjects[0].id, this.slashParams.reasons.OPERATIONAL_SLASH, EVIDENCE_FOR_STATE(STATES.CREATED));
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(true);
            await expect(this.slashing.connect(this.accounts.user3).dismissSlashProposal(1, EVIDENCE_FOR_STATE(STATES.DISMISSED)));
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(true);
            await expect(this.slashing.connect(this.accounts.user3).dismissSlashProposal(2, EVIDENCE_FOR_STATE(STATES.DISMISSED)));
            expect(await this.staking.isFrozen(subjects[0].type, subjects[0].id)).to.eq(false);
        });
    });
});
