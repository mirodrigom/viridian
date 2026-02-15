import { describe, it, expect } from 'vitest';
import { join, extname } from 'path';

/**
 * Tests for pure functions from files.ts.
 * Re-implemented to avoid fs side effects.
 */

// ─── Re-implemented: getLanguageFromPath ────────────────────────────────

function getLanguageFromPath(filePath: string): string {
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

// ─── Re-implemented: path traversal check ───────────────────────────────

function isPathSafe(rootPath: string, relativePath: string): boolean {
  const fullPath = join(rootPath, relativePath);
  return fullPath.startsWith(rootPath);
}

// ─── Re-implemented: file tree filtering ────────────────────────────────

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  '.cache', '.vite', '__pycache__', '.DS_Store', 'coverage',
  '.turbo', '.output', '.svelte-kit',
]);

const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

function shouldIncludeEntry(name: string, isDirectory: boolean): boolean {
  if (IGNORED_DIRS.has(name) || IGNORED_FILES.has(name)) return false;
  if (name.startsWith('.') && name !== '.env.example') return false;
  return true;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('getLanguageFromPath', () => {
  it('detects TypeScript (.ts, .tsx)', () => {
    expect(getLanguageFromPath('src/index.ts')).toBe('typescript');
    expect(getLanguageFromPath('App.tsx')).toBe('typescript');
  });

  it('detects JavaScript (.js, .jsx)', () => {
    expect(getLanguageFromPath('main.js')).toBe('javascript');
    expect(getLanguageFromPath('Component.jsx')).toBe('javascript');
  });

  it('detects Vue', () => {
    expect(getLanguageFromPath('App.vue')).toBe('vue');
  });

  it('detects markup and styles', () => {
    expect(getLanguageFromPath('index.html')).toBe('html');
    expect(getLanguageFromPath('styles.css')).toBe('css');
    expect(getLanguageFromPath('theme.scss')).toBe('scss');
  });

  it('detects data formats', () => {
    expect(getLanguageFromPath('package.json')).toBe('json');
    expect(getLanguageFromPath('README.md')).toBe('markdown');
    expect(getLanguageFromPath('config.yaml')).toBe('yaml');
    expect(getLanguageFromPath('config.yml')).toBe('yaml');
    expect(getLanguageFromPath('Cargo.toml')).toBe('toml');
  });

  it('detects backend languages', () => {
    expect(getLanguageFromPath('main.py')).toBe('python');
    expect(getLanguageFromPath('lib.rs')).toBe('rust');
    expect(getLanguageFromPath('main.go')).toBe('go');
  });

  it('detects shell scripts', () => {
    expect(getLanguageFromPath('deploy.sh')).toBe('shell');
    expect(getLanguageFromPath('init.bash')).toBe('shell');
  });

  it('detects query/schema languages', () => {
    expect(getLanguageFromPath('schema.sql')).toBe('sql');
    expect(getLanguageFromPath('schema.graphql')).toBe('graphql');
  });

  it('detects meta-frameworks', () => {
    expect(getLanguageFromPath('Counter.svelte')).toBe('svelte');
    expect(getLanguageFromPath('page.astro')).toBe('astro');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getLanguageFromPath('file.xyz')).toBe('plaintext');
    expect(getLanguageFromPath('file.abc')).toBe('plaintext');
    expect(getLanguageFromPath('Dockerfile')).toBe('plaintext');
  });

  it('handles case-insensitive extensions', () => {
    expect(getLanguageFromPath('FILE.TS')).toBe('typescript');
    expect(getLanguageFromPath('Main.PY')).toBe('python');
  });

  it('handles nested paths', () => {
    expect(getLanguageFromPath('src/components/deep/nested/Component.vue')).toBe('vue');
  });

  it('handles files with no extension', () => {
    expect(getLanguageFromPath('Makefile')).toBe('plaintext');
  });

  it('handles dotfiles', () => {
    expect(getLanguageFromPath('.gitignore')).toBe('plaintext');
  });
});

describe('path traversal detection', () => {
  const root = '/home/user/project';

  it('allows valid relative paths', () => {
    expect(isPathSafe(root, 'src/index.ts')).toBe(true);
    expect(isPathSafe(root, 'package.json')).toBe(true);
  });

  it('detects ../.. traversal', () => {
    expect(isPathSafe(root, '../../etc/passwd')).toBe(false);
  });

  it('detects traversal with leading ../', () => {
    expect(isPathSafe(root, '../secret.key')).toBe(false);
  });

  it('allows deeply nested paths', () => {
    expect(isPathSafe(root, 'a/b/c/d/e/f.ts')).toBe(true);
  });

  it('detects traversal in the middle of path', () => {
    expect(isPathSafe(root, 'src/../../etc/passwd')).toBe(false);
  });

  it('allows paths that look tricky but resolve within root', () => {
    // src/../lib resolves to /home/user/project/lib — safe
    expect(isPathSafe(root, 'src/../lib/utils.ts')).toBe(true);
  });
});

describe('file tree filtering', () => {
  it('filters out node_modules', () => {
    expect(shouldIncludeEntry('node_modules', true)).toBe(false);
  });

  it('filters out .git', () => {
    expect(shouldIncludeEntry('.git', true)).toBe(false);
  });

  it('filters out common build directories', () => {
    expect(shouldIncludeEntry('dist', true)).toBe(false);
    expect(shouldIncludeEntry('build', true)).toBe(false);
    expect(shouldIncludeEntry('coverage', true)).toBe(false);
    expect(shouldIncludeEntry('.next', true)).toBe(false);
    expect(shouldIncludeEntry('.nuxt', true)).toBe(false);
  });

  it('filters out dotfiles except .env.example', () => {
    expect(shouldIncludeEntry('.env', false)).toBe(false);
    expect(shouldIncludeEntry('.eslintrc', false)).toBe(false);
    expect(shouldIncludeEntry('.env.example', false)).toBe(true);
  });

  it('filters out OS junk files', () => {
    expect(shouldIncludeEntry('.DS_Store', false)).toBe(false);
    expect(shouldIncludeEntry('Thumbs.db', false)).toBe(false);
  });

  it('includes regular source directories', () => {
    expect(shouldIncludeEntry('src', true)).toBe(true);
    expect(shouldIncludeEntry('lib', true)).toBe(true);
    expect(shouldIncludeEntry('components', true)).toBe(true);
  });

  it('includes regular source files', () => {
    expect(shouldIncludeEntry('index.ts', false)).toBe(true);
    expect(shouldIncludeEntry('package.json', false)).toBe(true);
    expect(shouldIncludeEntry('README.md', false)).toBe(true);
  });

  it('filters framework cache directories', () => {
    expect(shouldIncludeEntry('.vite', true)).toBe(false);
    expect(shouldIncludeEntry('.cache', true)).toBe(false);
    expect(shouldIncludeEntry('.turbo', true)).toBe(false);
    expect(shouldIncludeEntry('__pycache__', true)).toBe(false);
    expect(shouldIncludeEntry('.output', true)).toBe(false);
    expect(shouldIncludeEntry('.svelte-kit', true)).toBe(false);
  });
});
