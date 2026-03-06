/**
 * Metadata Generator Service
 *
 * Analyzes agent descriptions/systemPrompts via LLM to auto-generate
 * AgentMetadata (tags, domain, capabilities, FROM/TO suggestions).
 * Uses a single batch call for all nodes — faster and more coherent.
 */

import { claudeQuery } from './claude-sdk.js';
import type { AgentMetadata, AgentDomain, AgentCapability } from '../types/agent-metadata.js';
import { AGENT_DOMAINS } from '../types/agent-metadata.js';
import { createLogger } from '../logger.js';

const log = createLogger('metadata-generator');

export interface MetadataGenerationInput {
  nodeId: string;
  label: string;
  description?: string;
  systemPrompt?: string;
  specialty?: string;
  taskDescription?: string;
  nodeType: string;
}

export interface GeneratedMetadata {
  nodeId: string;
  metadata: AgentMetadata;
}

/**
 * Generate metadata for a batch of agent nodes using an LLM call.
 * Analyzes all nodes together so FROM/TO references are coherent.
 */
export async function generateMetadataForNodes(
  nodes: MetadataGenerationInput[],
  cwd: string,
): Promise<GeneratedMetadata[]> {
  const agentNodes = nodes.filter(n =>
    n.nodeType === 'agent' || n.nodeType === 'subagent' || n.nodeType === 'expert',
  );

  if (agentNodes.length === 0) return [];

  const prompt = buildMetadataPrompt(agentNodes);

  // Collect full response text from streaming SDK messages
  let responseText = '';
  for await (const msg of claudeQuery({
    prompt,
    cwd,
    noTools: true,
    maxOutputTokens: 8000,
    permissionMode: 'bypassPermissions',
  })) {
    if (msg.type === 'text_delta') {
      responseText += msg.text;
    }
  }

  return parseMetadataResponse(responseText, agentNodes);
}

function buildMetadataPrompt(nodes: MetadataGenerationInput[]): string {
  const nodeDescriptions = nodes.map((n, i) => {
    const parts = [`### Node ${i + 1}: "${n.label}" (${n.nodeType})`];
    if (n.description) parts.push(`Description: ${n.description}`);
    if (n.specialty) parts.push(`Specialty: ${n.specialty}`);
    if (n.taskDescription) parts.push(`Task: ${n.taskDescription}`);
    if (n.systemPrompt) {
      const truncated = n.systemPrompt.length > 500
        ? n.systemPrompt.slice(0, 500) + '...'
        : n.systemPrompt;
      parts.push(`System Prompt: ${truncated}`);
    }
    return parts.join('\n');
  }).join('\n\n');

  const validDomains = AGENT_DOMAINS.join(', ');

  return `You are an agent metadata analyzer. Given the following agent nodes, generate metadata for each one.

## Agents to Analyze

${nodeDescriptions}

## Instructions

For each agent, generate:
1. **tags**: 3-8 lowercase tags describing what this agent does (e.g., "auth", "cognito", "frontend", "react", "testing")
2. **domain**: One of: ${validDomains}
3. **from**: Array of agent labels (from the list above) that should be allowed to call this agent. Use empty array [] if unrestricted. You can also use "tag:xxx" patterns.
4. **to**: Array of agent labels this agent should delegate to. Use empty array [] for leaf nodes (no delegation). You can also use "tag:xxx" patterns.
5. **capabilities**: 1-3 structured capabilities with id (kebab-case) and description.

## Output Format

Output ONLY a JSON array, one object per agent, in the same order as the input:

\`\`\`json
[
  {
    "nodeId": "...",
    "tags": ["tag1", "tag2"],
    "domain": "backend",
    "from": [],
    "to": ["other-agent", "tag:auth"],
    "capabilities": [{"id": "capability-id", "description": "What it does"}]
  }
]
\`\`\`

Node IDs in order: ${nodes.map(n => `"${n.nodeId}"`).join(', ')}

Output ONLY the JSON block.`;
}

function parseMetadataResponse(
  responseText: string,
  nodes: MetadataGenerationInput[],
): GeneratedMetadata[] {
  // Extract JSON from potential markdown fences
  let jsonStr = responseText;
  const fenceMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!;
  } else {
    const arrayMatch = responseText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }
  }

  let parsed: Array<{
    nodeId?: string;
    tags?: string[];
    domain?: string;
    from?: string[];
    to?: string[];
    capabilities?: Array<{ id: string; description: string }>;
  }>;

  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch {
    log.error('Failed to parse LLM response as JSON');
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const results: GeneratedMetadata[] = [];

  for (let i = 0; i < Math.min(parsed.length, nodes.length); i++) {
    const item = parsed[i]!;
    const node = nodes[i]!;

    const domain = (AGENT_DOMAINS.includes(item.domain as AgentDomain)
      ? item.domain
      : 'general') as AgentDomain;

    const capabilities: AgentCapability[] = (item.capabilities || [])
      .filter(c => c.id && c.description)
      .map(c => ({ id: c.id, description: c.description }));

    results.push({
      nodeId: node.nodeId,
      metadata: {
        metadataVersion: 1,
        tags: (item.tags || []).map(t => t.toLowerCase()),
        domain,
        from: item.from || [],
        to: item.to || [],
        capabilities,
      },
    });
  }

  return results;
}
