# Graph Editor & Runner

The Graph Editor is a visual multi-agent coordination system that lets you design, configure, and execute complex AI workflows as directed graphs. Instead of writing a single prompt, you compose a team of specialized agents, connect them with typed edges, and run the entire graph against a task -- Claude orchestrates the delegation automatically.

## Overview

At its core, the Graph feature lets you:

- **Design** agent hierarchies on a drag-and-drop canvas powered by Vue Flow.
- **Configure** each node's model, system prompt, permissions, and capabilities through a properties panel.
- **Connect** nodes with typed edges that define relationships: delegation, skill usage, tool access, rule constraints, and data flow.
- **Run** the graph against a user prompt, with the root agent automatically delegating to its children using Claude CLI's native `--agents` flag and the Task tool.
- **Monitor** execution in real time through a timeline panel, with node status overlays on the canvas.
- **Replay** completed runs with a scrubber that lets you step through execution events.

The editor is accessible from the **Graphs** tab in the main navigation.

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

## Node Types

There are six node types, divided into two categories: **executable nodes** (which spawn Claude CLI instances) and **auxiliary nodes** (which configure the behavior of executable nodes).

### Executable Nodes

These nodes represent AI agents that actually process prompts and produce output.

#### Agent

The top-level orchestrator. An Agent node is typically the root of a graph -- the entry point that receives the user's prompt and delegates work to its children.

| Property | Description |
|----------|-------------|
| **Model** | Claude model to use (Opus 4.6, Sonnet 4.5, Haiku 4.5) |
| **System Prompt** | Instructions that define the agent's behavior and role |
| **Permission Mode** | Tool permission level: Default, Accept Edits, Plan Mode, or Full Auto |
| **Max Tokens** | Maximum token budget for this agent |
| **Allowed Tools** | Whitelist of tools this agent can use |
| **Disallowed Tools** | Blacklist of tools this agent cannot use |

When an Agent has delegation edges to child nodes, it is automatically configured as an **orchestrator**: its tools are restricted to `Task` and `TodoWrite`, and delegation instructions are injected into its system prompt so it coordinates work rather than performing it directly.

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

A reusable prompt template that defines a specific capability. When connected to an executable node, the skill's instructions are included in that node's system prompt under an "Available Skills" section.

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

A behavioral constraint or policy that is injected into the agent's context. Rules connected to any executable node in the graph are collected and written to a `CLAUDE.md` file in a temporary directory, which Claude CLI auto-discovers as project-level instructions.

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
| **Agent** | Subagent | delegation |
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
- **Description** -- An optional description for documentation purposes.

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

### Starting a Run

Click the **Play** button in the toolbar to open the Run dialog. Enter a prompt describing the task you want the graph to perform. The prompt is sent to the root node, which begins execution.

::: info
The **root node** is determined automatically: it is the executable node (Agent, Subagent, or Expert) with no incoming delegation edges. If multiple candidates exist, Agent-type nodes are preferred.
:::

### Execution Flow

When a graph runs, the following sequence occurs:

1. **Graph resolution** -- The server walks all nodes and edges to build a `ResolvedNode` map. Each executable node gets a list of its connected skills, MCPs, rules, and delegates.

2. **Environment preparation** -- If the graph contains Rule or MCP nodes, a temporary directory is created with a `CLAUDE.md` file (containing all rules) and a `.mcp.json` file (containing all MCP server configs). This directory becomes the effective working directory so Claude CLI auto-discovers these files.

3. **Agents config** -- All delegate nodes reachable from the root are flattened into a single agents config object. Each delegate becomes a named agent with a sanitized PascalCase key (e.g., "SubagentFrontend", "ExpertDatabase"). Intermediate orchestrators (delegates that have their own delegates) get:
   - Delegation instructions appended to their prompt
   - Tools restricted to `Task` and `TodoWrite` to force delegation

4. **Root execution** -- The root node's system prompt is composed from its own prompt, skill instructions, and (if not using a tmpdir) rule text. It is invoked with `claudeQuery()` using the `--agents` flag.

5. **Delegation** -- When the root agent calls the `Task` tool with a `subagent_type`, the server maps that to a graph node via the agent key-to-nodeId mapping. The child node enters a "delegated" state (pending activation). When the child produces its first output (text, tool use, or thinking), it transitions to "running".

6. **Cascading** -- For deeply nested graphs, downstream nodes are activated with staggered delays (800ms between starts, 400ms between completions) to create a visible progression in the timeline.

7. **Completion** -- When a subagent returns its result, downstream nodes complete in bottom-up order (skills first, then delegates), followed by the subagent itself. A `result_return` event triggers a reverse edge flow animation.

8. **Cleanup** -- The temporary directory is removed and graph runner session IDs are cleaned up so they don't appear in the chat sidebar.

### Aborting a Run

Click the **Stop** button (red square, replaces Play during execution) to abort the current run. This sends an `abort_run` message over the WebSocket, which triggers the abort controller on the server side.

## The Runner Panel

During and after execution, the right panel switches to the Runner Panel (toggle with the panel button in the toolbar). It has three tabs:

### Timeline Tab

A chronological feed of all execution events. Each entry shows:

- An **icon** indicating the event type (play for start, checkmark for complete, X for failed, arrow for delegation, wrench for tool use)
- The **node label** and **timestamp**
- A **detail line** describing what happened

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
- **Forward flow** (delegation): animated pulse from parent to child when a Task call is made
- **Reverse flow** (result return): animated pulse from child back to parent when results are returned

Edge flow animations last 1.5 seconds and are also visible during scrubber playback within the same time window.

## WebSocket Protocol

The graph runner communicates over a dedicated WebSocket at `/ws/graph-runner`. The protocol supports the following message types:

### Client to Server

| Message | Description |
|---------|-------------|
| `run_graph` | Start execution with graph data, prompt, and working directory |
| `abort_run` | Cancel the current run |

### Server to Client

| Message | Description |
|---------|-------------|
| `run_started` | Run initialized with run ID and root node |
| `node_started` | A node began execution |
| `node_delta` | Streaming text output from a node |
| `node_thinking_start/delta/end` | Extended thinking events |
| `node_tool_use` | A node invoked a tool |
| `node_completed` | A node finished successfully with output and usage stats |
| `node_failed` | A node encountered an error |
| `node_delegated` | A node was delegated to but has not yet started producing output |
| `node_skipped` | A delegated node completed without producing content |
| `delegation` | A parent delegated a task to a child |
| `result_return` | A child returned results to its parent |
| `run_completed` | The entire run finished with final output |
| `run_failed` | The run failed with an error |
| `run_aborted` | The run was cancelled by the user |
