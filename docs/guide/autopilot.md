# Autopilot

Autopilot is a **dual-Claude autonomous collaboration** system that pairs two specialized AI agents to analyze, implement, and commit code improvements in a continuous loop — without human intervention.

Agent A (the **Thinker**) analyzes your codebase and suggests improvements. Agent B (the **Executor**) implements those suggestions. After each cycle, changes are automatically committed to a dedicated git branch. The loop repeats until the goal is met, the iteration limit is reached, or you stop it manually.

## How It Works

### The Cycle Loop

Every Autopilot run executes a repeating **A-B-commit** cycle:

```
┌─────────────────────────────────────────────────┐
│                  CYCLE N                        │
│                                                 │
│  1. Agent A (Thinker)                           │
│     - Reads the codebase                        │
│     - Reviews previous cycle results            │
│     - Suggests ONE specific improvement          │
│                                                 │
│  2. Agent B (Executor)                          │
│     - Receives Agent A's suggestion             │
│     - Implements the change                     │
│     - Summarizes what was modified              │
│                                                 │
│  3. Auto-commit                                 │
│     - Stages changed files (scope-filtered)     │
│     - Commits to the autopilot branch           │
│                                                 │
│  4. Loop check                                  │
│     - Max iterations reached?                   │
│     - Token budget exceeded?                    │
│     - Schedule window closed?                   │
│     - Agent A signaled AUTOPILOT_COMPLETE?      │
│     - User requested pause/abort?               │
│                                                 │
│  If none → start CYCLE N+1                      │
└─────────────────────────────────────────────────┘
```

On the **first cycle**, Agent A analyzes the project from scratch based on the goal you provide. On **subsequent cycles**, Agent A receives the previous cycle's results (Agent B's response, the commit message, and the list of changed files) and suggests the next improvement.

When Agent A determines the goal has been sufficiently achieved, it responds with `AUTOPILOT_COMPLETE` and the run ends gracefully.

::: info Completion Signals
A run can end for several reasons:
- **Agent A signals completion** -- the goal is met
- **Max iterations reached** -- the configured cycle limit is hit
- **Token budget exceeded** -- total tokens across both agents exceed the cap (default 500K)
- **Schedule timeout** -- the configured time window has closed
- **User abort** -- you manually stopped the run
:::

### Test Verification (Cycle N+1)

After all regular cycles complete, Autopilot can run an automatic **Test Verification** cycle. This hidden extra cycle:

1. **Collects all changed files** from every cycle in the run
2. **Finds existing tests** related to those files (`*.test.*`, `*.spec.*`, `__tests__/`)
3. **Runs existing tests** using the project's test runner
4. **Creates new tests** for changed files that lack test coverage
5. **Runs the full suite** again to verify everything passes
6. **Auto-commits** any new test files to the autopilot branch

The test verification cycle uses **Agent B (executor)** since it needs Write, Edit, and Bash access to create test files and run test commands.

::: info Visual Distinction
In the UI, test verification cycles appear with **amber styling** -- an amber-colored separator with a flask icon and "Test Verification" label, distinct from regular numbered cycles.
:::

**Configuration:** Test verification is **enabled by default** and can be toggled in the config dialog's **Scope** tab via the "Run Test Verification (Cycle N+1)" checkbox.

**Behavior notes:**
- Only runs when the run completes **normally** (not on abort, failure, or pause)
- Skipped if no files were changed during the run
- Failure does **not** affect the overall run status -- it is best-effort
- Test file commits are included in the PR alongside all other autopilot commits

### Run Lifecycle

A run progresses through these statuses:

| Status | Meaning |
|--------|---------|
| `running` | Actively executing cycles |
| `paused` | User requested pause; will resume from current position |
| `rate_limited` | Hit API rate limit; auto-waiting for reset |
| `completed` | Finished normally (goal met or limits reached) |
| `schedule_timeout` | Schedule time window expired |
| `failed` | An error occurred during execution |
| `aborted` | User manually stopped the run |

## Profiles

Profiles define the personality, capabilities, and constraints of each agent. They control what an agent can do (tool access), how it thinks (system prompt), and what role it plays in the collaboration.

### Profile Types

Profiles are divided into two categories based on their tool access:

