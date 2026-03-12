/**
 * File Automation Service — AI-powered file management operations.
 *
 * Provides batch rename, classify, organize, and merge operations
 * using Claude to generate intelligent suggestions.
 */

import { readdir, readFile, rename, writeFile, mkdir, stat } from 'fs/promises';
import { join, relative, basename, dirname, extname } from 'path';
import { claudeQuery } from './claude-sdk.js';
import { createLogger } from '../logger.js';

const log = createLogger('file-automation');

// ─── Types ──────────────────────────────────────────────────────────────

export interface RenameMapping {
  original: string;
  renamed: string;
}

export interface ClassifyResult {
  file: string;
  category: string;
  targetFolder: string;
}

export interface OrganizeResult {
  source: string;
  destination: string;
}

export interface UndoEntry {
  id: string;
  operation: 'rename' | 'classify' | 'organize' | 'merge';
  timestamp: number;
  mappings: Array<{ from: string; to: string }>;
}

// In-memory undo stack (per-session, limited to last 20 operations)
const undoStack: UndoEntry[] = [];
const MAX_UNDO = 20;

function pushUndo(entry: UndoEntry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

export function getUndoStack(): UndoEntry[] {
  return [...undoStack].reverse();
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Collect full text response from Claude query */
async function askClaude(prompt: string, cwd: string): Promise<string> {
  let text = '';
  for await (const msg of claudeQuery({
    prompt,
    cwd,
    noTools: true,
    permissionMode: 'bypassPermissions',
  })) {
    if (msg.type === 'text_delta') {
      text += msg.text;
    } else if (msg.type === 'error') {
      throw new Error(`Claude error: ${msg.error}`);
    }
  }
  return text.trim();
}

/** Extract JSON from Claude response that might contain markdown code blocks */
function extractJson(text: string): string {
  // Try to extract from ```json ... ``` blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (jsonBlockMatch) return jsonBlockMatch[1]!.trim();
  // Try to find raw JSON array or object
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) return jsonMatch[1]!.trim();
  return text;
}

/** List files in a directory (non-recursive, skipping hidden/ignored) */
async function listFiles(dirPath: string): Promise<string[]> {
  const IGNORED = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.DS_Store']);
  const files: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth <= 0) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, depth - 1);
        } else {
          files.push(relative(dirPath, fullPath));
        }
      }
    } catch { /* skip inaccessible */ }
  }

  await walk(dirPath, 4);
  return files;
}

// ─── Batch Rename ───────────────────────────────────────────────────────

export async function previewBatchRename(
  directoryPath: string,
  instruction: string,
): Promise<RenameMapping[]> {
  const files = await listFiles(directoryPath);
  if (files.length === 0) throw new Error('No files found in directory');
  if (files.length > 200) throw new Error('Too many files (max 200). Narrow the directory.');

  const prompt = `You are a file renaming assistant. Given this list of file paths and the user's instruction, produce a JSON array of rename mappings.

File paths:
${files.map(f => `- ${f}`).join('\n')}

Instruction: "${instruction}"

Rules:
- Output ONLY a JSON array of objects with "original" and "renamed" keys.
- Preserve file extensions unless the instruction says otherwise.
- Preserve directory structure (only rename the filename part, not parent directories).
- If a file doesn't need renaming, omit it from the array.
- No explanations, just the JSON array.

Example output:
[{"original": "My File (1).txt", "renamed": "my-file-1.txt"}]`;

  const response = await askClaude(prompt, directoryPath);
  const json = extractJson(response);
  const mappings: RenameMapping[] = JSON.parse(json);

  // Validate mappings
  return mappings.filter(m =>
    m.original && m.renamed &&
    m.original !== m.renamed &&
    files.includes(m.original)
  );
}

