/**
 * Autopilot Profile Service — built-in profiles and CRUD for custom ones.
 */

import { db } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { safeJsonParse } from '../lib/safeJson.js';
import { ProfileLoader } from './profile-loader.js';
import type { AgentDomain, AgentCapability } from '../types/agent-metadata.js';
import { createLogger } from '../logger.js';

const log = createLogger('autopilot-profiles');

// ─── Types ───────────────────────────────────────────────────────────────

export interface SubagentDefinition {
  key: string;           // PascalCase identifier used in Task tool calls
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
}

export interface McpServerReference {
  name: string;              // Name of an MCP server registered in ~/.claude/settings.json
  requiredTools?: string[];  // Subset of tools from this MCP server
}

export interface AutopilotProfile {
  id: string;
  userId: number | null;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  model: string | null;
  isBuiltin: boolean;
  createdAt?: string;
  // Extended fields
  category: string;
  tags: string[];
  subagents: SubagentDefinition[];
  mcpServers: McpServerReference[];
  appendSystemPrompt: string | null;
  maxTurns: number | null;
  permissionMode: string | null;
  icon: string | null;
  difficulty: string | null;
  // Agent metadata (routing & discovery)
  domain: AgentDomain;
  routingFrom: string[];
  routingTo: string[];
  capabilities: AgentCapability[];
}

// ─── Built-in Profile Loading ───────────────────────────────────────────────

/**
 * Re-export ProfileLoader for external use
 */
export { ProfileLoader } from './profile-loader.js';

// ─── Database Operations ────────────────────────────────────────────────

/** Seed built-in profiles — uses INSERT OR IGNORE + UPDATE to handle schema changes */
export async function seedBuiltinProfiles(): Promise<void> {
  const builtinProfiles = ProfileLoader.loadBuiltinProfiles();

  for (const p of builtinProfiles) {
    await db('autopilot_profiles')
      .insert({
        id: p.id,
        user_id: null,
        name: p.name,
        role: p.role,
        description: p.description,
        system_prompt: p.systemPrompt,
        allowed_tools: JSON.stringify(p.allowedTools),
        disallowed_tools: JSON.stringify(p.disallowedTools),
        model: p.model,
        is_builtin: 1,
        category: p.category || 'general',
        tags: JSON.stringify(p.tags || []),
        subagents: JSON.stringify(p.subagents || []),
        mcp_servers: JSON.stringify(p.mcpServers || []),
        append_system_prompt: p.appendSystemPrompt || null,
        max_turns: p.maxTurns || null,
        permission_mode: p.permissionMode || null,
        icon: p.icon || null,
        difficulty: p.difficulty || null,
        domain: p.domain || 'general',
        routing_from: JSON.stringify(p.routingFrom || []),
        routing_to: JSON.stringify(p.routingTo || []),
        capabilities: JSON.stringify(p.capabilities || []),
      })
      .onConflict('id')
      .merge();
  }

  log.info({ count: builtinProfiles.length }, 'Seeded built-in profiles to database');
}

/** Get all profiles (built-in + user's custom) */
export async function getProfiles(userId: number): Promise<AutopilotProfile[]> {
  const rows = await db('autopilot_profiles')
    .where('is_builtin', 1)
    .orWhere('user_id', userId)
    .orderBy([{ column: 'is_builtin', order: 'desc' }, { column: 'name', order: 'asc' }])
    .select('*') as Record<string, unknown>[];

  return rows.map(rowToProfile);
}

/** Get a single profile by ID */
export async function getProfile(id: string): Promise<AutopilotProfile | null> {
  const row = await db('autopilot_profiles').where({ id }).first() as Record<string, unknown> | undefined;
  return row ? rowToProfile(row) : null;
}

/** Create a custom profile */
export async function createProfile(userId: number, data: {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  model: string | null;
  category?: string;
  tags?: string[];
  subagents?: SubagentDefinition[];
  mcpServers?: McpServerReference[];
  appendSystemPrompt?: string | null;
  maxTurns?: number | null;
  permissionMode?: string | null;
  icon?: string | null;
  difficulty?: string | null;
  domain?: AgentDomain;
  routingFrom?: string[];
  routingTo?: string[];
  capabilities?: AgentCapability[];
}): Promise<AutopilotProfile> {
  const id = uuid();
  await db('autopilot_profiles').insert({
    id,
    user_id: userId,
    name: data.name,
    role: data.role,
    description: data.description,
    system_prompt: data.systemPrompt,
    allowed_tools: JSON.stringify(data.allowedTools),
    disallowed_tools: JSON.stringify(data.disallowedTools),
    model: data.model,
    is_builtin: 0,
    category: data.category || 'general',
    tags: JSON.stringify(data.tags || []),
    subagents: JSON.stringify(data.subagents || []),
    mcp_servers: JSON.stringify(data.mcpServers || []),
    append_system_prompt: data.appendSystemPrompt || null,
    max_turns: data.maxTurns || null,
    permission_mode: data.permissionMode || null,
    icon: data.icon || null,
    difficulty: data.difficulty || null,
    domain: data.domain || 'general',
    routing_from: JSON.stringify(data.routingFrom || []),
    routing_to: JSON.stringify(data.routingTo || []),
    capabilities: JSON.stringify(data.capabilities || []),
  });

  return (await getProfile(id))!;
}