- **Thinker profiles** -- read-only access (Read, Glob, Grep, WebSearch, TodoWrite). Cannot modify files. Ideal for Agent A.
- **Executor profiles** -- full access (Read, Write, Edit, Bash, Glob, Grep, TodoWrite). Can modify files. Ideal for Agent B.

::: tip
You can assign any profile to either agent slot. The UI labels them as "thinker" and "executor" for guidance, but you are free to pair two thinkers or two executors if your use case calls for it.
:::

### Built-in Profiles

Autopilot ships with 20+ built-in profiles organized by category:

#### General

| Profile | Role | Type | Description |
|---------|------|------|-------------|
| **Analyst** | `analyst` | Thinker | Analyzes codebase structure, identifies improvements and technical debt |
| **Architect** | `architect` | Thinker | Reviews architecture, suggests structural refactoring patterns |
| **Code Reviewer** | `reviewer` | Thinker | Reviews code for quality, correctness, style, and best practices |
| **Serial Questioner** | `serial_questioner` | Thinker | Asks probing Socratic questions to find hidden issues and gaps |

#### Development

| Profile | Role | Type | Description |
|---------|------|------|-------------|
| **Feature Creator** | `feature_creator` | Executor | Implements new features based on specifications |
| **Full-Stack Developer** | `fullstack_dev` | Executor | Implements features across frontend, backend, database, and API layers |
| **Frontend Specialist** | `frontend_specialist` | Executor | Expert in UI components, styling, state management, and accessibility |
| **Backend Specialist** | `backend_specialist` | Executor | Expert in server architecture, APIs, databases, and authentication |
| **API Designer** | `api_designer` | Thinker | Designs and reviews API contracts, endpoints, and schemas |

#### Testing and QA

| Profile | Role | Type | Description |
|---------|------|------|-------------|
| **QA Engineer** | `qa` | Executor | Writes and improves tests, finds edge cases and bugs |
| **Security Auditor** | `security_auditor` | Thinker | Identifies security vulnerabilities, injection risks, and auth flaws |
| **Performance Analyst** | `performance_tester` | Thinker | Identifies performance bottlenecks, memory leaks, and inefficient queries |
| **Accessibility Checker** | `accessibility_checker` | Thinker | Audits UI components for WCAG 2.1 AA compliance |

#### DevOps and Infrastructure

| Profile | Role | Type | Description |
|---------|------|------|-------------|
| **CI/CD Optimizer** | `cicd_optimizer` | Thinker | Analyzes and improves build pipelines, GitHub Actions, and Docker builds |
| **Container Specialist** | `container_specialist` | Executor | Builds and optimizes Docker images and Compose stacks |

#### Domain Experts

| Profile | Role | Type | Description |
|---------|------|------|-------------|
| **Database Optimizer** | `db_optimizer` | Thinker | Optimizes schemas, queries, indexes, and data access patterns |
| **i18n Specialist** | `i18n_specialist` | Executor | Implements internationalization -- extracts strings, adds translation keys |
| **Documentation Writer** | `doc_writer` | Executor | Writes and improves technical documentation |

#### Orchestrators (Multi-Agent)

| Profile | Role | Type | Description |
|---------|------|------|-------------|
| **Multi-Agent Coordinator** | `multi_agent_coordinator` | Thinker | Delegates work to specialized sub-agents (CodeAnalyst, Implementer, TestWriter) |
| **Sprint Planner** | `sprint_planner` | Thinker | Breaks down goals into actionable tasks with estimates and priorities |
| **Code Review Team** | `review_team` | Thinker | Coordinates security, performance, and style reviews via sub-agents |

#### MCP-Enabled

| Profile | Role | Type | Description |
|---------|------|------|-------------|
| **GitHub Workflow Manager** | `github_workflow` | Executor | Manages GitHub issues, PRs, and reviews using the GitHub MCP server |

::: warning MCP Profiles
Profiles that reference MCP servers (like GitHub Workflow Manager) require the corresponding MCP server to be configured in your `~/.claude/settings.json` before use. The config dialog will display warnings when you select a profile with MCP dependencies.
:::

### Orchestrator Profiles and Sub-agents

Some profiles (Multi-Agent Coordinator, Code Review Team) use **sub-agents** -- lightweight Claude instances delegated via the `Task` tool. Each sub-agent has its own system prompt, tool restrictions, and turn limit.

For example, the **Multi-Agent Coordinator** delegates to three sub-agents:

