/**
 * Graph Environment — prepares per-node and per-run sandbox directories.
 *
 * Exports: prepareNodeEnvironment(), prepareRunSandbox()
 * Types: NodeEnvironment, RunSandbox
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ResolvedNode } from './graph-resolver.js';
import { debugLog } from './graph-utils.js';

// ─── Types ──────────────────────────────────────────────────────────────

/** Per-node environment (tmpdir with CLAUDE.md + .mcp.json) */
export interface NodeEnvironment {
  tmpDir: string | null;
  effectiveCwd: string;
  realProjectPath: string;
  cleanup: () => void;
}

/** Run-level sandbox directory in /tmp */
export interface RunSandbox {
  sandboxDir: string;
  projectMirrorDir: string;
  cleanup: () => void;
}

// ─── Per-Node Environment ────────────────────────────────────────────────

/**
 * Create a temporary directory for a specific node with its own CLAUDE.md and
 * .mcp.json. Each node gets isolated rules and MCP servers from its direct
 * connections only (not inherited from parent or siblings).
 */
export function prepareNodeEnvironment(
  resolved: ResolvedNode,
  originalCwd: string,
  sandbox: RunSandbox | null,
): NodeEnvironment {
  const nodeRules = resolved.rules;
  const nodeMcps = resolved.mcps;
  const nodeSkills = resolved.skills;
  const projectPath = sandbox ? sandbox.projectMirrorDir : originalCwd;

  // No rules, MCPs, or skills -> no tmpdir needed, use project path
  if (nodeRules.length === 0 && nodeMcps.length === 0 && nodeSkills.length === 0) {
    return {
      tmpDir: null,
      effectiveCwd: projectPath,
      realProjectPath: projectPath,
      cleanup: () => {},
    };
  }

  const nodeLabel = (resolved.node.data.label as string) || resolved.node.id;
  const parentDir = sandbox ? sandbox.sandboxDir : tmpdir();
  const tmpDir = mkdtempSync(join(parentDir, `graph-node-${resolved.node.id.slice(0, 8)}-`));
  debugLog(`[GraphRunner] Created node tmpdir: ${tmpDir} for "${nodeLabel}" (rules=${nodeRules.length}, mcps=${nodeMcps.length}, skills=${nodeSkills.length})`);

  // Write CLAUDE.md with this node's rules
  if (nodeRules.length > 0) {
    const ruleLines = nodeRules.map(r => {
      const ruleType = ((r.data.ruleType as string) || 'guideline').toUpperCase();
      const ruleText = (r.data.ruleText as string) || '';
      return `- [${ruleType}] ${r.data.label || 'Rule'}: ${ruleText}`;
    });
    const claudeMd = `# Graph Runner Rules\n\n${ruleLines.join('\n')}\n`;
    writeFileSync(join(tmpDir, 'CLAUDE.md'), claudeMd, 'utf8');
  }

  // Write .mcp.json with this node's MCP servers
  if (nodeMcps.length > 0) {
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const mcpNode of nodeMcps) {
      const name = ((mcpNode.data.label as string) || `mcp-${mcpNode.id}`)
        .replace(/\s+/g, '-')
        .toLowerCase();
      const serverType = mcpNode.data.serverType as string;

      if (serverType === 'stdio') {
        mcpServers[name] = {
          type: 'stdio',
          command: mcpNode.data.command as string,
          args: (mcpNode.data.args as string[]) || [],
          ...(mcpNode.data.env ? { env: mcpNode.data.env } : {}),
        };
      } else {
        mcpServers[name] = {
          type: serverType,
          url: mcpNode.data.url as string,
          ...(mcpNode.data.headers ? { headers: mcpNode.data.headers } : {}),
        };
      }
    }
    writeFileSync(
      join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers }, null, 2),
      'utf8',
    );
  }

  // Write on-demand skill files (agents read these only when needed)
  if (nodeSkills.length > 0) {
    const skillsDir = join(tmpDir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    for (const skill of nodeSkills) {
      const commandSlug = ((skill.data.command as string) || 'unnamed')
        .replace(/^\//, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-');
      const label = (skill.data.label as string) || 'Skill';
      const template = (skill.data.promptTemplate as string) || '';
      const tools = (skill.data.allowedTools as string[]) || [];
      const content = `# ${label}\n\nCommand: \`${skill.data.command}\`\nAllowed Tools: ${tools.join(', ') || 'all default tools'}\n\n## Instructions\n\n${template}\n`;
      writeFileSync(join(skillsDir, `${commandSlug}.md`), content, 'utf8');
    }
    debugLog(`[GraphRunner] Wrote ${nodeSkills.length} skill files to ${skillsDir}`);
  }

  return {
    tmpDir,
    effectiveCwd: tmpDir,
    realProjectPath: projectPath,
    cleanup: () => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) { console.warn('[GraphRunner] node tmpdir cleanup failed:', err); }
    },
  };
}

// ─── Run Sandbox ────────────────────────────────────────────────────────

/**
 * Create a run-level sandbox directory in /tmp.
 * Symlinks the real project into the sandbox so node environments
 * (CLAUDE.md, .mcp.json) are isolated while agents still access project files.
 */
export function prepareRunSandbox(runId: string, projectCwd: string): RunSandbox {
  const sandboxDir = mkdtempSync(join(tmpdir(), `graph-run-${runId.slice(0, 8)}-`));
  const projectMirrorDir = join(sandboxDir, 'project');

  symlinkSync(projectCwd, projectMirrorDir);
  debugLog(`[GraphRunner] Created run sandbox: ${sandboxDir} → ${projectCwd}`);

  return {
    sandboxDir,
    projectMirrorDir,
    cleanup: () => {
      try {
        rmSync(sandboxDir, { recursive: true, force: true });
        debugLog(`[GraphRunner] Cleaned up sandbox: ${sandboxDir}`);
      } catch (err) {
        console.warn('[GraphRunner] sandbox cleanup failed:', err);
      }
    },
  };
}
