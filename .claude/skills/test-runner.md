---
name: test-runner
description: Run tests for the Viridian project. Supports filtering by workspace (client/server) or by test file pattern. Use after implementation changes.
user_invocable: true
---

Run Vitest tests for the Viridian monorepo.

## Usage

- `/test-runner` — run all tests
- `/test-runner client` — run client tests only
- `/test-runner server` — run server tests only
- `/test-runner chat` — run tests matching "chat" pattern

## Steps

1. Determine scope from arguments:
   - No args → run all: `pnpm test`
   - "client" → `pnpm --filter client test`
   - "server" → `pnpm --filter server test`
   - Any other string → `pnpm test -- --reporter=verbose ${pattern}`

2. Run the test command:
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm test 2>&1
```

3. Report results:
   - Total passed / failed / skipped
   - For failures: file, test name, error message, and relevant assertion
   - If a test times out, note it separately

## Notes

- Tests use Vitest in both client and server
- Client tests may use Vue Test Utils and @testing-library/vue
- Run with `--reporter=verbose` for detailed output when debugging failures
- Never modify test files unless explicitly asked — report failures, don't fix them