- **CodeAnalyst** -- reads and analyzes code (read-only tools, max 20 turns)
- **Implementer** -- writes production-quality code (full tools, max 30 turns)
- **TestWriter** -- writes comprehensive tests (full tools, max 20 turns)

### Custom Profiles

You can create custom profiles through the REST API. Custom profiles support all the same fields as built-in ones:

- System prompt and appended system prompt
- Allowed/disallowed tool lists
- Default model override
- Category and tags
- Sub-agent definitions
- MCP server references
- Permission mode, max turns, and icon

Built-in profiles cannot be edited or deleted. Custom profiles belong to the user who created them.

## Configuration

### Setting Up a Run

The configuration dialog is organized into four tabs:

#### 1. Goal Tab

- **Project Path** -- the working directory for both agents (must be a git repository)
- **Goal Prompt** -- a detailed description of what Autopilot should work on
- **Goal Presets** -- quick-start templates for common tasks (click a preset badge to populate the goal)

```
Example goal:
"Improve error handling across the application. Add proper try-catch
blocks, user-friendly error messages, and logging. Focus on the server
API routes and service layer."
```

::: tip Write Specific Goals
The more specific your goal, the better the results. Instead of "improve the code", try "add input validation to all Express route handlers in server/src/routes/, returning 400 errors with field-level detail for invalid requests."
:::

#### 2. Profiles Tab

Select one profile for each agent:

- **Agent A (Thinker)** -- choose from thinker profiles grouped by category. This agent analyzes the codebase and suggests improvements.
- **Agent B (Executor)** -- choose from executor profiles (and optionally read-only profiles). This agent implements the changes.
- **Model** -- select the Claude model for each agent independently. Available options include Claude Sonnet 4.6, Claude Opus 4.6, and Claude Haiku 4.5.

#### 3. Scope Tab

- **Allowed Paths** -- glob patterns restricting which files Agent B can modify (e.g., `src/**`, `client/src/components/**`). Leave empty to allow all files.
- **Max Iterations** -- maximum number of A-B cycles before stopping (1--200, default 20).

#### 4. Schedule Tab

- **Enable scheduled operation** -- toggle cron-like time windows
- **Start Time / End Time** -- HH:MM format for when the autopilot should run

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `goalPrompt` | string | required | What the autopilot should work on |
| `agentAProfileId` | string | `analyst` | Profile ID for Agent A |
| `agentBProfileId` | string | `feature_creator` | Profile ID for Agent B |
| `agentAModel` | string | `claude-sonnet-4-6` | Model for Agent A |
| `agentBModel` | string | `claude-sonnet-4-6` | Model for Agent B |
| `cwd` | string | required | Project working directory (must be a git repo) |
| `allowedPaths` | string[] | `[]` | Glob patterns for scope restriction |
| `maxIterations` | number | `20` | Maximum cycles before auto-stop |
| `maxTokensPerSession` | number | `500000` | Token budget across both agents |
| `runTestVerification` | boolean | `true` | Run test verification cycle (N+1) after regular cycles |

## Scheduling

Autopilot supports **cron-like scheduling** for unattended operation. The scheduler ticks every 60 seconds and checks all saved configurations with scheduling enabled.

### Time Windows

A schedule defines a time window during which the autopilot will run:

```
Start: 22:00  End: 10:00  →  Runs overnight from 10pm to 10am
Start: 09:00  End: 17:00  →  Runs during business hours
```

The scheduler correctly handles **cross-midnight windows** (e.g., 22:00 to 10:00). When the current time falls within the window, the scheduler starts the run. When the window closes, the run finishes its current cycle and pauses with `schedule_timeout` status.

### Day-of-Week Filtering

Schedules can be restricted to specific days of the week (0 = Sunday through 6 = Saturday). The default is weekdays (Monday through Friday).

### How Scheduling Works

1. The scheduler checks all configs with `schedule_enabled = true` every 60 seconds
2. If the current time is within the window and no run is active, it starts a new run
3. If the current time moves outside the window and a run is active, it pauses the run
4. If a run is already active for a config (running, paused, or rate-limited), the scheduler skips it

::: info Saved Configs vs Ad-hoc Runs
Scheduling only works with **saved configurations** stored in the database. Ad-hoc runs (started from the config dialog) run immediately and do not use scheduling.
:::

## Scope Enforcement

