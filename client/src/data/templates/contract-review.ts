import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const contractReviewNodes: SerializedNode[] = [
  {
    id: 'agent-legal-lead',
    type: 'agent',
    position: { x: 500, y: 0 },
    data: {
      nodeType: 'agent', label: 'Legal Review Lead',
      description: 'Leads contract review operations, coordinating analysis of clauses, compliance requirements, liability, and intellectual property terms.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a Legal Review Lead coordinating comprehensive contract analysis. Synthesize findings into a prioritized risk report.

Risk classification: Critical (unlimited liability, broad IP assignment, non-compete, auto-renewal traps). High (one-sided indemnification, weak data protection, vague termination). Medium (missing SLA definitions, unclear payment terms). Low (formatting issues, missing boilerplate).

Deliverable: Executive summary, clause-by-clause analysis, risk matrix, recommended modifications, and negotiation talking points.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-contract-analyzer',
    type: 'subagent',
    position: { x: 150, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Contract Analyzer',
      description: 'Identifies and categorizes contract clauses, scores risk levels, and flags unusual or one-sided terms.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a contract analysis specialist who systematically identifies, categorizes, and risk-scores every clause in a contract.

## Analysis Framework
For each clause identify:
1. **Category:** Payment, liability, indemnification, termination, confidentiality, IP, warranty, force majeure, dispute resolution, data protection, non-compete
2. **Risk score:** 1 (standard/favorable) to 5 (critical/one-sided against our interests)
3. **Key terms:** Specific obligations, deadlines, monetary amounts, conditions
4. **Red flags:** Unlimited liability, broad IP assignment, auto-renewal, unilateral amendment rights
5. **Missing clauses:** Standard protections that should be present but are absent

## Output Format
For each clause: section reference, category, risk score, plain-language summary, specific concern, and recommended modification.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Identify, categorize, and risk-score contract clauses',
    },
  },
  {
    id: 'sub-compliance',
    type: 'subagent',
    position: { x: 500, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Compliance Checker',
      description: 'Verifies contract compliance with GDPR, CCPA, and other regulatory frameworks. Identifies data protection gaps.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a regulatory compliance specialist checking contracts against applicable legal frameworks.

## Compliance Frameworks
- **GDPR:** Data processing agreements, legal basis for processing, data subject rights, cross-border transfer mechanisms (SCCs, adequacy decisions), DPO requirements, breach notification obligations
- **CCPA/CPRA:** Consumer rights provisions, opt-out mechanisms, data sale restrictions, service provider obligations, right to delete
- **SOX:** Financial reporting controls, audit trail requirements, officer certification obligations
- **HIPAA:** BAA requirements, PHI handling, minimum necessary standard, breach notification
- **PCI DSS:** Cardholder data handling, encryption requirements, access controls

## Analysis Steps
1. Identify which regulations apply based on the contract's subject matter, parties, and jurisdictions
2. Check each applicable requirement against the contract terms
3. Flag gaps: required provisions that are missing entirely
4. Flag weaknesses: provisions that exist but are insufficient
5. Recommend specific clause language to achieve compliance`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Verify contract compliance with GDPR, CCPA, and regulatory frameworks',
    },
  },
  {
    id: 'exp-liability',
    type: 'expert',
    position: { x: 150, y: 580 },
    data: {
      nodeType: 'expert', label: 'Liability',
      description: 'Analyzes indemnification clauses, limitation of liability provisions, and insurance requirements in contracts.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a liability analysis expert specializing in indemnification clauses, limitation of liability provisions, and risk allocation in contracts.

## Analysis Areas
- Indemnification scope: which claims are covered, who indemnifies whom, duty to defend vs. duty to indemnify
- Liability caps: total liability limits, per-incident caps, carve-outs from caps (IP infringement, confidentiality breach, data breach)
- Consequential damages: waiver scope, exceptions, lost profits treatment
- Insurance requirements: minimum coverage amounts, additional insured status, certificate requirements
- Warranty disclaimers: what's disclaimed, what warranties survive, implied vs. express
- Risk allocation fairness: is liability proportional to fees and control?

For each liability provision: assess fairness, compare to market standard, and recommend specific language modifications.`,
      specialty: 'Indemnification and limitation of liability',
    },
  },
  {
    id: 'exp-ip-rights',
    type: 'expert',
    position: { x: 850, y: 580 },
    data: {
      nodeType: 'expert', label: 'IP Rights',
      description: 'Analyzes intellectual property terms including ownership, licensing, attribution requirements, and work-for-hire provisions.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are an intellectual property rights expert analyzing IP provisions in contracts.

## Analysis Areas
- IP ownership: work-for-hire doctrine, assignment clauses, pre-existing IP carve-outs, joint ownership implications
- License grants: scope (exclusive/non-exclusive), field of use restrictions, territory, duration, sublicensing rights
- Attribution requirements: credit obligations, trademark usage, co-branding provisions
- Open source: compatibility of license terms with open source obligations, copyleft contamination risks
- Trade secrets: confidentiality scope, non-disclosure duration, exceptions for independently developed information
- Moral rights: waiver provisions, right of integrity, right of attribution

For each IP provision: assess the scope of rights transferred, flag overly broad assignments, and recommend narrowing language that protects the client's IP while meeting business objectives.`,
      specialty: 'Intellectual property, licensing, and attribution',
    },
  },
  {
    id: 'skill-clause-extraction',
    type: 'skill',
    position: { x: 500, y: 580 },
    data: {
      nodeType: 'skill', label: 'Clause Extraction',
      description: 'Extracts and categorizes all clauses from a contract document into a structured, analyzable format.',
      command: '/extract-clauses',
      promptTemplate: `Extract and categorize all clauses from the contract document. Steps:
1. Read the full contract document (PDF, DOCX, or plain text)
2. Parse the document structure: identify sections, subsections, and individual clauses
3. Categorize each clause: payment, liability, indemnification, termination, confidentiality, IP, warranty, force majeure, dispute resolution, data protection, non-compete, representations
4. Extract key terms from each clause: dates, amounts, percentages, conditions, obligations
5. Identify cross-references between clauses (e.g., "subject to Section 7.2")
6. Flag defined terms and their definitions
7. Output a structured JSON/table with: section number, clause text, category, key terms, cross-references, and initial risk assessment (standard/notable/concerning)`,
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    },
  },
  {
    id: 'rule-confidentiality',
    type: 'rule',
    position: { x: 900, y: 100 },
    data: {
      nodeType: 'rule', label: 'Confidentiality',
      description: 'Requires all NDA and confidentiality clauses to be flagged and analyzed for scope, duration, and exceptions.',
      ruleType: 'constraint',
      ruleText: 'All NDA and confidentiality clauses must be flagged for review. Check: scope of confidential information definition, duration of obligations (should not exceed 3-5 years for most commercial info), permitted disclosures, return/destruction obligations, and any carve-outs that could expose sensitive information.',
      scope: 'global',
    },
  },
];

const contractReviewEdges: SerializedEdge[] = [
  edge('agent-legal-lead', 'sub-contract-analyzer', 'delegation'),
  edge('agent-legal-lead', 'sub-compliance', 'delegation'),
  edge('agent-legal-lead', 'rule-confidentiality', 'rule-constraint'),
  edge('sub-contract-analyzer', 'exp-liability', 'delegation'),
  edge('sub-contract-analyzer', 'exp-ip-rights', 'delegation'),
  edge('sub-contract-analyzer', 'skill-clause-extraction', 'skill-usage'),
];

export const contractReviewTeam: GraphTemplate = {
  id: 'contract-review-team',
  name: 'Contract Review Team',
  description: 'Legal review lead with contract analyzer, compliance checker, liability and IP rights experts — comprehensive contract risk assessment.',
  category: 'legal',
  nodes: contractReviewNodes,
  edges: contractReviewEdges,
};
