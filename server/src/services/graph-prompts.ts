/**
 * Graph Prompt Composition — builds system prompts, planning prompts,
 * delegation plan parsing, and synthesis prompts.
 *
 * Exports: composeSystemPrompt(), buildPlanningPrompt(), parseDelegationPlan(),
 *          buildSynthesisPrompt(), toAgentKey(), buildChildDescriptions()
 * Types: ChildAssignment
 */

import type { AgentMetadata } from '../types/agent-metadata.js';
import type { ResolvedNode, GraphNode } from './graph-resolver.js';
import { debugLog } from './graph-utils.js';

// ─── Types ──────────────────────────────────────────────────────────────

/** Child assignment from planning phase */
export interface ChildAssignment {
  childNodeId: string;
  childLabel: string;
  task: string;
}

// ─── System Prompt Composition ──────────────────────────────────────────

export function composeSystemPrompt(
  resolved: ResolvedNode,
  opts?: { skipRules?: boolean; projectPath?: string; skillsDir?: string },
): string {
  const parts: string[] = [];

  // Project path instruction + structure discovery guidance
  if (opts?.projectPath) {
    parts.push(`IMPORTANT: The project you are working on is located at: ${opts.projectPath}
You MUST use absolute paths (starting with ${opts.projectPath}) when reading, editing, creating, or searching project files. Do NOT use relative paths.

## Efficient Codebase Navigation
Before reading files, understand the project structure first:
1. Use \`Glob("${opts.projectPath}/**/*", { maxDepth: 2 })\` to get the top-level directory layout
2. Use \`Grep\` to search for specific patterns, classes, or functions instead of reading entire files
3. Only \`Read\` the specific files relevant to your task — do NOT read every file in the project
4. Check for README.md, CLAUDE.md, or package.json at the project root for project conventions`);
  }

  // Node's own system prompt
  const ownPrompt = resolved.node.data.systemPrompt as string || '';
  if (ownPrompt) {
    parts.push(ownPrompt);
  }

  // Rules section (skipped when rules are in CLAUDE.md via tmpdir)
  if (!opts?.skipRules && resolved.rules.length > 0) {
    const ruleLines = resolved.rules.map(r => {
      const ruleType = (r.data.ruleType as string || 'guideline').toUpperCase();
      const ruleText = r.data.ruleText as string || '';
      return `- [${ruleType}] ${r.data.label || 'Rule'}: ${ruleText}`;
    });
    parts.push(`\n## Rules\n${ruleLines.join('\n')}`);
  }

  // Available Skills — compact index (full instructions loaded on-demand from files)
  if (resolved.skills.length > 0) {
    const skillIndex = resolved.skills.map(s => {
      const command = s.data.command as string || '';
      const description = (s.data.description as string) || (s.data.label as string) || 'Skill';
      const label = s.data.label as string || 'Skill';
      return `- \`${command}\` — **${label}**: ${description}`;
    }).join('\n');

    if (opts?.skillsDir) {
      parts.push(`\n## Available Skills\n${skillIndex}\n\nBefore using a skill, read its full instructions:\n  Read(\`${opts.skillsDir}/<command-name>.md\`)\nOnly load the skill(s) you actually need for the current task.`);
    } else {
      // Fallback: inline full templates (no tmpdir available)
      const skillSections = resolved.skills.map(s => {
        const command = s.data.command as string || '';
        const template = s.data.promptTemplate as string || '';
        const label = s.data.label as string || 'Skill';
        return `### Skill: ${label}\n**Command**: \`${command}\`\n**Instructions**:\n${template}`;
      });
      parts.push(`\n## Available Skills\nWhen executing a task that matches one of these skills, follow the skill's instructions exactly.\n\n${skillSections.join('\n\n')}`);
    }
  }

  return parts.join('\n\n');
}

// ─── Two-Phase Helpers ──────────────────────────────────────────────────

/**
 * Sanitize a node label into a clean identifier.
 */
export function toAgentKey(label: string, usedKeys: Set<string>): string {
  let key = label
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');

  if (!key) key = 'Agent';

  const base = key;
  let counter = 2;
  while (usedKeys.has(key)) {
    key = `${base}${counter++}`;
  }
  usedKeys.add(key);
  return key;
}

/**
 * Build a description map of a node's direct children for the planning prompt.
 */
export function buildChildDescriptions(resolved: ResolvedNode): Record<string, { nodeId: string; description: string }> {
  const children: Record<string, { nodeId: string; description: string }> = {};
  const usedKeys = new Set<string>();

  for (const delegate of resolved.delegates) {
    const label = (delegate.data.label as string) || delegate.type;
    const key = toAgentKey(label, usedKeys);
    const description = (delegate.data.description as string)
      || (delegate.data.taskDescription as string)
      || (delegate.data.specialty as string)
      || label;
    children[key] = { nodeId: delegate.id, description };
  }

  return children;
}

/**
 * Build the planning prompt that asks an orchestrator to assign tasks to children.
 */
