import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const securityAuditNodes: SerializedNode[] = [
  {
    id: 'agent-security',
    type: 'agent',
    position: { x: 400, y: 0 },
    data: {
      nodeType: 'agent', label: 'Security Lead', description: 'Senior application security engineer coordinating OWASP, auth, and dependency auditors for exploitable vulnerabilities.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are a senior application security engineer leading comprehensive security audits. You find real, exploitable vulnerabilities — not theoretical concerns. Deduplicate findings, prioritize by exploitability and impact.

Severity: Critical (RCE, SQLi, auth bypass — fix immediately), High (XSS, CSRF, privilege escalation — fix this sprint), Medium (info disclosure, missing headers — next release), Low (best practice violations — backlog).`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-owasp',
    type: 'subagent',
    position: { x: 50, y: 300 },
    data: {
      nodeType: 'subagent', label: 'OWASP Auditor', description: 'Audits code for OWASP Top 10 vulnerabilities including SQL injection, command injection, and path traversal.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You audit code for OWASP Top 10 vulnerabilities with a focus on injection and input validation flaws.

## Search Patterns
- SQL injection: string concatenation in db.prepare(), template literals in queries
- Command injection: exec(), spawn(), execSync() with user-controlled input
- Template injection: user input rendered in templates without escaping
- Path traversal: path.join() or readFile() with user input without prefix validation
- SSRF: user-controlled URLs in fetch/http requests without allowlist

For each finding provide: CWE ID, exact file:line, proof of concept showing how it could be exploited, and specific remediation code.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Audit for OWASP Top 10 injection and input validation vulnerabilities',
    },
  },
  {
    id: 'sub-auth-audit',
    type: 'subagent',
    position: { x: 400, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Auth Auditor', description: 'Audits authentication, authorization, and session management for privilege escalation and broken auth flaws.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You audit authentication, authorization, and session management for security flaws.

## Focus Areas
- Missing auth middleware on sensitive endpoints (routes without authentication checks)
- Broken session management: predictable session IDs, missing expiration, no invalidation on logout
- Privilege escalation: user A can access user B's resources via IDOR
- Weak password policies: no minimum length, no complexity requirements
- JWT issues: weak signing algorithms (none/HS256 with weak secret), missing expiration, tokens in URLs
- Missing CSRF protection on state-changing endpoints
- Exposed JWT secrets or session keys in source code

For each finding: severity, exact location, exploit scenario, and recommended fix.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Audit authentication, authorization, and session security',
    },
  },
  {
    id: 'sub-deps',
    type: 'subagent',
    position: { x: 750, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Dependency Auditor', description: 'Audits dependencies for known CVEs, outdated packages, typosquatting, and supply chain risks.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You audit project dependencies for known vulnerabilities and supply chain risks.

## Audit Tasks
- Check package.json/requirements.txt for packages with known CVEs
- Identify outdated dependencies that have security patches available
- Look for suspicious or typosquatted package names
- Verify lock files are committed and consistent with manifests
- Check for packages that request excessive permissions or have unusual install scripts
- Identify dependencies with no maintenance (no updates in 2+ years, archived repos)

Report each finding with: package name, current version, vulnerability description, CVE ID if available, and recommended upgrade path.`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Audit dependencies for CVEs and supply chain risks',
    },
  },
  {
    id: 'exp-xss',
    type: 'expert',
    position: { x: 50, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert XSS', description: 'Cross-site scripting specialist for reflected, stored, and DOM-based XSS with exploitability verification.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a cross-site scripting (XSS) specialist. You find reflected, stored, and DOM-based XSS by tracing user input through templates and innerHTML/dangerouslySetInnerHTML calls. You verify that output encoding is applied correctly for each context (HTML, attribute, JavaScript, URL). You provide specific payloads that demonstrate exploitability.',
      specialty: 'Cross-site scripting detection',
    },
  },
  {
    id: 'exp-crypto',
    type: 'expert',
    position: { x: 750, y: 570 },
    data: {
      nodeType: 'expert', label: 'Expert Crypto', description: 'Cryptography and secrets management expert for hashing, token generation, and data encryption at rest.', model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a cryptography and secrets management expert. You identify weak hashing (MD5/SHA1 for passwords — recommend bcrypt/argon2), insecure random generation (Math.random for tokens — use crypto.randomBytes), missing encryption for sensitive data at rest, and exposed secrets in source code, environment files, or logs.',
      specialty: 'Cryptography and secrets management',
    },
  },
  {
    id: 'rule-no-eval',
    type: 'rule',
    position: { x: 0, y: 100 },
    data: { nodeType: 'rule', label: 'No eval()', description: 'Denies eval(), new Function(), and dynamic code execution with user-controlled input.', ruleType: 'deny', ruleText: 'Never use eval(), new Function(), or similar dynamic code execution with user-controlled input.', scope: 'global' },
  },
  {
    id: 'rule-parameterized',
    type: 'rule',
    position: { x: 800, y: 100 },
    data: { nodeType: 'rule', label: 'Parameterized Queries', description: 'Enforces parameterized statements for all database queries to prevent SQL injection.', ruleType: 'constraint', ruleText: 'All database queries must use parameterized statements. Never concatenate or interpolate user input into SQL strings.', scope: 'global' },
  },
  {
    id: 'skill-audit-scan',
    type: 'skill',
    position: { x: 50, y: 810 },
    data: { nodeType: 'skill', label: 'Skill Security Scan', description: 'Scans the codebase for SQL injection, command injection, path traversal, hardcoded secrets, and insecure dependencies.', command: '/security-scan', promptTemplate: 'Perform a security scan of the codebase. Search for: (1) SQL injection patterns — string concatenation or template literals in database queries, (2) Command injection — exec/spawn/execSync with unsanitized input, (3) Path traversal — user input in file path operations without validation, (4) Hardcoded secrets — API keys, passwords, tokens in source files, (5) Insecure dependencies — check package.json for known vulnerable packages. Report each finding with CWE ID, file:line, severity, and remediation.', allowedTools: ['Read', 'Glob', 'Grep', 'Bash'] },
  },
  {
    id: 'skill-dep-check',
    type: 'skill',
    position: { x: 750, y: 810 },
    data: { nodeType: 'skill', label: 'Skill Dependency Check', description: 'Audits dependencies via npm audit for CVEs, outdated packages, and suspicious install scripts.', command: '/dep-check', promptTemplate: 'Audit project dependencies for security vulnerabilities and maintenance status. Run npm audit or equivalent, check for outdated packages with known CVEs, identify unmaintained dependencies (no updates in 2+ years), and flag packages with suspicious install scripts. Report each finding with package name, current version, vulnerability description, and recommended upgrade path.', allowedTools: ['Read', 'Bash', 'Glob', 'Grep'] },
  },
];

const securityAuditEdges: SerializedEdge[] = [
  edge('agent-security', 'sub-owasp', 'delegation'),
  edge('agent-security', 'sub-auth-audit', 'delegation'),
  edge('agent-security', 'sub-deps', 'delegation'),
  edge('sub-owasp', 'exp-xss', 'delegation'),
  edge('sub-deps', 'exp-crypto', 'delegation'),
  edge('sub-owasp', 'skill-audit-scan', 'skill-usage'),
  edge('sub-deps', 'skill-dep-check', 'skill-usage'),
  edge('agent-security', 'rule-no-eval', 'rule-constraint'),
  edge('agent-security', 'rule-parameterized', 'rule-constraint'),
];

export const securityAuditTeam: GraphTemplate = {
  id: 'security-audit-team',
  name: 'Security Audit Team',
  description: 'Security lead coordinating OWASP auditor, auth auditor, and dependency auditor with XSS and crypto experts — comprehensive vulnerability assessment.',
  category: 'analysis',
  nodes: securityAuditNodes,
  edges: securityAuditEdges,
};
