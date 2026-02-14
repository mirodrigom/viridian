import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, relative, extname } from 'path';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  '.cache', '.vite', '__pycache__', '.DS_Store', 'coverage',
  '.turbo', '.output', '.svelte-kit',
]);

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

export async function getFileTree(rootPath: string, depth = 3): Promise<FileNode[]> {
  return buildTree(rootPath, rootPath, depth);
}

async function buildTree(rootPath: string, currentPath: string, depth: number): Promise<FileNode[]> {
  if (depth <= 0) return [];

  try {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const nodes: FileNode[] = [];

    const sorted = entries.sort((a, b) => {
      // Directories first, then files
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

      const fullPath = join(currentPath, entry.name);
      const relativePath = relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        if (depth - 1 <= 0) {
          // At depth boundary — add placeholder so tree can expand on demand
          nodes.push({
            name: entry.name,
            path: relativePath,
            type: 'directory',
            children: [{ name: '', path: `${relativePath}/__placeholder`, type: 'file' as const }],
          });
        } else {
          const children = await buildTree(rootPath, fullPath, depth - 1);
          nodes.push({
            name: entry.name,
            path: relativePath,
            type: 'directory',
            children,
          });
        }
      } else {
        nodes.push({
          name: entry.name,
          path: relativePath,
          type: 'file',
        });
      }
    }

    return nodes;
  } catch {
    return [];
  }
}

export async function getDirectoryChildren(rootPath: string, relativePath: string): Promise<FileNode[]> {
  const fullPath = join(rootPath, relativePath);
  if (!fullPath.startsWith(rootPath)) {
    throw new Error('Access denied: path traversal detected');
  }

  try {
    const entries = await readdir(fullPath, { withFileTypes: true });
    const nodes: FileNode[] = [];

    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

      const entryFullPath = join(fullPath, entry.name);
      const entryRelativePath = relative(rootPath, entryFullPath);

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: entryRelativePath,
          type: 'directory',
          children: [{ name: '', path: `${entryRelativePath}/__placeholder`, type: 'file' as const }],
        });
      } else {
        nodes.push({
          name: entry.name,
          path: entryRelativePath,
          type: 'file',
        });
      }
    }

    return nodes;
  } catch {
    return [];
  }
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function getFileContent(rootPath: string, filePath: string): Promise<string> {
  const fullPath = join(rootPath, filePath);
  // Security: ensure the path doesn't escape the root
  if (!fullPath.startsWith(rootPath)) {
    throw new Error('Access denied: path traversal detected');
  }
  const stats = await stat(fullPath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(1)} MB exceeds 10 MB limit`);
  }
  return readFile(fullPath, 'utf-8');
}

export async function saveFileContent(rootPath: string, filePath: string, content: string): Promise<void> {
  const fullPath = join(rootPath, filePath);
  if (!fullPath.startsWith(rootPath)) {
    throw new Error('Access denied: path traversal detected');
  }
  await writeFile(fullPath, content, 'utf-8');
}

export async function searchFiles(rootPath: string, query: string, limit = 20): Promise<string[]> {
  const results: string[] = [];
  const q = query.toLowerCase();

  async function walk(dir: string, depth: number) {
    if (depth <= 0 || results.length >= limit) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= limit) break;
        if (IGNORED_DIRS.has(entry.name) || IGNORED_FILES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;

        const fullPath = join(dir, entry.name);
        const relPath = relative(rootPath, fullPath);

        if (entry.isDirectory()) {
          await walk(fullPath, depth - 1);
        } else if (relPath.toLowerCase().includes(q)) {
          results.push(relPath);
        }
      }
    } catch { /* skip inaccessible dirs */ }
  }

  await walk(rootPath, 6);
  return results;
}

export function getLanguageFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.vue': 'vue', '.html': 'html', '.css': 'css',
    '.scss': 'scss', '.json': 'json', '.md': 'markdown',
    '.py': 'python', '.rs': 'rust', '.go': 'go',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.sh': 'shell', '.bash': 'shell',
    '.sql': 'sql', '.graphql': 'graphql',
    '.svelte': 'svelte', '.astro': 'astro',
  };
  return map[ext] || 'plaintext';
}
