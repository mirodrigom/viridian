---
name: docs-generate
description: Run the docs auto-generation pipeline for API reference docs. Use after changing routes, WebSocket handlers, or TypeScript types.
user_invocable: true
---

Run the Viridian documentation generator.

## When to Use

Only run this after changes to:
- `server/src/routes/` — REST API endpoints
- `server/src/ws/` — WebSocket handlers
- `client/src/types/` — TypeScript type definitions

Do NOT run for component, service, or store changes (those are manually documented).

## Steps

1. Check which files changed:
```bash
cd /home/rodrigom/Documents/proyects/viridian && git diff --name-only HEAD
```

2. If relevant paths were modified, run the generator:
```bash
cd /home/rodrigom/Documents/proyects/viridian && pnpm docs:generate 2>&1
```

3. Check what was generated:
```bash
cd /home/rodrigom/Documents/proyects/viridian && git diff --stat docs/
```

4. Report:
   - Which docs were updated
   - Any errors from the generator
   - Reminder to review generated content before committing
