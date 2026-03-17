---
name: typecheck
description: Run TypeScript type checking across client and server workspaces. Use after code changes to catch type errors early.
user_invocable: true
---

Run TypeScript type checking for the Viridian monorepo.

## Steps

1. Run client type check:
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm --filter client typecheck 2>&1 | tail -50
```

2. Run server type check:
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm --filter server typecheck 2>&1 | tail -50
```

3. Report results:
   - If both pass: confirm clean type check
   - If errors found: list each error with file path, line number, and the error message
   - Group errors by file for readability
   - Suggest fixes for common patterns (missing imports, wrong types, etc.)

## Notes

- Always run both client AND server — changes in shared types can break either side
- If `typecheck` script doesn't exist, fall back to `npx tsc --noEmit`
- Tail output to avoid flooding context with large error lists
