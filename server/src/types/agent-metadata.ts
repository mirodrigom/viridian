// ─── Agent Metadata Schema (Server Mirror) ─────────────────────────────
// Identical types to client/src/types/agent-metadata.ts.
// Kept in sync manually — both are source of truth.

export type RoutingRef = string;

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

export interface AgentCapability {
  id: string;
  description: string;
}

export interface AgentMetadata {
  metadataVersion: 1;
  tags: string[];
  domain: AgentDomain;
  from: RoutingRef[];
  to: RoutingRef[];
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

export function matchesRoutingRef(ref: RoutingRef, label: string, tags: string[]): boolean {
  if (ref === '*') return true;
  if (ref.startsWith('tag:')) {
    const tagPattern = ref.slice(4).toLowerCase();
    return tags.some(t => t.toLowerCase() === tagPattern);
  }
  return toSlug(label) === toSlug(ref);
}

export function validateDelegationRouting(
  sourceMeta: AgentMetadata | undefined,
  sourceLabel: string,
  targetMeta: AgentMetadata | undefined,
  targetLabel: string,
): { valid: boolean; reason?: string } {
  if (!sourceMeta && !targetMeta) return { valid: true };

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
