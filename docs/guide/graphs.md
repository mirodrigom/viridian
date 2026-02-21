# Graph Editor & Runner

The Graph Editor is a visual multi-agent coordination system that lets you design, configure, and execute complex AI workflows as directed graphs. Instead of writing a single prompt, you compose a team of specialized agents, connect them with typed edges, and run the entire graph against a task -- Claude orchestrates the delegation automatically.

## Overview

At its core, the Graph feature lets you:

- **Design** agent hierarchies on a drag-and-drop canvas powered by Vue Flow.
- **Configure** each node's model, system prompt, permissions, and capabilities through a properties panel.
- **Connect** nodes with typed edges that define relationships: delegation, skill usage, tool access, rule constraints, and data flow.
- **Quick Run** a pre-built template without touching the editor -- pick a template, enter a prompt, preview the execution plan, and run.
- **Run** custom graphs from the editor with an optional execution preview before spending tokens.
- **Monitor** execution in real time through a timeline panel, with node status overlays on the canvas.
- **Replay** completed runs with a scrubber that lets you step through execution events.

The editor is accessible from the **Graphs** tab in the main navigation.

## Quick Run (Recommended for Getting Started)

The fastest way to run a multi-agent workflow is through the **Templates dialog**. It lets you pick a pre-built template, describe your task, preview the execution plan, and run — all without manually building a graph.

### How to Use

1. Click the **Templates icon** in the graph toolbar.
2. **Browse templates:** Each card shows the template name, category, description, and node type breakdown (e.g., "2 agents, 3 experts, 1 skill"). Each template has two actions:
   - **Import** — Loads the template into the editor for customization.
   - **Run** — Proceeds directly to the prompt and execution flow.
3. **Define Your Task:** Enter a prompt describing what you want the agent team to do. Click a **Goal Preset** badge (e.g., "Code Review", "Refactor", "Security Audit") to pre-fill the prompt, then customize it.
4. **Execution Preview:** Review which agents, skills, MCP servers, and rules will execute. The preview shows the full execution tree with depth indentation, model badges, and warnings for nodes missing system prompts. This is a **dry run** — no tokens are consumed.
5. Click **Run** to start execution. The Runner Panel opens automatically to show live progress.

::: tip
The execution preview is free — it resolves the graph structure without spawning any Claude CLI processes. Use it to verify the plan looks correct before spending tokens.
:::

### Goal Presets

Goal presets are quick-fill prompts that cover common use cases. Clicking a preset fills the prompt textarea, which you can then edit:

| Preset | Description |
|--------|-------------|
| Code Review | Review the codebase for issues and improvements |
| Refactor | Refactor code for better maintainability |
| Security Audit | Audit the codebase for security vulnerabilities |
| Add Feature | Implement a new feature |

## The Graph Editor

The editor is a three-panel resizable layout:

| Panel | Default Size | Contents |
|-------|-------------|----------|
| **Left** | 16% | Node Palette -- drag nodes onto the canvas |
| **Center** | 58% | Vue Flow canvas -- the graph itself |
| **Right** | 26% | Properties Panel (when editing) or Runner Panel (during/after execution) |

### Canvas

The center panel is a full Vue Flow canvas with:

- **Snap-to-grid** at 15px intervals for tidy alignment.
- **Background dots** for spatial reference.
- **MiniMap** (bottom-right) showing a zoomed-out overview of the entire graph.
- **Controls** (bottom-left) for zoom in, zoom out, fit view, and lock.
- **Connection validation** -- only valid connections are allowed (based on the connection rules table below).

### Interactions

| Action | How |
|--------|-----|
| **Add a node** | Drag from the palette onto the canvas |
| **Select a node** | Click on it -- opens its properties in the right panel |
| **Move a node** | Drag it to a new position (snaps to grid) |
| **Connect nodes** | Drag from a source handle (bottom of a node) to a target handle (top of another node) |
| **Delete a node** | Select it and press `Delete` or `Backspace`, or click the X button on the node header |
| **Deselect** | Click on the empty canvas or press `Escape` |

::: tip
Connections are automatically validated. You cannot create an invalid edge -- for example, you cannot connect a Skill node to another Skill node, or a Rule node to an Agent node as a source. The connection rules are enforced in real time.
:::

### Mobile Layout

On mobile (< 768px), the editor switches to a full-canvas layout with:

- A **compact toolbar** with essential actions.
- A **floating action button** (Plus icon) to add nodes via a bottom sheet palette.
- **Bottom sheets** for node properties and the runner panel, sliding up from the screen edge.
- The MiniMap is repositioned to avoid overlapping the FAB.

