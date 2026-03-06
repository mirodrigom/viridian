/**
 * Autopilot Profile Service — built-in profiles and CRUD for custom ones.
 */

import { getDb } from '../db/database.js';
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

/** Seed built-in profiles — uses INSERT OR REPLACE to update on schema changes */
export function seedBuiltinProfiles(): void {
  const db = getDb();
  const builtinProfiles = ProfileLoader.loadBuiltinProfiles();

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO autopilot_profiles
      (id, user_id, name, role, description, system_prompt, allowed_tools, disallowed_tools,
       model, is_builtin, category, tags, subagents, mcp_servers, append_system_prompt,
       max_turns, permission_mode, icon, difficulty, domain, routing_from, routing_to, capabilities)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of builtinProfiles) {
    upsert.run(
      p.id,
      p.name,
      p.role,
      p.description,
      p.systemPrompt,
      JSON.stringify(p.allowedTools),
      JSON.stringify(p.disallowedTools),
      p.model,
      p.category || 'general',
      JSON.stringify(p.tags || []),
      JSON.stringify(p.subagents || []),
      JSON.stringify(p.mcpServers || []),
      p.appendSystemPrompt || null,
      p.maxTurns || null,
      p.permissionMode || null,
      p.icon || null,
      p.difficulty || null,
      p.domain || 'general',
      JSON.stringify(p.routingFrom || []),
      JSON.stringify(p.routingTo || []),
      JSON.stringify(p.capabilities || []),
    );
  }

  log.info({ count: builtinProfiles.length }, 'Seeded built-in profiles to database');
}

/** Get all profiles (built-in + user's custom) */
export function getProfiles(userId: number): AutopilotProfile[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM autopilot_profiles
    WHERE is_builtin = 1 OR user_id = ?
    ORDER BY is_builtin DESC, name ASC
  `).all(userId) as Record<string, unknown>[];

  return rows.map(rowToProfile);
}

/** Get a single profile by ID */
export function getProfile(id: string): AutopilotProfile | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM autopilot_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProfile(row) : null;
}

/** Create a custom profile */
export function createProfile(userId: number, data: {
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
}): AutopilotProfile {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO autopilot_profiles
      (id, user_id, name, role, description, system_prompt, allowed_tools, disallowed_tools,
       model, is_builtin, category, tags, subagents, mcp_servers, append_system_prompt,
       max_turns, permission_mode, icon, difficulty, domain, routing_from, routing_to, capabilities)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    userId,
    data.name,
    data.role,
    data.description,
    data.systemPrompt,
    JSON.stringify(data.allowedTools),
    JSON.stringify(data.disallowedTools),
    data.model,
    data.category || 'general',
    JSON.stringify(data.tags || []),
    JSON.stringify(data.subagents || []),
    JSON.stringify(data.mcpServers || []),
    data.appendSystemPrompt || null,
    data.maxTurns || null,
    data.permissionMode || null,
    data.icon || null,
    data.difficulty || null,
    data.domain || 'general',
    JSON.stringify(data.routingFrom || []),
    JSON.stringify(data.routingTo || []),
    JSON.stringify(data.capabilities || []),
  );

  return getProfile(id)!;
}

/** Update a custom profile (cannot update built-in) */
export function updateProfile(id: string, data: {
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
}): AutopilotProfile | null {
  const db = getDb();
  const existing = db.prepare('SELECT is_builtin FROM autopilot_profiles WHERE id = ?').get(id) as { is_builtin: number } | undefined;
  if (!existing || existing.is_builtin) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.role !== undefined) { sets.push('role = ?'); vals.push(data.role); }
  if (data.description !== undefined) { sets.push('description = ?'); vals.push(data.description); }
  if (data.systemPrompt !== undefined) { sets.push('system_prompt = ?'); vals.push(data.systemPrompt); }
  if (data.allowedTools !== undefined) { sets.push('allowed_tools = ?'); vals.push(JSON.stringify(data.allowedTools)); }
  if (data.disallowedTools !== undefined) { sets.push('disallowed_tools = ?'); vals.push(JSON.stringify(data.disallowedTools)); }
  if (data.model !== undefined) { sets.push('model = ?'); vals.push(data.model); }
  if (data.category !== undefined) { sets.push('category = ?'); vals.push(data.category); }
  if (data.tags !== undefined) { sets.push('tags = ?'); vals.push(JSON.stringify(data.tags)); }
  if (data.subagents !== undefined) { sets.push('subagents = ?'); vals.push(JSON.stringify(data.subagents)); }
  if (data.mcpServers !== undefined) { sets.push('mcp_servers = ?'); vals.push(JSON.stringify(data.mcpServers)); }
  if (data.appendSystemPrompt !== undefined) { sets.push('append_system_prompt = ?'); vals.push(data.appendSystemPrompt); }
  if (data.maxTurns !== undefined) { sets.push('max_turns = ?'); vals.push(data.maxTurns); }
  if (data.permissionMode !== undefined) { sets.push('permission_mode = ?'); vals.push(data.permissionMode); }
  if (data.icon !== undefined) { sets.push('icon = ?'); vals.push(data.icon); }
  if (data.difficulty !== undefined) { sets.push('difficulty = ?'); vals.push(data.difficulty); }
  if (data.domain !== undefined) { sets.push('domain = ?'); vals.push(data.domain); }
  if (data.routingFrom !== undefined) { sets.push('routing_from = ?'); vals.push(JSON.stringify(data.routingFrom)); }
  if (data.routingTo !== undefined) { sets.push('routing_to = ?'); vals.push(JSON.stringify(data.routingTo)); }
  if (data.capabilities !== undefined) { sets.push('capabilities = ?'); vals.push(JSON.stringify(data.capabilities)); }

  if (sets.length === 0) return getProfile(id);

  vals.push(id);
  db.prepare(`UPDATE autopilot_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getProfile(id);
}

/** Delete a custom profile (cannot delete built-in) */
export function deleteProfile(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM autopilot_profiles WHERE id = ? AND is_builtin = 0').run(id);
  return result.changes > 0;
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