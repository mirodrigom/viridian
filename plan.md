# Project Bootstrap Feature - Implementation Plan

## Overview

When a user selects a project on the Dashboard, Viridian will **discover and register** scripts, environment files, and services into the management system — not auto-start them. A multi-step loader/spinner shows progress during this bootstrap.

## Architecture

### Flow
```
DashboardPage → openProject(path)
  → router.push('/project')
    → ProjectPage handleRoute()
      → NEW: bootstrapProject(path)
        → Step 1: Discover & register scripts (from package.json)
        → Step 2: Discover & register env files (.env*)
        → Step 3: Discover & register services (from docker-compose, viridian.json)
      → Loader shows progress per step
      → Done → workspace ready with management populated
```

### Discovery Sources
| Item         | Source                                     |
|-------------|-------------------------------------------|
| Scripts     | `package.json` → `scripts` field           |
| Environments| Glob for `.env`, `.env.*` files in project root |
| Services    | `docker-compose.yml` services + optional `viridian.json` |

### Optional: `viridian.json` config (project root)
For explicit definitions beyond auto-discovery:
```json
{
  "services": [
    { "name": "Backend", "command": "pnpm dev:server", "cwd": "." }
  ],
  "scripts": [
    { "name": "Setup", "command": "./setup.sh" }
  ],
  "env": [".env", ".env.local"]
}
```

---

## Changes

### 1. Server: Bootstrap service

**New file:** `server/src/services/project-bootstrap.ts`

Encapsulates discovery logic:
- `discoverScripts(projectPath)` → reads package.json, parses scripts
- `discoverEnvFiles(projectPath)` → globs for .env* files
- `discoverServices(projectPath)` → reads docker-compose.yml + viridian.json
- `registerDiscoveries(userId, projectPath, discoveries)` → upserts to DB, returns counts

### 2. Server: Bootstrap endpoint

**File:** `server/src/routes/management.ts` (add new endpoint)

**`POST /api/management/bootstrap`**
- Body: `{ projectPath: string }`
- Logic:
  1. Read `package.json` → extract `scripts` → upsert into `management_scripts`
  2. Glob `.env*` → return list of env file paths
  3. Read `docker-compose.yml` if exists → extract services → upsert into `management_services`
  4. Read `viridian.json` if exists → merge explicit definitions
  5. Skip duplicates (check by `user_id + project_path + command`)
- Returns:
```json
{
  "scripts": { "discovered": 8, "added": 5, "existing": 3 },
  "environments": { "files": [".env", ".env.local"] },
  "services": { "discovered": 2, "added": 2, "existing": 0 }
}
```

### 3. Client: Bootstrap loader component

**New file:** `client/src/components/layout/ProjectBootstrapLoader.vue`

Replaces the current simple spinner in ProjectPage. Multi-step loader:
```
┌─────────────────────────────────┐
│                                 │
│         [Viridian Logo]         │
│                                 │
│     Opening project...          │
│                                 │
│  ✓ Scripts         8 found      │
│  ⟳ Environments   loading...    │
│  ○ Services        pending      │
│                                 │
│     ━━━━━━━━━━━━━━━━━░░░░░░░    │
│                                 │
└─────────────────────────────────┘
```

States per step: `pending` → `loading` (spinner) → `done` (checkmark + count)

### 4. Client: Management store — bootstrap action

**File:** `client/src/stores/management.ts`

Add `bootstrap(projectPath)` action + `envFiles` state for discovered env paths.

### 5. Client: ProjectPage integration

**File:** `client/src/pages/ProjectPage.vue`

Replace the simple 1.2s timeout with sequential bootstrap steps, each with minimum visible time so the user sees progress.

### 6. Client: EnvWidget enhancement

**File:** `client/src/components/management/EnvWidget.vue`

Show discovered env files as a dropdown instead of requiring manual path input.

---

## Files summary

| File | Action |
|------|--------|
| `server/src/services/project-bootstrap.ts` | **Create** — discovery + registration logic |
| `server/src/routes/management.ts` | **Modify** — add `POST /bootstrap` endpoint |
| `client/src/components/layout/ProjectBootstrapLoader.vue` | **Create** — multi-step loader UI |
| `client/src/pages/ProjectPage.vue` | **Modify** — integrate bootstrap flow |
| `client/src/stores/management.ts` | **Modify** — add bootstrap action + envFiles state |
| `client/src/components/management/EnvWidget.vue` | **Modify** — show discovered env files dropdown |

## Not in scope
- Auto-starting services (user explicitly said no)
- Modifying the DashboardPage selection flow
- Changes to the graph/skill export system
