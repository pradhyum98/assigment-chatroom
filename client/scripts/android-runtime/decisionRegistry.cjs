module.exports = {
  decisions: [
    {
      decisionId: 'DECISION-I01-I16',
      candidateScenarioIds: ['I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'I09', 'I10', 'I11', 'I12', 'I13', 'I14', 'I15', 'I16'],
      blockingRequirementIds: ['R92'],
      options: [
        'Option A: Amend matrix documents to define I01-I16 definitions',
        'Option B: Amend requirement R92 to state account isolation is met by ACC-1/ACC-2/D1-D20'
      ],
      approvalState: 'APPROVED_OPTION_B',
      resolutionArtifact: 'MILESTONE_4_PHASE_2E_COMPLETION_REPORT.md'
    },
    {
      decisionId: 'DECISION-E22',
      candidateScenarioIds: ['E22'],
      blockingRequirementIds: ['R93'],
      options: [
        'Option A: Amend matrix to define E22',
        'Option B: Amend requirement R93 to confirm completeness of E01-E21'
      ],
      approvalState: 'APPROVED_OPTION_B',
      resolutionArtifact: 'MILESTONE_4_PHASE_2E_COMPLETION_REPORT.md'
    }
  ]
};