export async function executeBatchRename(
  directoryPath: string,
  mappings: RenameMapping[],
): Promise<{ success: string[]; errors: Array<{ file: string; error: string }> }> {
  const success: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  const undoMappings: Array<{ from: string; to: string }> = [];

  for (const m of mappings) {
    const srcPath = join(directoryPath, m.original);
    const dstDir = join(directoryPath, dirname(m.renamed));
    const dstPath = join(directoryPath, m.renamed);

    try {
      // Ensure destination directory exists
      await mkdir(dstDir, { recursive: true });
      await rename(srcPath, dstPath);
      success.push(m.renamed);
      undoMappings.push({ from: dstPath, to: srcPath });
    } catch (err) {
      errors.push({ file: m.original, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (undoMappings.length > 0) {
    pushUndo({
      id: Date.now().toString(36),
      operation: 'rename',
      timestamp: Date.now(),
      mappings: undoMappings,
    });
  }

  return { success, errors };
}

// ─── Classify ───────────────────────────────────────────────────────────

export async function previewClassify(
  directoryPath: string,
  rules?: string,
): Promise<ClassifyResult[]> {
  const files = await listFiles(directoryPath);
  if (files.length === 0) throw new Error('No files found in directory');
  if (files.length > 200) throw new Error('Too many files (max 200). Narrow the directory.');

  // Read small snippet of each file for classification
  const fileSnippets: string[] = [];
  for (const f of files.slice(0, 100)) {
    const fullPath = join(directoryPath, f);
    try {
      const s = await stat(fullPath);
      if (s.size > 50_000) {
        fileSnippets.push(`${f} [${(s.size / 1024).toFixed(0)}KB, ext: ${extname(f)}]`);
      } else {
        const content = await readFile(fullPath, 'utf-8');
        const snippet = content.slice(0, 300).replace(/\n/g, ' ');
        fileSnippets.push(`${f}: ${snippet}`);
      }
    } catch {
      fileSnippets.push(`${f} [unreadable]`);
    }
  }

  const rulesText = rules
    ? `Classification rules: ${rules}`
    : 'Classify files into logical categories based on their content, type, and purpose (e.g., documents, images, code, config, data, media, etc.)';

  const prompt = `You are a file classification assistant. Analyze these files and classify them into categories.

Files (name: content snippet):
${fileSnippets.join('\n')}

${rulesText}

Output ONLY a JSON array with objects having these keys:
- "file": the original file path
- "category": the classification category
- "targetFolder": suggested subfolder to organize into (relative path)

Example: [{"file": "report.pdf", "category": "Documents", "targetFolder": "documents"}]`;

  const response = await askClaude(prompt, directoryPath);
  const json = extractJson(response);
  const results: ClassifyResult[] = JSON.parse(json);

  return results.filter(r => r.file && r.category && r.targetFolder && files.includes(r.file));
}

export async function executeClassify(
  directoryPath: string,
  classifications: ClassifyResult[],
): Promise<{ success: string[]; errors: Array<{ file: string; error: string }> }> {
  const success: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  const undoMappings: Array<{ from: string; to: string }> = [];

  for (const c of classifications) {
    const srcPath = join(directoryPath, c.file);
    const dstDir = join(directoryPath, c.targetFolder);
    const dstPath = join(dstDir, basename(c.file));

    try {
      await mkdir(dstDir, { recursive: true });
      await rename(srcPath, dstPath);
      success.push(`${c.file} -> ${join(c.targetFolder, basename(c.file))}`);
      undoMappings.push({ from: dstPath, to: srcPath });
    } catch (err) {
      errors.push({ file: c.file, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (undoMappings.length > 0) {
    pushUndo({
      id: Date.now().toString(36),
      operation: 'classify',
      timestamp: Date.now(),
      mappings: undoMappings,
    });
  }

  return { success, errors };
}

// ─── Organize ───────────────────────────────────────────────────────────

export async function previewOrganize(
  directoryPath: string,
  instruction: string,
): Promise<OrganizeResult[]> {
  const files = await listFiles(directoryPath);
  if (files.length === 0) throw new Error('No files found in directory');
  if (files.length > 200) throw new Error('Too many files (max 200). Narrow the directory.');

  const prompt = `You are a file organization assistant. Given a list of files and the user's instruction, propose a new directory structure.

Current files:
${files.map(f => `- ${f}`).join('\n')}

Instruction: "${instruction}"

Output ONLY a JSON array of objects with "source" (current path) and "destination" (new path) keys.
- Only include files that need to move.
- Destination paths should be relative to the same root directory.
- Create sensible folder names.

Example: [{"source": "utils.ts", "destination": "src/utils/utils.ts"}]`;

  const response = await askClaude(prompt, directoryPath);
  const json = extractJson(response);
  const results: OrganizeResult[] = JSON.parse(json);

  return results.filter(r =>
    r.source && r.destination &&
    r.source !== r.destination &&
    files.includes(r.source)
  );
}

export async function executeOrganize(
  directoryPath: string,
  moves: OrganizeResult[],
): Promise<{ success: string[]; errors: Array<{ file: string; error: string }> }> {
  const success: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  const undoMappings: Array<{ from: string; to: string }> = [];

  for (const m of moves) {
    const srcPath = join(directoryPath, m.source);
    const dstPath = join(directoryPath, m.destination);
    const dstDir = dirname(dstPath);

    try {
      await mkdir(dstDir, { recursive: true });
      await rename(srcPath, dstPath);
      success.push(`${m.source} -> ${m.destination}`);
      undoMappings.push({ from: dstPath, to: srcPath });
    } catch (err) {
      errors.push({ file: m.source, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (undoMappings.length > 0) {
    pushUndo({
      id: Date.now().toString(36),
      operation: 'organize',
      timestamp: Date.now(),
      mappings: undoMappings,
    });
  }

  return { success, errors };
}

// ─── Merge ──────────────────────────────────────────────────────────────

export async function previewMerge(
  filePaths: string[],
  instruction: string,
  rootPath: string,
): Promise<string> {
  if (filePaths.length < 2) throw new Error('At least 2 files required for merge');
  if (filePaths.length > 20) throw new Error('Too many files (max 20)');

  const fileContents: string[] = [];
  for (const fp of filePaths) {
    const fullPath = join(rootPath, fp);
    try {
      const content = await readFile(fullPath, 'utf-8');
      fileContents.push(`=== FILE: ${fp} ===\n${content}\n`);
    } catch (err) {
      throw new Error(`Cannot read file ${fp}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const prompt = `You are a file merge assistant. Merge the following files according to the instruction.

${fileContents.join('\n')}

Instruction: "${instruction}"

Output ONLY the merged file content. No explanations, no code blocks, just the raw merged content.`;

  return askClaude(prompt, rootPath);
}

export async function executeMerge(
  filePaths: string[],
  mergedContent: string,
  outputPath: string,
  rootPath: string,
): Promise<void> {
  const fullOutputPath = join(rootPath, outputPath);
  const outputDir = dirname(fullOutputPath);
  await mkdir(outputDir, { recursive: true });
  await writeFile(fullOutputPath, mergedContent, 'utf-8');

  // Store undo entry (note: merge undo doesn't restore deleted source files, just tracks the output)
  pushUndo({
    id: Date.now().toString(36),
    operation: 'merge',
    timestamp: Date.now(),
    mappings: [{ from: fullOutputPath, to: '' }], // empty 'to' means delete on undo
  });
}

// ─── Undo ───────────────────────────────────────────────────────────────

export async function undoLastOperation(): Promise<{
  undone: UndoEntry | null;
  success: string[];
  errors: Array<{ file: string; error: string }>;
}> {
  const entry = undoStack.pop();
  if (!entry) return { undone: null, success: [], errors: [] };

  const success: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const m of entry.mappings) {
    if (!m.to) {
      // Merge undo — we can't reliably undo file creation without deleting
      // Just skip and report
      success.push(`(merge output at ${m.from} kept — remove manually if needed)`);
      continue;
    }
    try {
      const toDir = dirname(m.to);
      await mkdir(toDir, { recursive: true });
      await rename(m.from, m.to);
      success.push(`${m.from} -> ${m.to}`);
    } catch (err) {
      errors.push({ file: m.from, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { undone: entry, success, errors };
}