### Auto-Save Before Run

When you run a graph that hasn't been saved yet, the editor automatically saves it to the database before execution begins.

## Node Types

There are six node types, divided into two categories: **executable nodes** (which spawn Claude CLI instances) and **auxiliary nodes** (which configure the behavior of executable nodes).

### Executable Nodes

These nodes represent AI agents that actually process prompts and produce output. Each executable node gets its **own Claude CLI process** -- there is no shared process.

#### Agent

The top-level orchestrator. An Agent node is typically the root of a graph -- the entry point that receives the user's prompt and delegates work to its children.

| Property | Description |
|----------|-------------|
| **Model** | Claude model to use (Opus 4.6, Sonnet 4.6, Haiku 4.5) |
| **System Prompt** | Instructions that define the agent's behavior and role |
| **Permission Mode** | Tool permission level: Default, Accept Edits, Plan Mode, or Full Auto |
| **Max Tokens** | Maximum token budget for the entire graph run |
| **Allowed Tools** | Whitelist of tools this agent can use |
| **Disallowed Tools** | Blacklist of tools this agent cannot use |

When an Agent has delegation edges to child nodes, it acts as an **orchestrator** using a two-phase execution model (see [Execution Model](#execution-model-two-phase-recursive)).

#### Subagent

A delegated worker that receives tasks from a parent Agent or Subagent. Subagents are the workhorses of a graph -- they receive specific subtasks and execute them with full tool access.

| Property | Description |
|----------|-------------|
| **Model** | Claude model to use |
| **System Prompt** | Behavioral instructions |
| **Permission Mode** | Tool permission level |
| **Task Description** | A summary of what this subagent is responsible for |

#### Expert

A deep specialist agent that focuses on a narrow domain. Experts are typically connected to Subagents for specialized analysis or review tasks.

| Property | Description |
|----------|-------------|
| **Model** | Claude model to use |
| **System Prompt** | Behavioral instructions |
| **Specialty** | The expert's domain of expertise (e.g., "security-review", "database optimization") |

### Auxiliary Nodes

These nodes do not spawn their own Claude instances. Instead, they modify the behavior of the executable nodes they are connected to.

#### Skill

A reusable prompt template that defines a specific capability. When connected to an executable node, the skill appears in a compact **skill index** in the agent's system prompt (name + description only). The full skill instructions are written to individual files in a `skills/` directory that agents read on-demand — only loading the skills they actually need for the current task. This keeps the context window lean when many skills are connected.

| Property | Description |
|----------|-------------|
| **Command** | A slash-command identifier (e.g., `/commit`, `/lint-check`) |
| **Prompt Template** | Detailed instructions for how to execute this skill |
| **Allowed Tools** | Tools this skill requires |

#### MCP (Model Context Protocol)

An external tool server that extends an agent's capabilities. MCP nodes are written to a `.mcp.json` file in a temporary directory at runtime, which Claude CLI auto-discovers.

| Property | Description |
|----------|-------------|
| **Server Type** | Transport protocol: `stdio`, `SSE`, or `HTTP` |
| **Command** | (stdio only) The command to launch the server |
| **Arguments** | (stdio only) Command-line arguments |
| **URL** | (SSE/HTTP) The server endpoint |
| **Environment Variables** | Key-value pairs passed to the server process |
| **Headers** | (SSE/HTTP) HTTP headers for authentication |
| **Tools** | List of tools provided by this server |

#### Rule

A behavioral constraint or policy that is injected into the agent's context. Rules connected to an executable node are written to a `CLAUDE.md` file in a per-node temporary directory, which Claude CLI auto-discovers as project-level instructions.

| Property | Description |
|----------|-------------|
| **Rule Type** | `allow`, `deny`, `guideline`, or `constraint` |
| **Rule Text** | The text of the rule |
| **Scope** | `global` or `project` |

::: tip
Rules and MCP servers are handled natively by Claude CLI through file discovery (`CLAUDE.md` and `.mcp.json`), not by injecting text into prompts. This makes them more reliable and consistent across all agents in the graph.
:::

## Edge Types

Edges define relationships between nodes. The edge type is determined automatically based on the source and target node types.

| Edge Type | Visual | Source | Target | Meaning |
|-----------|--------|--------|--------|---------|
| **delegation** | Animated, primary color, thick | Agent, Subagent | Subagent, Expert | Parent delegates tasks to child |
| **skill-usage** | Static, accent color | Agent, Subagent, Expert | Skill | Agent can use this skill |
| **tool-access** | Static, accent color | Agent, Subagent, Expert | MCP | Agent has access to this tool server |
| **rule-constraint** | Static, red | Agent, Subagent, Expert | Rule | Agent is constrained by this rule |
| **data-flow** | Animated, secondary color | Agent | Agent | Data passes between peer agents |

### Connection Rules

Not all node types can connect to each other. The following table shows valid connections:

| Source Node | Can Connect To | Edge Type |
|-------------|---------------|-----------|
| **Agent** | Subagent, Expert | delegation |
| **Agent** | Skill | skill-usage |
| **Agent** | MCP | tool-access |
| **Agent** | Rule | rule-constraint |
| **Agent** | Agent | data-flow |
| **Subagent** | Expert | delegation |
| **Subagent** | Skill | skill-usage |
| **Subagent** | MCP | tool-access |
| **Subagent** | Rule | rule-constraint |
| **Expert** | Skill | skill-usage |
| **Expert** | MCP | tool-access |
| **Expert** | Rule | rule-constraint |
| **Skill** | (none) | -- |
| **MCP** | (none) | -- |
| **Rule** | (none) | -- |

Skill, MCP, and Rule nodes are always leaf nodes -- they cannot be sources of any edge.

## The Node Palette

The left panel contains all six node types as draggable cards. Each card shows:

- The node type icon (Bot, GitBranch, Sparkles, Zap, Server, ShieldCheck)
- The node type label
- A short description

To add a node to the canvas, drag it from the palette and drop it onto the desired position. The node is created with default values and immediately selected so you can configure it in the Properties Panel.

## Properties Panel

When a node is selected, the right panel shows a form for editing its properties. The panel adapts to show only the fields relevant to the selected node type.

### Common Fields (all node types)

- **Label** -- The display name shown on the node and in the timeline.
- **Description** -- A brief summary (1-2 sentences) used in planning prompts, skill indexes, and node cards on the canvas. This is the primary field agents see when deciding which skills to use or which subagents to delegate to — keep it concise and informative.

### AI Prompt Generation

For nodes that have a system prompt, prompt template, or rule text field, a **sparkle button** next to the field label triggers AI-powered prompt generation. This calls the `/api/graphs/generate-prompt` endpoint, which:

1. Analyzes the node's type, label, description, and connections.
2. Streams back a generated prompt tailored to the node's role in the graph.
3. Updates the text field in real time as the prompt is generated.

::: tip
AI prompt generation is context-aware. It considers the node's connections -- what it delegates to, what skills it has access to, and what rules constrain it -- to produce a prompt that accurately describes the node's role in the workflow.
:::

## Templates

The Templates dialog (accessible from the toolbar's template icon) provides pre-built workflow configurations that you can load as a starting point. Each template defines a complete set of nodes and edges.

### Available Templates

| Template | Category | Description |
|----------|----------|-------------|
| **Full-Stack Dev Team** | Development | Central orchestrator with 9 specialized subagents for infrastructure, frontend, backend, docs, conventions, GitHub, QA, DevOps, and integrations -- each with dedicated experts and skills |
| **Code Review Pipeline** | Analysis | Review agent delegating to security, performance, and code style experts with linting and testing skills |
| **Simple Starter** | Automation | Minimal agent with a couple of skills, an MCP server, and a rule -- a starting point to build upon |
| **Security Audit Team** | Analysis | Security lead coordinating OWASP auditor, auth auditor, and dependency auditor with XSS and crypto experts |
| **Documentation Generator** | Automation | Documentation lead with API docs, architecture docs, and user guide subagents |
| **Migration Assistant** | Development | Migration coordinator with dependency analyzer, code transformer, and migration tester |
| **Performance Optimization** | Analysis | Performance lead with frontend profiler, backend profiler, and database optimizer |
| **API Development Team** | Development | API architect coordinating designer, implementer, documenter, and tester subagents |

When you load a template, all node IDs are regenerated to ensure uniqueness, the graph name is set to the template name, and the canvas auto-fits to show all nodes.

Each template card in the dialog offers two actions: **Import** (loads into the editor for customization) and **Run** (proceeds directly to the prompt and execution flow without modifying the editor).

## Saving and Loading Graphs

### Saving

Click the **Save** button in the toolbar (or use the keyboard shortcut) to open the Save dialog. Graphs are persisted server-side in the SQLite database, associated with the current project path. Saving captures:

- All nodes with their positions and data
- All edges with their connection metadata
- The current viewport (pan and zoom state)

If the graph has been saved before, saving updates the existing record. For new graphs, a new database entry is created.

A **dirty indicator** (a small filled circle next to the graph name) appears in the toolbar whenever the graph has unsaved changes.

### Loading

Click the **Load** button to open the Load dialog, which lists all graphs saved for the current project. Selecting a graph restores its full state including node positions and the saved viewport.

### Auto Layout

The **Auto Layout** button (grid icon in the toolbar) arranges nodes in a hierarchical layout based on their type:

1. **Top row** -- Agent nodes
2. **Second row** -- Subagent nodes
3. **Third row** -- Expert nodes
4. **Bottom row** -- Skill, MCP, and Rule nodes

Nodes within each row are evenly spaced horizontally (280px gap) and rows are separated by 200px vertically.

## Running a Graph

There are two ways to run a graph:

### Quick Run (from a Template)

Click the **Rocket icon** in the toolbar to open the Quick Run Wizard. This is the fastest path -- pick a template, enter a prompt, preview the execution plan, and run. See [Quick Run](#quick-run-recommended-for-getting-started) above for details.

### Run from the Editor

Click the **Play button** in the toolbar to open the Run dialog. This runs the graph you've built or loaded in the editor.

The Run dialog shows:

1. **Root node info** -- Which agent will receive your prompt (auto-detected as the executable node with no incoming delegation edges).
2. **Empty prompt warnings** -- Nodes that are missing system prompts (highlighted in yellow).
3. **Graph summary** -- Badge counts of each node type.
4. **Execution Preview** -- A collapsible section that shows the same preview tree as the Quick Run Wizard. Expand it to verify which agents, skills, MCP servers, and rules will execute before running.
5. **Task Prompt** -- A textarea with goal preset badges for quick-fill.

::: info
The **root node** is determined automatically: it is the executable node (Agent, Subagent, or Expert) with no incoming delegation edges. If multiple candidates exist, Agent-type nodes are preferred.
:::

## Execution Preview (Dry Run)

Both the Quick Run Wizard and the Run dialog include an **Execution Preview** feature. This resolves the graph structure and shows you exactly what will happen when you click Run -- without spawning any Claude processes or consuming tokens.

The preview shows:

- **Summary bar** -- Total agent count and token budget.
- **Node tree** -- Each executable node displayed with depth indentation, showing:
  - An icon for the node type (Bot for agent, GitBranch for subagent, Sparkles for expert)
  - The node label and model badge
  - A **leaf** or **orchestrator** badge (leaf = no children, orchestrator = has delegates)
  - Attached skills (Zap icon), MCP servers (Server icon), and rules (ShieldCheck icon) as small tags
  - A yellow warning triangle if the node is missing a system prompt
- **Delegate chain** -- Each node shows which other nodes it delegates to.

::: warning
Nodes without system prompts will show a yellow warning in the preview and will block the Run button in the Run dialog. Make sure all executable nodes have a system prompt before running.
:::

## Execution Model: Two-Phase Recursive

When you click Run, the graph executes using a **two-phase recursive model**. Each executable node gets its own Claude CLI process -- there is no shared process or flat agent pool.

### How It Works

```
Root Agent (Orchestrator)
│
├── Phase 1: PLANNING (noTools)
│   "Here are your team members: [ExpertSecurity, ExpertPerformance, ExpertStyle]"
│   "Here is the task: [user prompt]"
│   "Assign subtasks as JSON."
│   → Output: [{"agent": "ExpertSecurity", "task": "..."}, ...]
│
├── Execute children (sequentially):
│   ├── Expert Security → single-pass execution → result
│   ├── Expert Performance → single-pass execution → result
│   └── Expert Style → single-pass execution → result
│
└── Phase 2: SYNTHESIS (--resume planning session)
    "Your team has completed their tasks. Here are their results: [...]"
    "Synthesize into a final response."
    → Output: final cohesive answer
```

### Phase-by-Phase Breakdown

**1. Graph Resolution**

The server walks all nodes and edges to build a `ResolvedNode` map. Each executable node gets a list of its directly connected skills, MCPs, rules, and delegates.

**2. Root Detection**

The root node is found automatically: it's the executable node with no incoming delegation edges. If multiple candidates exist, Agent-type nodes take priority.

**3. Sandbox Creation**

A run-level sandbox directory is created at `/tmp/graph-run-<id>/` with a symlink to the real project directory. All node tmpdirs nest inside this sandbox. See [Sandbox Isolation](#sandbox-isolation) for details.

**4. Recursive Execution**

Starting from the root, each node is executed recursively:

- **Leaf nodes** (no delegates): A single Claude CLI process runs with the task prompt and produces output directly.
- **Orchestrator nodes** (has delegates): Two-phase execution:
  1. **Planning phase** -- The orchestrator's CLI is spawned with `noTools: true` (no tool access). It receives a structured prompt listing its children with their descriptions and the user's task, and must output a JSON array of assignments: `[{"agent": "ChildName", "task": "detailed task..."}]`.
  2. **Child execution** -- Each assigned child is executed recursively (depth-first, sequential). Children can themselves be orchestrators with their own children, creating arbitrarily deep hierarchies.
  3. **Synthesis phase** -- The orchestrator's CLI is resumed (`--resume` with the planning session ID) and receives all children's results. It produces a final synthesized answer.

**5. Per-Node Environment**

Each node that has Rule, MCP, or Skill connections gets its own temporary directory with:
- `CLAUDE.md` -- containing only that node's rules
- `.mcp.json` -- containing only that node's MCP server configs
- `skills/` -- containing one `.md` file per connected skill (full instructions, loaded on-demand)

The Claude CLI runs from this tmpdir so it auto-discovers these files. An explicit project path instruction is injected into the system prompt so agents work on the real project files despite running from a tmpdir.

**6. Completion**

When the root node's synthesis phase completes, the run is done. The final output is the root's synthesized response.

### Agent Name Matching

During the planning phase, the orchestrator outputs agent names that may not exactly match the child node labels. The runner handles this with a multi-level matching strategy:

1. **Exact match** -- agent name matches child key exactly
2. **Case-insensitive match** -- `expertsecurity` matches `ExpertSecurity`
3. **Fuzzy match** -- normalized comparison ignoring hyphens, underscores, and spaces
4. **Partial match** -- agent name contains or is contained in a child key

If planning returns no valid assignments, the node falls back to leaf execution (single-pass with full tool access).

### Token Budget Management

The root agent's `maxTokens` property controls the token budget for the entire graph run (default: 500,000 tokens if not specified). Token usage is tracked centrally across all nodes:

- At **80%** usage, a `budget_warning` event is emitted.
- At **100%** usage, the entire run is aborted.

::: warning
Choose your token budget carefully. Complex graphs with many agents (especially those using Opus models) can consume tokens quickly. The default templates use 800,000 tokens, which is sufficient for most workflows. Monitor the timeline during execution to see per-node token consumption.
:::

### Timeout Protection

Each node execution has a **10-minute inactivity timeout**. If a node stops producing any events (text, tool calls, thinking) for 10 minutes, the runner automatically aborts the entire run and emits an error.

The timeout resets every time the node produces any output, so long-running tasks that are actively working will not be interrupted.

## Context Window Optimization

As graphs scale to many agents and skills (20-30 agents with 60+ skills), keeping the context window lean becomes critical. The Graph Runner uses several strategies to minimize configuration overhead in each agent's system prompt, reserving context for actual reasoning.

### On-Demand Skill Loading

Instead of inlining every skill's full `promptTemplate` into the system prompt, the runner uses a two-tier approach:

1. **Compact skill index** -- Each connected skill appears as a one-line entry in the system prompt: the command name, label, and description. This costs ~15 tokens per skill instead of ~100+ tokens for a full template.

2. **Skill files on disk** -- The full instructions for each skill are written to `skills/<command>.md` files in the node's tmpdir. Agents read these files on-demand using the `Read` tool only when they need a specific skill.

```
## Available Skills (in the system prompt)
- `/commit` — **Git Commit**: Stages and commits changes following conventions
- `/test` — **Run Tests**: Executes test suite and reports failures

Before using a skill, read its full instructions:
  Read(`/tmp/graph-node-abc/skills/<command-name>.md`)
Only load the skill(s) you actually need for the current task.
```

This means a node connected to 20 skills pays ~300 tokens in its system prompt instead of ~2000+, and only loads the 1-2 skills it actually needs for a given task.

### The Description Field

Every node type has a `description` field that serves as the compact representation used in planning prompts, skill indexes, and node cards on the canvas. Good descriptions are critical for:

- **Planning prompts** -- Orchestrators see child descriptions when deciding how to delegate tasks. A vague description leads to poor delegation.
- **Skill indexes** -- The compact skill index uses descriptions to help agents decide which skills to load. Without a description, agents must load every skill file to understand what's available.
- **Node cards** -- Descriptions are shown on the canvas, replacing truncated system prompts for a cleaner overview.

::: tip
Write descriptions as concise action summaries (1-2 sentences). For skills: what the skill does and when to use it. For agents: what domain they own and what they're responsible for. For rules: what behavior they enforce.
:::

### Graph as Context Scoper

The graph structure itself is a context optimization mechanism. Each node only receives configuration for its **directly connected** auxiliary nodes:

- An agent connected to 3 skills out of 60 total only sees those 3 in its skill index
- An agent connected to 2 rules out of 20 only has those 2 in its CLAUDE.md
- MCP servers are scoped per-node via individual `.mcp.json` files

This edge-based scoping means you can build a graph with hundreds of auxiliary nodes without any single agent being overwhelmed -- each agent's context is proportional to its own connections, not the total graph size.

## Sandbox Isolation

Graph execution runs in an isolated sandbox to keep node configurations separate from your project files and from each other.

### How It Works

When a graph run starts, the server creates:

```
/tmp/graph-run-<run-id>/
├── project/              ← symlink to your real project directory
├── graph-node-<id-1>/    ← tmpdir for node 1 (if it has rules/MCP/skills)
│   ├── CLAUDE.md         ← this node's rules only
│   ├── .mcp.json         ← this node's MCP servers only
│   └── skills/           ← this node's skill instructions (on-demand)
│       ├── commit.md
│       └── test-runner.md
├── graph-node-<id-2>/    ← tmpdir for node 2
│   ├── CLAUDE.md
│   └── .mcp.json
└── ...
```

Key points:

- **Project access via symlink** -- The `project/` symlink points to your real project. Agents read and write your actual project files through this symlink, so changes are real.
- **Per-node isolation** -- Each node's `CLAUDE.md`, `.mcp.json`, and `skills/` directory only contain that node's directly connected rules, MCP servers, and skills. One node's configuration doesn't leak into another node's context.
- **Nodes without auxiliary connections** -- Nodes that have no Rule, MCP, or Skill connections don't get a tmpdir -- they run directly from the project symlink path.
- **Automatic cleanup** -- The entire sandbox directory is removed when the run completes (or fails/aborts).

::: info
The symlink approach means agents still read and write the real project files. This provides structural isolation (each node gets its own CLAUDE.md and .mcp.json) without the overhead of copying the entire project.
:::

## How It Works Under the Hood

This section explains the internal architecture of the Graph Runner engine in more detail.

### The Per-Node Tmpdir Trick

Claude CLI auto-discovers configuration files from its current working directory:
- **`CLAUDE.md`** -- Project-level instructions and rules
- **`.mcp.json`** -- MCP server configuration

The Graph Runner exploits this by creating a **per-node temporary directory** inside the run sandbox. Each node's Claude CLI process runs from its own tmpdir, so it picks up only the rules and MCP servers connected to that specific node.

Since the CLI runs from a tmpdir instead of your project, every agent gets an explicit instruction in its system prompt:

> *"IMPORTANT: The project you are working on is located at: /path/to/project. You MUST use absolute paths..."*

This ensures agents read, write, and search files in your actual project directory.

### Leaf vs Orchestrator Behavior

| Behavior | Leaf Node | Orchestrator |
|----------|-----------|--------------|
| **CLI processes** | 1 process (single pass) | 2 processes (planning + synthesis) |
| **Planning phase** | None | `noTools: true`, outputs JSON assignments |
| **Tool access** | Full tool access (Bash, Read, Write, etc.) | Planning: no tools. Synthesis: full tools |
| **Children** | None | Executes children recursively between phases |
| **Session continuity** | Single session | Planning session is resumed for synthesis via `--resume` |
| **Permission mode** | Configurable per node | Defaults to bypassPermissions |

### Event Routing

Each node gets its own Claude CLI process, so events are naturally scoped to the correct node. The runner emits events with the `nodeId` attached:

- `node_started` -- A node began execution (with its input prompt)
- `node_phase` -- An orchestrator entered planning or synthesis phase
- `node_delta` -- Streaming text output from a node
- `node_thinking_start/delta/end` -- Extended thinking events
- `node_tool_use` -- A node invoked a tool
- `node_completed` -- A node finished with output and usage stats
- `node_failed` -- A node encountered an error
- `delegation` -- A parent delegated a task to a child (with the assigned task text)
- `result_return` -- A child returned results to its parent

### What Happens When Things Go Wrong

| Scenario | What the Runner Does |
|----------|---------------------|
| **Planning returns invalid JSON** | Falls back to assigning the full task to the first child |
| **Planning returns 0 assignments** | Falls back to leaf execution (single-pass with full tools) |
| **Agent name doesn't match** | Multi-level fuzzy matching (case-insensitive, partial, normalized) |
| **Node produces no output** | Node is marked as completed with empty output |
| **Node fails** | `node_failed` event emitted, error shown in timeline |
| **Run fails** | All nodes stop, `run_failed` event emitted |
| **Token budget exceeded** | Warning at 80%, abort at 100% |
| **Node hangs for 10+ minutes** | Inactivity timeout triggers, entire run is aborted |
| **WebSocket disconnects** | Client auto-reconnects; the run continues server-side |
| **User aborts** | `abort_run` message sent, Claude CLI processes are killed with SIGTERM |

### Aborting a Run

Click the **Stop** button (red square, replaces Play during execution) to abort the current run. This sends an `abort_run` message over the WebSocket, which triggers the abort controller on the server side, killing all active Claude CLI processes.

## The Runner Panel

During and after execution, the right panel switches to the Runner Panel (toggle with the panel button in the toolbar). It has three tabs:

### Timeline Tab

A chronological feed of all execution events. Each entry shows:

- An **icon** indicating the event type (play for start, checkmark for complete, X for failed, arrow for delegation, wrench for tool use)
- The **node label** and **timestamp**
- A **detail line** describing what happened
- **Phase indicators** when orchestrator nodes enter planning or synthesis phases

Color coding:
- Yellow -- node started / running
- Green -- node completed
- Red -- node failed
- Blue -- node delegated (waiting for activation)
- Primary color -- delegation event
- Accent -- result return
- Tool color -- tool use

Click any timeline entry to jump to the **Node Detail** tab for that node.

Active nodes show a streaming indicator at the bottom of the timeline with a spinner and the last 200 characters of their output.

### Node Detail Tab

Shows full details for a selected node execution:

- **Status badge** (running, delegated, completed, failed) with color coding
- **Timing and usage** -- start time, input tokens, output tokens
- **Input** -- the prompt that was sent to this node
- **Thinking** -- if extended thinking was used, the thinking text (last 2000 characters)
- **Output** -- the full response text
- **Tool calls** -- a list of all tools invoked by this node, with their status
- **Error** -- if the node failed, the error message

### History Tab

Lists all previous runs for the current graph (requires the graph to be saved first). Each entry shows:

- Status icon (checkmark, X, spinner, or clock)
- The prompt used
- Date, duration, and total token count

Click a run to load it and enter playback mode. Hover to reveal a delete button.

## Timeline Scrubber

When a run exists (active or completed), a scrubber bar appears between the toolbar and the canvas. It provides DVR-like controls for navigating through execution:

### Controls

| Button | Action |
|--------|--------|
| **Replay** (rotate icon) | Enter playback mode from the beginning |
| **Step backward** (left chevron) | Jump to the previous timeline event |
| **Play/Pause** | Start or stop continuous playback |
| **Step forward** (right chevron) | Jump to the next timeline event |
| **Speed** | Cycle through 0.5x, 1x, 2x, 4x playback speeds |

### The Track

The scrubber track shows:

- A **filled bar** indicating the current playback position
- **Colored markers** for each timeline event (starts, completions, failures, delegations, returns)
- A **playhead thumb** (in playback mode) that can be dragged to scrub

Hover over a marker to see its detail tooltip.

### Live Mode

The **LIVE** button (with a radio icon) returns to real-time view, exiting playback mode. It glows green when viewing live and appears muted when in playback mode.

::: tip
The scrubber is playback-aware: in playback mode, only timeline events up to the current playhead position are shown. Node statuses on the canvas also reflect the playback position -- you can scrub backward to see which nodes were active at any point during execution.
:::

## Canvas Overlays During Execution

While a graph is running (or during playback), nodes on the canvas show visual execution state:

| Status | Visual |
|--------|--------|
| **Running** | Yellow pulsing ring with spinner badge |
| **Delegated** | Blue dashed border with gentle pulse (waiting for activation) |
| **Completed** | Green ring with checkmark badge |
| **Failed** | Red ring with X badge |
| **Auxiliary active** | Faint yellow pulse on Skill/MCP/Rule nodes when their parent is running |

Edges also animate during execution:
- **Forward flow** (delegation): animated pulse from parent to child when a delegation event occurs
- **Reverse flow** (result return): animated pulse from child back to parent when results are returned

Edge flow animations last 1.5 seconds and are also visible during scrubber playback within the same time window.

## WebSocket Protocol

The graph runner communicates over a dedicated WebSocket at `/ws/graph-runner`. The protocol supports the following message types:

### Client to Server

| Message | Description |
|---------|-------------|
| `preview_graph` | Request an execution preview (dry run) for a graph. Returns the full execution tree without spawning CLI processes. |
| `run_graph` | Start execution with graph data, prompt, and working directory |
| `abort_run` | Cancel the current run |

### Server to Client

| Message | Description |
|---------|-------------|
| `preview_result` | Execution preview response with the full node tree, token budget, and agent count |
| `preview_error` | Preview request failed with an error message |
| `run_started` | Run initialized with run ID and root node |
| `node_started` | A node began execution |
| `node_phase` | An orchestrator node entered planning or synthesis phase |
| `node_delta` | Streaming text output from a node |
| `node_thinking_start/delta/end` | Extended thinking events |
| `node_tool_use` | A node invoked a tool |
| `node_completed` | A node finished successfully with output and usage stats |
| `node_failed` | A node encountered an error |
| `node_delegated` | A node was delegated to but has not yet started producing output |
| `node_skipped` | A delegated node completed without producing content |
| `delegation` | A parent delegated a task to a child (includes the assigned task text) |
| `result_return` | A child returned results to its parent |
| `run_completed` | The entire run finished with final output |
| `run_failed` | The run failed with an error |
| `run_aborted` | The run was cancelled by the user |

## Example: Code Review Pipeline

Here's a walkthrough of what happens when you run the **Code Review Pipeline** template:

### The Graph Structure

```
Root Agent (Orchestrator, Sonnet)
└── Subagent Review (Orchestrator, Sonnet)
    ├── Expert Security (Leaf, Sonnet)
    │   └── Skill: Security Scanner
    ├── Expert Performance (Leaf, Sonnet)
    │   └── Skill: Lint Check
    └── Expert Code Style (Leaf, Sonnet)
        └── Skill: Test Runner
```

### Execution Flow

1. **Sandbox created** -- `/tmp/graph-run-abc123/` with `project/` symlink.

2. **Root Agent starts (Planning)** -- Receives your prompt. Sees one child: `SubagentReview`. Outputs `[{"agent": "SubagentReview", "task": "Review the codebase..."}]`.

3. **Subagent Review starts (Planning)** -- Receives the delegated task. Sees three children: `ExpertSecurity`, `ExpertPerformance`, `ExpertCodeStyle`. Assigns each a specific review focus.

4. **Expert Security executes (Leaf)** -- Single-pass execution. Reviews security aspects of the code. Has access to the Security Scanner skill. Produces findings.

5. **Expert Performance executes (Leaf)** -- Reviews performance aspects. Has access to the Lint Check skill.

6. **Expert Code Style executes (Leaf)** -- Reviews code style. Has access to the Test Runner skill.

7. **Subagent Review synthesizes** -- Resumes its planning session with all three experts' results. Produces a combined review.

8. **Root Agent synthesizes** -- Resumes its planning session with Subagent Review's result. Produces the final cohesive review.

9. **Cleanup** -- Sandbox directory removed, run marked as completed.

### What You See in the Timeline

```
00:00  ▶ Root Agent started (planning phase)
00:05  ▶ Root Agent → planning complete
00:05  → Delegated to Subagent Review
00:06  ▶ Subagent Review started (planning phase)
00:12  ▶ Subagent Review → planning complete
00:12  → Delegated to Expert Security
00:13  ▶ Expert Security started
01:45  ✓ Expert Security completed (87k tokens)
01:45  ← Result returned to Subagent Review
01:45  → Delegated to Expert Performance
01:46  ▶ Expert Performance started
03:10  ✓ Expert Performance completed (72k tokens)
03:10  ← Result returned to Subagent Review
03:10  → Delegated to Expert Code Style
03:11  ▶ Expert Code Style started
04:20  ✓ Expert Code Style completed (65k tokens)
04:20  ← Result returned to Subagent Review
04:20  ▶ Subagent Review → synthesis phase
04:50  ✓ Subagent Review completed
04:50  ← Result returned to Root Agent
04:50  ▶ Root Agent → synthesis phase
05:30  ✓ Root Agent completed
05:30  ✓ Run completed (288k total tokens)
```

## Toolbar Reference

| Button | Icon | Action |
|--------|------|--------|
| Graph name | Text input | Edit the graph's display name |
| Dirty indicator | Filled circle | Appears when the graph has unsaved changes |
| New Graph | FilePlus | Create a new empty graph |
| Save | Save | Save the current graph to the database |
| Load | FolderOpen | Load a saved graph |
| Templates | LayoutTemplate | Open the templates dialog |
| Auto Layout | LayoutGrid | Arrange nodes in a hierarchical layout |
| Fit View | Maximize2 | Zoom to fit all nodes in the viewport |
| Delete | Trash2 | Delete the selected node |
| Run / Stop | Play / Square | Start or abort a graph run |
| Toggle Panel | PanelRight | Switch between Properties and Runner panels |
| Stats | -- | Shows node and edge counts |
