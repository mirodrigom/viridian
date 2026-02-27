// ─── Agent Metadata Schema ──────────────────────────────────────────────
// Unified metadata for agents, subagents, and experts.
// Provider-agnostic: serialized to YAML frontmatter in .md files.
// Inspired by OASF, Google A2A, ACP, and OpenAI Agent SDK.

/**
 * Routing target reference.
 * - Literal agent label/slug: "auth-agent"
 * - Tag pattern: "tag:cognito"
 * - Wildcard: "*" (unrestricted)
 */
export type RoutingRef = string;

/**
 * High-level domain categorization (controlled vocabulary).
 */
export type AgentDomain =
  | 'frontend'
  | 'backend'
  | 'devops'
  | 'data'
  | 'security'
  | 'testing'
  | 'docs'
  | 'general';

export const AGENT_DOMAINS: AgentDomain[] = [
  'frontend', 'backend', 'devops', 'data',
  'security', 'testing', 'docs', 'general',
];

/**
 * Structured capability declaration (inspired by OASF agent descriptors).
 */
export interface AgentCapability {
  /** Machine-readable identifier, e.g. "code-review", "token-validation" */
  id: string;
  /** Human-readable description */
  description: string;
}

/**
 * Unified metadata schema for agents, subagents, and experts.
 * Lives on graph nodes AND autopilot profiles.
 */
export interface AgentMetadata {
  /** Schema version for forward compatibility */
  metadataVersion: 1;

  /**
   * Tags for discovery and matching.
   * Mix of controlled vocabulary and freeform.
   * Examples: ["backend", "auth", "cognito", "avp", "cedar"]
   */
  tags: string[];

  /** High-level domain categorization */
  domain: AgentDomain;

  /**
   * FROM: Who can delegate TO this agent.
   * Empty array = unrestricted (anyone can call this agent).
   * Examples: ["orchestrator", "tag:auth"]
   */
  from: RoutingRef[];

  /**
   * TO: Who this agent can delegate to.
   * Empty array = leaf node (cannot delegate).
   * Examples: ["session-agent", "token-agent", "tag:avp"]
   */
  to: RoutingRef[];

  /** Structured capabilities this agent provides */
  capabilities: AgentCapability[];
}

export const DEFAULT_AGENT_METADATA: AgentMetadata = {
  metadataVersion: 1,
  tags: [],
  domain: 'general',
  from: [],
  to: [],
  capabilities: [],
};

// ─── Routing Ref Matching ──────────────────────────────────────────────

function toSlug(label: string): string {
  return label.toLowerCase().replace(/[-_\s]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Check if a RoutingRef matches a given agent label and tags.
 * - "*" matches everything
 * - "tag:xxx" matches if xxx is in the tags array
 * - Literal string matches by slug-normalized label comparison
 */
export function matchesRoutingRef(ref: RoutingRef, label: string, tags: string[]): boolean {
  if (ref === '*') return true;
  if (ref.startsWith('tag:')) {
    const tagPattern = ref.slice(4).toLowerCase();
    return tags.some(t => t.toLowerCase() === tagPattern);
  }
  return toSlug(label) === toSlug(ref);
}

/**
 * Validate that a delegation from source to target is allowed by metadata constraints.
 * Returns { valid: true } if allowed, or { valid: false, reason } if blocked.
 * If either side has no metadata, delegation is allowed (backward compatible).
 */
export function validateDelegationRouting(
  sourceMeta: AgentMetadata | undefined,
  sourceLabel: string,
  targetMeta: AgentMetadata | undefined,
  targetLabel: string,
): { valid: boolean; reason?: string } {
  // No metadata = unrestricted (backward compatible)
  if (!sourceMeta && !targetMeta) return { valid: true };

  // Check source's TO constraint
  if (sourceMeta?.to && sourceMeta.to.length > 0) {
    const targetTags = targetMeta?.tags || [];
    const allowed = sourceMeta.to.some(ref =>
      matchesRoutingRef(ref, targetLabel, targetTags),
    );
    if (!allowed) {
      return {
        valid: false,
        reason: `"${sourceLabel}" TO constraint excludes "${targetLabel}"`,
      };
    }
  }

  // Check target's FROM constraint
  if (targetMeta?.from && targetMeta.from.length > 0) {
    const sourceTags = sourceMeta?.tags || [];
    const allowed = targetMeta.from.some(ref =>
      matchesRoutingRef(ref, sourceLabel, sourceTags),
    );
    if (!allowed) {
      return {
        valid: false,
        reason: `"${targetLabel}" FROM constraint excludes "${sourceLabel}"`,
      };
    }
  }

  return { valid: true };
}
