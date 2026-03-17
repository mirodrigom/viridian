---
name: pre-push
description: Run the full pre-push validation checklist — type checking, tests, and lint — before pushing code. Use to catch issues before they reach the remote.
user_invocable: true
---

Run the complete pre-push validation pipeline for Viridian.

## Steps

Run these checks sequentially (stop on first failure):

### 1. Type Check
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm --filter client typecheck 2>&1 | tail -30
```
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm --filter server typecheck 2>&1 | tail -30
```

### 2. Lint
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm lint 2>&1 | tail -30
```

### 3. Tests
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm test 2>&1 | tail -50
```

### 4. Report

Provide a summary table:

| Check | Status | Details |
|-------|--------|---------|
| Client types | pass/fail | error count |
| Server types | pass/fail | error count |
| Lint | pass/fail | warning/error count |
| Tests | pass/fail | passed/failed/skipped |

- If all pass: confirm ready to push
- If any fail: list the errors and suggest fixes
- Do NOT push automatically — only validate

## Notes

- Stop at first failure category to save time (no point running tests if types fail)
- If lint script doesn't exist, skip it and note in the report
- Always report results even if everything passes