export function buildPlanningPrompt(
  userTask: string,
  children: Record<string, { nodeId: string; description: string }>,
  resolvedNodes?: Map<string, ResolvedNode>,
): string {
  const childList = Object.entries(children)
    .map(([key, { nodeId, description }]) => {
      // Annotate with metadata tags if available
      const res = resolvedNodes?.get(nodeId);
      const meta = res?.node.data.metadata as AgentMetadata | undefined;
      const tags = meta?.tags?.length ? ` [tags: ${meta.tags.join(', ')}]` : '';
      const domain = meta?.domain && meta.domain !== 'general' ? ` (domain: ${meta.domain})` : '';
      return `- **${key}**${domain}: ${description}${tags}`;
    })
    .join('\n');

  return `You are a coordinator. Analyze the task below and assign subtasks to your team members.

## Your Team
${childList}

## Task
${userTask}

## Instructions
- Carefully read the user's task and decide which team members are relevant.
- Only assign to team members whose specialty directly matches what the task requires.
- For simple tasks, one team member may be enough. Do NOT assign to all of them by default.
- Each team member will receive ONLY the task description you provide — make it detailed and self-contained.
- Output a JSON array of assignments:

\`\`\`json
[{"agent": "AgentName", "task": "Detailed task description with all necessary context..."}]
\`\`\`

Output ONLY the JSON block, no other text before or after it.`;
}

/**
 * Parse the planning phase output into child assignments.
 * Handles variations in LLM output (extra text, markdown fences, etc).
 */
export function parseDelegationPlan(
  planOutput: string,
  children: Record<string, { nodeId: string; description: string }>,
): ChildAssignment[] {
  const assignments: ChildAssignment[] = [];

  // Extract JSON from potential markdown fences or surrounding text
  let jsonStr = planOutput;
  const fenceMatch = planOutput.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!;
  } else {
    // Try to find a JSON array directly
    const arrayMatch = planOutput.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }
  }

  let parsed: Array<{ agent: string; task: string }>;
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch (err) {
    debugLog(`[GraphRunner] Failed to parse delegation plan JSON: ${err}. Raw output:\n${planOutput.slice(0, 500)}`);
    // Fallback: delegate to ALL children with the original prose as context
    for (const [key, { nodeId }] of Object.entries(children)) {
      assignments.push({ childNodeId: nodeId, childLabel: key, task: planOutput });
      debugLog(`[GraphRunner] Fallback assignment: "${key}" (${nodeId})`);
    }
    return assignments;
  }

  if (!Array.isArray(parsed)) {
    debugLog(`[GraphRunner] Delegation plan is not an array: ${typeof parsed}`);
    return assignments;
  }

  const childKeys = Object.keys(children);
  const childKeysLower = childKeys.map(k => k.toLowerCase());

  for (const entry of parsed) {
    if (!entry.agent || !entry.task) continue;

    // Exact match
    let matchedKey = childKeys.find(k => k === entry.agent);

    // Case-insensitive match
    if (!matchedKey) {
      const idx = childKeysLower.indexOf(entry.agent.toLowerCase());
      if (idx >= 0) matchedKey = childKeys[idx];
    }

    // Fuzzy match: normalize and compare
    if (!matchedKey) {
      const normalized = entry.agent.toLowerCase().replace(/[-_\s]/g, '');
      const idx = childKeysLower.findIndex(k => k.replace(/[-_\s]/g, '') === normalized);
      if (idx >= 0) matchedKey = childKeys[idx];
    }

    // Partial match: agent name contains or is contained in a child key
    if (!matchedKey) {
      const normalized = entry.agent.toLowerCase().replace(/[-_\s]/g, '');
      matchedKey = childKeys.find(k => {
        const kn = k.toLowerCase().replace(/[-_\s]/g, '');
        return kn.includes(normalized) || normalized.includes(kn);
      });
    }

    if (matchedKey) {
      const child = children[matchedKey]!;
      assignments.push({
        childNodeId: child.nodeId,
        childLabel: matchedKey,
        task: entry.task,
      });
      debugLog(`[GraphRunner] Plan assignment: "${entry.agent}" → "${matchedKey}" (${child.nodeId})`);
    } else {
      debugLog(`[GraphRunner] Plan assignment: "${entry.agent}" not matched to any child. Available: [${childKeys.join(', ')}]`);
    }
  }

  return assignments;
}

/**
 * Build the synthesis prompt that feeds children's results back to the orchestrator.
 */
export function buildSynthesisPrompt(childResults: Map<string, string>): string {
  const sections = [...childResults.entries()]
    .map(([name, result]) => `## Results from ${name}\n\n${result}`)
    .join('\n\n---\n\n');

  return `Your team has completed their assigned tasks. Here are their results:

${sections}

---

Now synthesize these results into a final, cohesive response that addresses the original task. Combine insights, remove redundancy, and present a well-organized answer.`;
}