Autopilot uses a **two-layer** scope enforcement strategy to keep agents focused on the right files.

### Soft Enforcement (System Prompt)

When `allowedPaths` are configured, a scope restriction section is appended to each agent's system prompt:

```
## SCOPE RESTRICTION
You may ONLY read and modify files within these paths:
- src/**
- client/src/components/**
Do NOT access files outside this scope.
```

This guides the agent's behavior through instruction-following. Most of the time this is sufficient, but it is not a hard guarantee since agents can occasionally ignore instructions.

### Hard Enforcement (Git Staging Filter)

The real safeguard happens at commit time. The `autoCommit` function in `autopilot-git.ts` filters all changed files through the allowed-path globs **before staging**:

```typescript
const scopedFiles = filterByScope(changedFiles, allowedPaths);
if (scopedFiles.length === 0) return null;
await stageFiles(cwd, scopedFiles);
```

Even if an agent modifies files outside the scope, those files will **not** be staged or committed. They remain as unstaged local changes that you can review manually.

The glob matching supports:
- `*` -- matches any characters except `/` (single directory level)
- `**` -- matches any number of path segments (recursive)
- Standard glob syntax (e.g., `src/**/*.ts`, `client/src/components/**`)

::: warning Empty Scope = No Restriction
If `allowedPaths` is left empty (the default), all changed files are committed. Set explicit paths to restrict scope.
:::

## Rate Limiting

Autopilot handles API rate limits automatically with **zero human intervention**:

1. When a rate limit error is detected (HTTP 429, "rate limit", "overloaded", "too many requests"), the run enters `rate_limited` status
2. The system attempts to parse the rate limit reset time from the error message
3. If parsing fails, it defaults to a **5-minute** wait
4. An additional **5-second buffer** is added after the parsed reset time
5. The run sleeps until the rate limit clears (respecting abort signals)
6. When the wait is over, the run automatically resumes from where it left off

The timeline displays rate limit events with timestamps showing when the limit is expected to clear. The controls bar shows a "Rate Limited" badge during the wait period.

::: tip Rate Limit Strategy
If you are hitting rate limits frequently, consider:
- Using a lower-tier model for Agent A (e.g., Haiku for analysis, Sonnet for implementation)
- Reducing `maxIterations` to stay within your API quota
- Using scheduling to spread work across off-peak hours
:::

## The Dashboard

The Autopilot UI is a three-panel layout on desktop (resizable) and a tab-based layout on mobile.

### Left Panel: Session Sidebar

Lists past autopilot runs with their status, branch name, cycle count, and commit count. Click a run to load its full history (cycles, agent responses, commits) into the main view. On mobile, the sidebar is an overlay activated by a hamburger menu button.

### Center Panel: Dual Chat

A side-by-side split view showing both agents' activity in real-time:

- **Left side (Agent A)** -- displays the thinker's analysis with a blue left border, rendered as Markdown. Shows thinking indicators, tool usage, and cycle separators.
- **Right side (Agent B)** -- displays the executor's implementation with an emerald left border, rendered as Markdown. Shows tool usage, commit badges (with hash, message, and file count), and cycle summaries.

Each panel has a header showing the agent's profile name, description, role badge (Agent A / Agent B), and a spinner when that agent is actively running.

Agent output uses **interleaved content blocks** — text and tool calls are rendered in the order they appear during execution, preserving the natural flow of analysis, tool use, and response.

On mobile, the dual chat switches to a **tabbed view** with toggle buttons for Agent A and Agent B, showing one agent at a time in a full-width layout.

### Right Panel: Timeline and Dashboard Tabs

#### Timeline Tab

A chronological event log showing every significant event in the run:

| Event | Icon | Color |
|-------|------|-------|
| Run started/resumed | Play | Blue |
| Cycle started | Clock | Blue |
| Agent A complete | Brain | Blue |
| Agent B complete | Wrench | Emerald |
| Commit made | GitCommit | Green |
| Cycle completed | CheckCircle | Green |
| Rate limited | AlertTriangle | Orange |
| Run paused | Pause | Yellow |
| Run completed | CheckCircle | Green |
| Schedule timeout | Clock | Red |
| Run failed | XCircle | Red |
| PR created | GitPullRequest | Purple |

Each entry shows a timestamp, cycle badge, and for commits, the abbreviated hash.

#### Dashboard Tab