/** Update a custom profile (cannot update built-in) */
export async function updateProfile(id: string, data: {
  name?: string;
  role?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  model?: string | null;
  category?: string;
  tags?: string[];
  subagents?: SubagentDefinition[];
  mcpServers?: McpServerReference[];
  appendSystemPrompt?: string | null;
  maxTurns?: number | null;
  permissionMode?: string | null;
  icon?: string | null;
  difficulty?: string | null;
  domain?: AgentDomain;
  routingFrom?: string[];
  routingTo?: string[];
  capabilities?: AgentCapability[];
}): Promise<AutopilotProfile | null> {
  const existing = await db('autopilot_profiles').where({ id }).select('is_builtin').first() as { is_builtin: number } | undefined;
  if (!existing || existing.is_builtin) return null;

  const updates: Record<string, unknown> = {};

  if (data.name !== undefined) updates.name = data.name;
  if (data.role !== undefined) updates.role = data.role;
  if (data.description !== undefined) updates.description = data.description;
  if (data.systemPrompt !== undefined) updates.system_prompt = data.systemPrompt;
  if (data.allowedTools !== undefined) updates.allowed_tools = JSON.stringify(data.allowedTools);
  if (data.disallowedTools !== undefined) updates.disallowed_tools = JSON.stringify(data.disallowedTools);
  if (data.model !== undefined) updates.model = data.model;
  if (data.category !== undefined) updates.category = data.category;
  if (data.tags !== undefined) updates.tags = JSON.stringify(data.tags);
  if (data.subagents !== undefined) updates.subagents = JSON.stringify(data.subagents);
  if (data.mcpServers !== undefined) updates.mcp_servers = JSON.stringify(data.mcpServers);
  if (data.appendSystemPrompt !== undefined) updates.append_system_prompt = data.appendSystemPrompt;
  if (data.maxTurns !== undefined) updates.max_turns = data.maxTurns;
  if (data.permissionMode !== undefined) updates.permission_mode = data.permissionMode;
  if (data.icon !== undefined) updates.icon = data.icon;
  if (data.difficulty !== undefined) updates.difficulty = data.difficulty;
  if (data.domain !== undefined) updates.domain = data.domain;
  if (data.routingFrom !== undefined) updates.routing_from = JSON.stringify(data.routingFrom);
  if (data.routingTo !== undefined) updates.routing_to = JSON.stringify(data.routingTo);
  if (data.capabilities !== undefined) updates.capabilities = JSON.stringify(data.capabilities);

  if (Object.keys(updates).length === 0) return getProfile(id);

  await db('autopilot_profiles').where({ id }).update(updates);
  return getProfile(id);
}

/** Delete a custom profile (cannot delete built-in) */
export async function deleteProfile(id: string): Promise<boolean> {
  const count = await db('autopilot_profiles').where({ id, is_builtin: 0 }).delete();
  return count > 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function rowToProfile(row: Record<string, unknown>): AutopilotProfile {
  return {
    id: row.id as string,
    userId: row.user_id as number | null,
    name: row.name as string,
    role: row.role as string,
    description: row.description as string,
    systemPrompt: row.system_prompt as string,
    allowedTools: safeJsonParse<string[]>(row.allowed_tools as string, []),
    disallowedTools: safeJsonParse<string[]>(row.disallowed_tools as string, []),
    model: row.model as string | null,
    isBuiltin: (row.is_builtin as number) === 1,
    createdAt: row.created_at as string,
    category: (row.category as string) || 'general',
    tags: safeJsonParse<string[]>(row.tags as string, []),
    subagents: safeJsonParse<SubagentDefinition[]>(row.subagents as string, []),
    mcpServers: safeJsonParse<McpServerReference[]>(row.mcp_servers as string, []),
    appendSystemPrompt: (row.append_system_prompt as string) || null,
    maxTurns: (row.max_turns as number) || null,
    permissionMode: (row.permission_mode as string) || null,
    icon: (row.icon as string) || null,
    difficulty: (row.difficulty as string) || null,
    domain: ((row.domain as string) || 'general') as AgentDomain,
    routingFrom: safeJsonParse<string[]>(row.routing_from as string, []),
    routingTo: safeJsonParse<string[]>(row.routing_to as string, []),
    capabilities: safeJsonParse<AgentCapability[]>(row.capabilities as string, []),
  };
}
