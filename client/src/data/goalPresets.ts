export interface GoalPreset {
  id: string;
  label: string;
  category: 'quality' | 'testing' | 'security' | 'refactoring' | 'docs' | 'performance';
  prompt: string;
}

export const GOAL_PRESETS: GoalPreset[] = [
  {
    id: 'error-handling',
    label: 'Error Handling',
    category: 'quality',
    prompt: 'Improve error handling across the application. Find functions and API endpoints that have missing or inadequate try-catch blocks, replace generic error messages with specific user-friendly ones, ensure all async operations handle rejection properly, and add structured logging for server-side errors. Do not change working error handling — only improve areas that are missing or insufficient.',
  },
  {
    id: 'test-coverage',
    label: 'Test Coverage',
    category: 'testing',
    prompt: 'Add comprehensive test coverage to the project. Identify untested modules and critical code paths, write unit tests for utility functions and service layers, add integration tests for API endpoints, and ensure edge cases are covered (empty inputs, boundary values, error scenarios). Follow existing test patterns and naming conventions in the project.',
  },
  {
    id: 'security-audit',
    label: 'Security Audit',
    category: 'security',
    prompt: 'Perform a security audit and fix vulnerabilities. Check for: SQL injection (string concatenation in queries), command injection (unsanitized exec/spawn), hardcoded secrets or API keys, missing input validation on API endpoints, insecure dependencies with known CVEs, and missing authentication checks on sensitive routes. Fix each issue found and explain the remediation.',
  },
  {
    id: 'refactor-organization',
    label: 'Code Organization',
    category: 'refactoring',
    prompt: 'Refactor the codebase for better organization and maintainability. Identify: long functions (>50 lines) that should be decomposed, duplicated logic across files that should be extracted into shared utilities, inconsistent patterns that should be unified, and unclear variable/function names that should be more descriptive. Make incremental, focused changes — each refactoring should be a single logical improvement.',
  },
  {
    id: 'documentation',
    label: 'Documentation',
    category: 'docs',
    prompt: 'Add and improve documentation across the project. Write JSDoc/TSDoc comments for all public functions and interfaces, ensure the README has accurate setup instructions, create or update API documentation for all endpoints, and add inline comments explaining non-obvious business logic. Every documentation claim must be verified against actual source code.',
  },
  {
    id: 'performance',
    label: 'Performance',
    category: 'performance',
    prompt: 'Optimize application performance across the stack. Identify: N+1 database queries and fix with JOINs or batch operations, unnecessary re-renders in frontend components, missing memoization for expensive computations, large bundle imports that could be tree-shaken or lazy-loaded, sequential API calls that could be parallelized, and missing database indexes on queried columns. Prioritize fixes by user-visible impact.',
  },
  {
    id: 'type-safety',
    label: 'Type Safety',
    category: 'quality',
    prompt: 'Improve TypeScript type safety across the codebase. Find and fix: any/unknown types that should be properly typed, missing return type annotations on functions, loose type assertions (as any) that hide potential bugs, missing null checks where values could be undefined, and inconsistent interface definitions. Add discriminated unions where appropriate and ensure strict null checking is respected.',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    category: 'quality',
    prompt: 'Improve web accessibility to meet WCAG 2.1 AA standards. Audit the UI for: missing semantic HTML elements, keyboard navigation issues (focus traps, missing tab order), missing ARIA labels on interactive elements, insufficient color contrast, images without alt text, form inputs without associated labels, and missing heading hierarchy. Fix each issue found with proper semantic markup and ARIA attributes.',
  },
  {
    id: 'api-validation',
    label: 'API Validation',
    category: 'security',
    prompt: 'Add comprehensive input validation to all API endpoints. For each route handler: validate all required fields are present, check types and formats (email, URL, UUID), enforce length limits and range constraints, sanitize string inputs, return 400 responses with field-level error details for validation failures, and ensure no unvalidated user input reaches the database or file system.',
  },
  {
    id: 'dependency-cleanup',
    label: 'Dependency Cleanup',
    category: 'refactoring',
    prompt: 'Clean up and optimize project dependencies. Identify: unused packages in package.json that are never imported, duplicate packages providing similar functionality (keep one, remove others), packages that could be replaced with lighter alternatives, outdated packages with available security patches, and devDependencies accidentally listed as production dependencies. Update or remove each finding.',
  },
];