Live metrics for the current run:

- **Cycles** -- total cycles completed
- **Commits** -- total commits made
- **Files changed** -- unique files modified across all cycles
- **Estimated cost** -- rough estimate based on Sonnet pricing ($3/M input, $15/M output)
- **Token usage breakdown** -- input/output tokens for each agent and combined total
- **Duration** -- elapsed time since run start
- **Commit history** -- scrollable list of all commits with hash, message, and file count (clickable to jump to that cycle)

## Controls

The control bar at the top of the Autopilot view provides lifecycle management. On mobile, button labels are hidden (icon-only) and less critical info like branch name and commit count is collapsed.

### Mobile Layout

On mobile devices (< 768px), the Autopilot view switches to a tab-based navigation:

- **Chat** tab (MessageSquare icon) — Agent collaboration view
- **Timeline** tab (Clock icon) — Cycle timeline
- **Dashboard** tab (BarChart3 icon) — Metrics view

The session sidebar becomes a slide-out overlay activated by a menu button in the header.

### Start

Opens the configuration dialog. Only available when no run is active. Configure goal, profiles, scope, and schedule, then click "Start Autopilot".

### Pause

Requests a graceful pause. The current cycle will **finish completely** (both agents and the commit) before the run pauses. The run enters `paused` status and can be resumed later.

### Resume

Continues a paused run from where it left off. The cycle counter, token counters, and session IDs are all preserved.

### Stop (Abort)

Immediately terminates the run. Sends an abort signal that interrupts the current agent execution. The run enters `aborted` status. Partially completed cycles may not have their changes committed.

### Resume Failed/Aborted Runs

Failed or aborted runs show a "Resume" button that reconstructs the run context from the database and restarts the loop from the next cycle. Previous cycle data (token counts, commit history, session IDs) is preserved.

::: warning Abort vs Pause
**Pause** is graceful -- it finishes the current cycle and preserves all state. **Stop/Abort** is immediate -- it interrupts the current agent mid-execution. Prefer pause when you want to resume later.
:::

## Ad-hoc Runs vs Saved Configs

Autopilot supports two modes of operation:

### Ad-hoc Runs

Started directly from the configuration dialog by clicking "Start Autopilot". Ad-hoc runs:

- Execute immediately with the configured parameters
- Do not persist their configuration for reuse
- Cannot be scheduled
- Are the primary way most users interact with Autopilot

### Saved Configurations

Stored in the database via the REST API (`POST /api/autopilot/configs`). Saved configs:

- Persist all run parameters (goal, profiles, models, scope, limits)
- Can be started from the API (`POST /api/autopilot/runs` with a `configId`)
- Support scheduling with time windows and day-of-week filtering
- Can be reused across multiple runs
- Are required for the scheduler to trigger runs automatically

## Session Continuity

Each agent maintains its own `claudeSessionId` -- a persistent identifier that maps to a Claude CLI JSONL session file. This enables the `--resume` flag across cycles.

### How It Works

1. On the first cycle, each agent starts a new Claude CLI session
2. When the `result` message arrives from the SDK, the session ID is captured
3. The session ID is stored in both the in-memory context and the database (`agent_a_claude_session_id`, `agent_b_claude_session_id`)
4. On subsequent cycles, the session ID is passed to `claudeQuery()`, which uses `--resume` to continue the same conversation

### Benefits

- **Context accumulation** -- each agent builds up knowledge of the codebase across cycles without re-reading everything
- **Cheaper** -- resumed sessions use cached context, reducing input token costs
- **Consistency** -- agents maintain awareness of what they did in previous cycles
- **Resilience** -- if a run is paused or fails and is later resumed, session IDs are loaded from the database and conversations continue seamlessly

### Failed Run Recovery

When resuming a failed or aborted run (`resumeFailedRun`), the system:

1. Loads the run record from the database, including both session IDs
2. Reconstructs the full `AutopilotContext` with preserved state
3. Restarts the cycle loop from `cycleCount`, not from zero
4. Both agents resume their existing conversations via `--resume`

## Git Integration

Autopilot integrates deeply with git to keep all changes organized and safe.

### Automatic Branch Creation

When a run starts, Autopilot creates a new branch with the naming convention:

```
autopilot/<date>-session-<N>
```

For example: `autopilot/2026-02-14-session-1`. If multiple sessions run on the same day, the session number auto-increments (session-2, session-3, etc.).

