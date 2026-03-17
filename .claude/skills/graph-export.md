---
name: graph-export
description: Export a Viridian graph as Claude agent .md files or CLAUDE.md configuration. Converts graph nodes and edges into the agent hierarchy file format.
user_invocable: true
---

Export the current graph definition as Claude Code agent files.

## Steps

1. Read the current graph state by checking for a graph ID argument or reading the most recent graph:
```bash
cd /home/rodrigom/Documents/proyects/viridian
```
Use Grep/Read to find the graph data in `client/src/stores/graph.ts` or check for saved graphs in the database.

2. For each node in the graph, generate an agent `.md` file in `.claude/agents/`:

   **Node type → Agent template mapping:**
   - **Agent** node → Full agent with `model: opus` or `model: sonnet`, with `to:` edges
   - **Subagent** node → Agent with `from:` constraint pointing to parent
   - **Expert** node → Read-only agent with `tools: [Read, Grep, Glob]`
   - **Skill** node → Skill file in `.claude/skills/` instead
   - **MCP** node → Note in agent description about MCP server dependency
   - **Rule** node → Add as constraint text in parent agent's prompt

3. For each edge, set the `from:` and `to:` fields in the frontmatter of connected agents.

4. Generate a `CLAUDE.md` that references the orchestrator agent as the entry point.

5. Report what was generated:
   - List of agent files created/updated
   - List of skill files created
   - The `CLAUDE.md` content
   - Any nodes that couldn't be mapped (with reason)

## Notes

- Preserve existing agent files if they have custom content — merge, don't overwrite
- Use the node's label as the agent name (slugified)
- Use the node's description field as the agent description
- Respect the `capabilities` metadata if present on nodes
