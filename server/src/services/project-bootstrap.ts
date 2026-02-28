/**
 * Project bootstrap — discovers scripts, env files, and services from a project directory
 * and registers them in the management system (without starting anything).
 *
 * Discovery sources:
 *  - Scripts: package.json "scripts" + .claude/skills/ executables
 *  - Environments: .env* files in project root
 *  - Services: docker-compose.yml services + optional viridian.json
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiscoveredScript {
  name: string;
  command: string;
  source: 'package.json' | 'claude-skill' | 'shell-script' | 'viridian.json';
}

export interface DiscoveredService {
  name: string;
  command: string;
  cwd: string;
  source: 'docker-compose' | 'viridian.json';
}

export interface BootstrapResult {
  scripts: { discovered: number; added: number; existing: number; items: DiscoveredScript[] };
  environments: { files: string[] };
  services: { discovered: number; added: number; existing: number; items: DiscoveredService[] };
}

// ─── Discovery ───────────────────────────────────────────────────────────────

export function discoverScripts(projectPath: string): DiscoveredScript[] {
  const scripts: DiscoveredScript[] = [];

  // 1. package.json scripts
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && typeof pkg.scripts === 'object') {
        for (const [name, command] of Object.entries(pkg.scripts)) {
          if (typeof command === 'string') {
            scripts.push({ name, command, source: 'package.json' });
          }
        }
      }
    } catch { /* ignore malformed package.json */ }
  }

  // 2. .claude/skills/ executables
  const skillDirs = [
    join(projectPath, '.claude', 'skills'),
    join(projectPath, '.kiro', 'skills'),
  ];
  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { recursive: true });
      for (const entry of entries) {
        const entryStr = String(entry);
        const fullPath = join(dir, entryStr);
        try {
          const stat = statSync(fullPath);
          if (!stat.isFile()) continue;
          // Include shell scripts and executables
          if (entryStr.endsWith('.sh') || entryStr.endsWith('.bash') || (stat.mode & 0o111) !== 0) {
            const name = basename(entryStr, '.sh').replace('.bash', '');
            scripts.push({
              name: `skill: ${name}`,
              command: fullPath,
              source: 'claude-skill',
            });
          }
        } catch { /* skip unreadable entries */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  // 3. Shell scripts in project root (.sh, .bash)
  try {
    const entries = readdirSync(projectPath);
    for (const entry of entries) {
      if (entry.endsWith('.sh') || entry.endsWith('.bash')) {
        const fullPath = join(projectPath, entry);
        try {
          if (!statSync(fullPath).isFile()) continue;
          const name = basename(entry, entry.endsWith('.bash') ? '.bash' : '.sh');
          scripts.push({
            name,
            command: fullPath,
            source: 'shell-script',
          });
        } catch { /* skip */ }
      }
    }
  } catch { /* skip unreadable dir */ }

  return scripts;
}

export function discoverEnvFiles(projectPath: string): string[] {
  const envFiles: string[] = [];
  try {
    const entries = readdirSync(projectPath);
    for (const entry of entries) {
      if (entry === '.env' || (entry.startsWith('.env.') && !entry.endsWith('.example'))) {
        const fullPath = join(projectPath, entry);
        try {
          if (statSync(fullPath).isFile()) {
            envFiles.push(fullPath);
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip unreadable dir */ }
  // Sort: .env first, then alphabetical
  envFiles.sort((a, b) => {
    if (basename(a) === '.env') return -1;
    if (basename(b) === '.env') return 1;
    return a.localeCompare(b);
  });
  return envFiles;
}

export function discoverServices(projectPath: string): DiscoveredService[] {
  const services: DiscoveredService[] = [];

  // 1. docker-compose.yml / docker-compose.yaml
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const composePath = join(projectPath, name);
    if (!existsSync(composePath)) continue;
    try {
      const raw = readFileSync(composePath, 'utf8');
      // Simple YAML parsing: extract top-level service names under "services:"
      const servicesMatch = raw.match(/^services:\s*\n((?:[ \t]+\S.*\n?)*)/m);
      if (servicesMatch) {
        const block = servicesMatch[1];
        const serviceNames = [...block.matchAll(/^[ \t]{2}(\w[\w-]*):\s*$/gm)];
        for (const m of serviceNames) {
          services.push({
            name: m[1],
            command: `docker compose -f ${name} up ${m[1]}`,
            cwd: projectPath,
            source: 'docker-compose',
          });
        }
      }
    } catch { /* ignore parse errors */ }
    break; // only process first compose file found
  }

  // 2. viridian.json explicit services
  const viridianPath = join(projectPath, 'viridian.json');
  if (existsSync(viridianPath)) {
    try {
      const config = JSON.parse(readFileSync(viridianPath, 'utf8'));
      if (Array.isArray(config.services)) {
        for (const svc of config.services) {
          if (svc.name && svc.command) {
            services.push({
              name: svc.name,
              command: svc.command,
              cwd: svc.cwd ? join(projectPath, svc.cwd) : projectPath,
              source: 'viridian.json',
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  return services;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerDiscoveries(
  userId: number,
  projectPath: string,
  scripts: DiscoveredScript[],
  services: DiscoveredService[],
): { scriptsAdded: number; scriptsExisting: number; servicesAdded: number; servicesExisting: number } {
  const db = getDb();
  let scriptsAdded = 0;
  let scriptsExisting = 0;
  let servicesAdded = 0;
  let servicesExisting = 0;

  // Register scripts (skip duplicates by command + project_path)
  const existingScripts = db.prepare(
    'SELECT command FROM management_scripts WHERE user_id = ? AND project_path = ?',
  ).all(userId, projectPath) as { command: string }[];
  const existingScriptCmds = new Set(existingScripts.map(s => s.command));

  const scriptMaxOrder = (db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM management_scripts WHERE user_id = ?',
  ).get(userId) as { next: number }).next;

  const insertScript = db.prepare(
    'INSERT INTO management_scripts (id, user_id, name, command, cwd, project_path, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  const scriptTx = db.transaction(() => {
    let order = scriptMaxOrder;
    for (const s of scripts) {
      if (existingScriptCmds.has(s.command)) {
        scriptsExisting++;
        continue;
      }
      insertScript.run(randomUUID(), userId, s.name, s.command, projectPath, projectPath, order++);
      existingScriptCmds.add(s.command);
      scriptsAdded++;
    }
  });
  scriptTx();

  // Register services (skip duplicates by command + project_path)
  const existingServices = db.prepare(
    'SELECT command FROM management_services WHERE user_id = ? AND project_path = ?',
  ).all(userId, projectPath) as { command: string }[];
  const existingServiceCmds = new Set(existingServices.map(s => s.command));

  const serviceMaxOrder = (db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM management_services WHERE user_id = ?',
  ).get(userId) as { next: number }).next;

  const insertService = db.prepare(
    'INSERT INTO management_services (id, user_id, name, command, cwd, project_path, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  const serviceTx = db.transaction(() => {
    let order = serviceMaxOrder;
    for (const s of services) {
      if (existingServiceCmds.has(s.command)) {
        servicesExisting++;
        continue;
      }
      insertService.run(randomUUID(), userId, s.name, s.command, s.cwd || projectPath, projectPath, order++);
      existingServiceCmds.add(s.command);
      servicesAdded++;
    }
  });
  serviceTx();

  return { scriptsAdded, scriptsExisting, servicesAdded, servicesExisting };
}

// ─── Main bootstrap function ─────────────────────────────────────────────────

export function bootstrapProject(userId: number, projectPath: string): BootstrapResult {
  const scripts = discoverScripts(projectPath);
  const envFiles = discoverEnvFiles(projectPath);
  const services = discoverServices(projectPath);

  const counts = registerDiscoveries(userId, projectPath, scripts, services);

  return {
    scripts: {
      discovered: scripts.length,
      added: counts.scriptsAdded,
      existing: counts.scriptsExisting,
      items: scripts,
    },
    environments: { files: envFiles },
    services: {
      discovered: services.length,
      added: counts.servicesAdded,
      existing: counts.servicesExisting,
      items: services,
    },
  };
}