### Scoped Auto-commits

After each cycle, `autoCommit` performs these steps:

1. Gets the git status (modified, created, deleted, renamed files)
2. Filters files through the allowed-path globs
3. Stages only the in-scope files
4. Commits with a descriptive message: `autopilot: cycle N -- <first line of Agent A's suggestion>`

If no in-scope files were changed in a cycle, the commit is skipped and the cycle is marked as completed without a commit.

### Push and Pull Request

When a run completes successfully with at least one commit, Autopilot automatically:

1. Pushes the branch to origin with upstream tracking (`git push -u origin <branch>`)
2. Creates a pull request via `gh pr create` with:
   - Title: `autopilot: <branch-name>`
   - Body: Run summary with cycle count, commit count, and branch name
   - Base branch: `main`
3. Enables auto-merge with squash strategy (best-effort; depends on repository settings)

::: info PR Creation
Push and PR creation are **best-effort** operations. If they fail (no remote configured, `gh` CLI not installed, insufficient permissions), the run still completes successfully. The error is logged but does not affect the run status.
:::

### Zombie Run Cleanup

On server startup, any runs left in active states (`running`, `paused`, `rate_limited`) from a previous server session are automatically marked as `failed` with the message "Server restarted -- run was interrupted." This prevents ghost runs that would never complete.

## WebSocket Protocol

The Autopilot system communicates between client and server over a dedicated WebSocket endpoint at `/ws/autopilot`. The protocol supports 24+ event types for real-time streaming of agent output, tool usage, thinking states, and lifecycle events.

### Client-to-Server Messages

| Message Type | Purpose |
|---|---|
| `start_adhoc` | Start an ad-hoc run with inline parameters |
| `start_run` | Start a run from a saved config ID |
| `pause_run` | Request graceful pause |
| `resume_run` | Resume a paused run |
| `abort_run` | Immediately terminate a run |
| `get_run_state` | Request current run state (used after reconnect) |
| `resume_failed_run` | Resume a failed/aborted run from where it left off |

### Server-to-Client Messages

| Message Type | Purpose |
|---|---|
| `run_started` | Run initialized, branch created |
| `cycle_started` | New cycle beginning (Agent A phase) |
| `cycle_phase_change` | Transitioning from Agent A to Agent B |
| `agent_a_delta` / `agent_b_delta` | Streaming text from an agent |
| `agent_a_thinking_start/delta/end` | Extended thinking stream events |
| `agent_a_tool_use` / `agent_b_tool_use` | Agent invoked a tool |
| `agent_a_complete` / `agent_b_complete` | Agent finished with full response and token usage |
| `commit_made` | Auto-commit completed with hash, message, and files |
| `cycle_completed` | Cycle finished with summary |
| `rate_limited` | Rate limit detected, includes expected reset time |
| `rate_limit_cleared` | Rate limit cleared, resuming |
| `run_paused` / `run_resumed` | Run lifecycle changes |
| `run_completed` | Run finished with final summary |
| `run_failed` / `run_aborted` | Run terminated with error or by user |
| `pr_created` | Pull request created with URL |
| `error` | Protocol or server error |

## Database Schema

Autopilot uses four SQLite tables:

| Table | Purpose |
|-------|---------|
| `autopilot_profiles` | Built-in and custom agent profiles |
| `autopilot_configs` | Saved run configurations (with schedule settings) |
| `autopilot_runs` | Run records with status, tokens, commit counts, session IDs |
| `autopilot_cycles` | Per-cycle data: prompts, responses, tokens, commit info |

## Common Pairings

Here are some effective profile combinations for common tasks:

| Goal | Agent A | Agent B |
|------|---------|---------|
| General code improvement | Analyst | Feature Creator |
| Architecture refactoring | Architect | Full-Stack Developer |
| Test coverage improvement | Analyst | QA Engineer |
| Security hardening | Security Auditor | Backend Specialist |
| Performance optimization | Performance Analyst | Full-Stack Developer |
| Accessibility compliance | Accessibility Checker | Frontend Specialist |
| CI/CD improvement | CI/CD Optimizer | Container Specialist |
| API cleanup | API Designer | Backend Specialist |
| Documentation | Sprint Planner | Documentation Writer |
| Comprehensive review | Code Review Team | Feature Creator |
