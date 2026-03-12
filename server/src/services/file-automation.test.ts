import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────

// Mock fs/promises
const mockReaddir = vi.fn();
const mockReadFile = vi.fn();
const mockRename = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockStat = vi.fn();

vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

// Mock claude-sdk
const mockClaudeQuery = vi.fn();
vi.mock('./claude-sdk.js', () => ({
  claudeQuery: (...args: unknown[]) => mockClaudeQuery(...args),
}));

vi.mock('../logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Must import after mocks
import {
  previewBatchRename,
  executeBatchRename,
  previewClassify,
  executeClassify,
  previewOrganize,
  executeOrganize,
  previewMerge,
  executeMerge,
  getUndoStack,
  undoLastOperation,
} from './file-automation.js';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Simulate readdir returning file entries for the listFiles helper */
function setupListFiles(files: string[]) {
  // listFiles calls readdir with { withFileTypes: true } at depth up to 4
  // For simplicity, return all files at the top level
  mockReaddir.mockResolvedValue(
    files.map((name) => ({
      name,
      isDirectory: () => false,
    })),
  );
}

/** Create an async generator that yields Claude messages from a text response */
function makeClaude(responseText: string) {
  return async function* () {
    yield { type: 'text_delta', text: responseText };
  };
}

/** Create an async generator that yields a Claude error */
function makeClaudeError(errorMsg: string) {
  return async function* () {
    yield { type: 'error', error: errorMsg };
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

describe('previewBatchRename', () => {
  it('returns rename mappings from Claude response', async () => {
    const files = ['photo1.jpg', 'photo2.jpg', 'photo3.jpg'];
    setupListFiles(files);

    const mappings = [
      { original: 'photo1.jpg', renamed: 'vacation-01.jpg' },
      { original: 'photo2.jpg', renamed: 'vacation-02.jpg' },
    ];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(mappings))());

    const result = await previewBatchRename('/test/dir', 'prefix with vacation-');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ original: 'photo1.jpg', renamed: 'vacation-01.jpg' });
    expect(result[1]).toEqual({ original: 'photo2.jpg', renamed: 'vacation-02.jpg' });
  });

  it('handles Claude response wrapped in markdown code block', async () => {
    setupListFiles(['file.txt']);

    const responseText = '```json\n[{"original": "file.txt", "renamed": "renamed-file.txt"}]\n```';
    mockClaudeQuery.mockReturnValueOnce(makeClaude(responseText)());

    const result = await previewBatchRename('/test/dir', 'rename files');

    expect(result).toHaveLength(1);
    expect(result[0]!.renamed).toBe('renamed-file.txt');
  });

  it('filters out mappings where original equals renamed', async () => {
    setupListFiles(['a.txt', 'b.txt']);

    const mappings = [
      { original: 'a.txt', renamed: 'a.txt' }, // no change
      { original: 'b.txt', renamed: 'b-new.txt' },
    ];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(mappings))());

    const result = await previewBatchRename('/test/dir', 'rename');

    expect(result).toHaveLength(1);
    expect(result[0]!.original).toBe('b.txt');
  });

  it('filters out mappings referencing files not in the directory', async () => {
    setupListFiles(['exists.txt']);

    const mappings = [
      { original: 'exists.txt', renamed: 'renamed.txt' },
      { original: 'ghost.txt', renamed: 'phantom.txt' }, // not in dir
    ];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(mappings))());

    const result = await previewBatchRename('/test/dir', 'rename');

    expect(result).toHaveLength(1);
    expect(result[0]!.original).toBe('exists.txt');
  });

  it('throws when the directory is empty', async () => {
    setupListFiles([]);

    await expect(previewBatchRename('/test/dir', 'rename')).rejects.toThrow(
      'No files found in directory',
    );
  });

  it('throws when Claude returns an error', async () => {
    setupListFiles(['file.txt']);
    mockClaudeQuery.mockReturnValueOnce(makeClaudeError('Service unavailable')());

    await expect(previewBatchRename('/test/dir', 'rename')).rejects.toThrow(
      'Claude error: Service unavailable',
    );
  });
});

describe('executeBatchRename', () => {
  it('renames files and returns success list', async () => {
    const mappings = [
      { original: 'old.txt', renamed: 'new.txt' },
      { original: 'foo.js', renamed: 'bar.js' },
    ];

    const result = await executeBatchRename('/test/dir', mappings);

    expect(result.success).toEqual(['new.txt', 'bar.js']);
    expect(result.errors).toHaveLength(0);
    expect(mockRename).toHaveBeenCalledTimes(2);
    expect(mockMkdir).toHaveBeenCalledTimes(2);
  });

  it('reports errors for failed renames without stopping', async () => {
    mockRename
      .mockRejectedValueOnce(new Error('EACCES: permission denied'))
      .mockResolvedValueOnce(undefined);

    const mappings = [
      { original: 'locked.txt', renamed: 'locked-new.txt' },
      { original: 'ok.txt', renamed: 'ok-new.txt' },
    ];

    const result = await executeBatchRename('/test/dir', mappings);

    expect(result.success).toEqual(['ok-new.txt']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.file).toBe('locked.txt');
    expect(result.errors[0]!.error).toContain('permission denied');
  });

  it('pushes an undo entry on success', async () => {
    const mappings = [{ original: 'a.txt', renamed: 'b.txt' }];

    await executeBatchRename('/test/dir', mappings);

    const stack = getUndoStack();
    expect(stack.length).toBeGreaterThan(0);
    expect(stack[0]!.operation).toBe('rename');
    expect(stack[0]!.mappings).toHaveLength(1);
  });
});

describe('previewClassify', () => {
  it('returns classification results from Claude', async () => {
    setupListFiles(['report.pdf', 'script.py']);

    // Mock stat and readFile for snippet building
    mockStat.mockResolvedValue({ size: 100 });
    mockReadFile.mockResolvedValue('Some file content here');

    const classifications = [
      { file: 'report.pdf', category: 'Documents', targetFolder: 'documents' },
      { file: 'script.py', category: 'Code', targetFolder: 'code' },
    ];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(classifications))());

    const result = await previewClassify('/test/dir');

    expect(result).toHaveLength(2);
    expect(result[0]!.category).toBe('Documents');
    expect(result[1]!.targetFolder).toBe('code');
  });

  it('filters out classifications for files not in directory', async () => {
    setupListFiles(['real.txt']);
    mockStat.mockResolvedValue({ size: 50 });
    mockReadFile.mockResolvedValue('content');

    const classifications = [
      { file: 'real.txt', category: 'Docs', targetFolder: 'docs' },
      { file: 'fake.txt', category: 'Docs', targetFolder: 'docs' },
    ];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(classifications))());

    const result = await previewClassify('/test/dir');

    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe('real.txt');
  });

  it('throws for empty directories', async () => {
    setupListFiles([]);

    await expect(previewClassify('/test/dir')).rejects.toThrow(
      'No files found in directory',
    );
  });

  it('passes custom classification rules to Claude', async () => {
    setupListFiles(['file.txt']);
    mockStat.mockResolvedValue({ size: 50 });
    mockReadFile.mockResolvedValue('test');

    mockClaudeQuery.mockReturnValueOnce(
      makeClaude(JSON.stringify([{ file: 'file.txt', category: 'Custom', targetFolder: 'custom' }]))(),
    );

    await previewClassify('/test/dir', 'Sort into custom categories');

    expect(mockClaudeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Sort into custom categories'),
      }),
    );
  });
});

describe('executeClassify', () => {
  it('moves files to their target folders', async () => {
    const classifications = [
      { file: 'report.pdf', category: 'Docs', targetFolder: 'documents' },
    ];

    const result = await executeClassify('/test/dir', classifications);

    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toContain('report.pdf');
    expect(result.errors).toHaveLength(0);
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalled();
  });

  it('reports errors without stopping', async () => {
    mockRename.mockRejectedValueOnce(new Error('ENOENT'));

    const classifications = [
      { file: 'missing.txt', category: 'Docs', targetFolder: 'documents' },
    ];

    const result = await executeClassify('/test/dir', classifications);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.file).toBe('missing.txt');
  });
});

describe('previewOrganize', () => {
  it('returns organization proposals from Claude', async () => {
    setupListFiles(['utils.ts', 'app.ts', 'readme.md']);

    const moves = [
      { source: 'utils.ts', destination: 'src/utils/utils.ts' },
      { source: 'app.ts', destination: 'src/app.ts' },
    ];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(moves))());

    const result = await previewOrganize('/test/dir', 'organize into src folder');

    expect(result).toHaveLength(2);
    expect(result[0]!.destination).toBe('src/utils/utils.ts');
  });

  it('filters out moves where source equals destination', async () => {
    setupListFiles(['a.ts']);

    const moves = [{ source: 'a.ts', destination: 'a.ts' }];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(moves))());

    const result = await previewOrganize('/test/dir', 'organize');

    expect(result).toHaveLength(0);
  });

  it('filters out moves for files not in the directory', async () => {
    setupListFiles(['real.ts']);

    const moves = [
      { source: 'real.ts', destination: 'src/real.ts' },
      { source: 'ghost.ts', destination: 'src/ghost.ts' },
    ];
    mockClaudeQuery.mockReturnValueOnce(makeClaude(JSON.stringify(moves))());

    const result = await previewOrganize('/test/dir', 'organize');

    expect(result).toHaveLength(1);
  });

  it('throws for empty directories', async () => {
    setupListFiles([]);

    await expect(previewOrganize('/test/dir', 'organize')).rejects.toThrow(
      'No files found in directory',
    );
  });
});

describe('executeOrganize', () => {
  it('moves files to their new locations', async () => {
    const moves = [
      { source: 'utils.ts', destination: 'src/utils/utils.ts' },
    ];

    const result = await executeOrganize('/test/dir', moves);

    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toContain('utils.ts -> src/utils/utils.ts');
    expect(result.errors).toHaveLength(0);
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalled();
  });

  it('reports errors for failed moves', async () => {
    mockRename.mockRejectedValueOnce(new Error('ENOENT: no such file'));

    const moves = [
      { source: 'missing.ts', destination: 'src/missing.ts' },
    ];

    const result = await executeOrganize('/test/dir', moves);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('ENOENT');
  });

  it('pushes an undo entry for successful moves', async () => {
    const moves = [
      { source: 'a.ts', destination: 'src/a.ts' },
    ];

    await executeOrganize('/test/dir', moves);

    const stack = getUndoStack();
    const latest = stack[0];
    expect(latest!.operation).toBe('organize');
  });
});

describe('previewMerge', () => {
  it('returns merged content from Claude', async () => {
    mockReadFile
      .mockResolvedValueOnce('File A content')
      .mockResolvedValueOnce('File B content');

    mockClaudeQuery.mockReturnValueOnce(
      makeClaude('Merged: File A content\nFile B content')(),
    );

    const result = await previewMerge(
      ['a.txt', 'b.txt'],
      'concatenate files',
      '/test/dir',
    );

    expect(result).toBe('Merged: File A content\nFile B content');
  });

  it('throws when fewer than 2 files are provided', async () => {
    await expect(previewMerge(['only-one.txt'], 'merge', '/test')).rejects.toThrow(
      'At least 2 files required for merge',
    );
  });

  it('throws when more than 20 files are provided', async () => {
    const files = Array.from({ length: 21 }, (_, i) => `file-${i}.txt`);
    await expect(previewMerge(files, 'merge', '/test')).rejects.toThrow(
      'Too many files (max 20)',
    );
  });

  it('throws when a file cannot be read', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: file not found'));

    await expect(
      previewMerge(['missing.txt', 'also-missing.txt'], 'merge', '/test'),
    ).rejects.toThrow('Cannot read file missing.txt');
  });

  it('throws when Claude returns an error during merge', async () => {
    mockReadFile
      .mockResolvedValueOnce('content a')
      .mockResolvedValueOnce('content b');

    mockClaudeQuery.mockReturnValueOnce(makeClaudeError('Model overloaded')());

    await expect(
      previewMerge(['a.txt', 'b.txt'], 'merge', '/test'),
    ).rejects.toThrow('Claude error: Model overloaded');
  });
});

describe('executeMerge', () => {
  it('writes merged content to the output path', async () => {
    await executeMerge(
      ['a.txt', 'b.txt'],
      'merged content here',
      'output/merged.txt',
      '/test/dir',
    );

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('output'),
      { recursive: true },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('merged.txt'),
      'merged content here',
      'utf-8',
    );
  });

  it('pushes a merge undo entry', async () => {
    await executeMerge(
      ['a.txt', 'b.txt'],
      'content',
      'out.txt',
      '/test/dir',
    );

    const stack = getUndoStack();
    const latest = stack[0];
    expect(latest!.operation).toBe('merge');
    // Merge undo has empty 'to' field
    expect(latest!.mappings[0]!.to).toBe('');
  });
});

describe('undoLastOperation', () => {
  it('reverses a rename operation', async () => {
    // Execute a rename to populate the undo stack
    const mappings = [{ original: 'old.txt', renamed: 'new.txt' }];
    await executeBatchRename('/test/dir', mappings);
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    const result = await undoLastOperation();

    expect(result.undone).not.toBeNull();
    expect(result.undone!.operation).toBe('rename');
    expect(result.success).toHaveLength(1);
    expect(mockRename).toHaveBeenCalled();
  });

  it('returns null undone when stack is empty', async () => {
    // Drain the stack
    let result;
    do {
      result = await undoLastOperation();
    } while (result.undone !== null);

    result = await undoLastOperation();
    expect(result.undone).toBeNull();
    expect(result.success).toHaveLength(0);
  });

  it('handles merge undo without renaming (skips empty to)', async () => {
    await executeMerge(['a.txt', 'b.txt'], 'content', 'out.txt', '/test');
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);

    const result = await undoLastOperation();

    expect(result.undone!.operation).toBe('merge');
    // Merge undo skips rename (empty 'to'), just reports
    expect(mockRename).not.toHaveBeenCalled();
    expect(result.success).toHaveLength(1);
    expect(result.success[0]).toContain('kept');
  });

  it('reports errors during undo without throwing', async () => {
    // Execute a rename to populate stack
    const mappings = [{ original: 'x.txt', renamed: 'y.txt' }];
    await executeBatchRename('/test/dir', mappings);
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockRename.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await undoLastOperation();

    expect(result.undone).not.toBeNull();
    expect(result.errors).toHaveLength(1);
  });
});

describe('error handling for AI service failures', () => {
  it('previewBatchRename propagates Claude errors', async () => {
    setupListFiles(['test.txt']);
    mockClaudeQuery.mockReturnValueOnce(makeClaudeError('API key invalid')());

    await expect(previewBatchRename('/test/dir', 'rename')).rejects.toThrow(
      'Claude error: API key invalid',
    );
  });

  it('previewOrganize propagates Claude errors', async () => {
    setupListFiles(['test.txt']);
    mockClaudeQuery.mockReturnValueOnce(makeClaudeError('Rate limited')());

    await expect(previewOrganize('/test/dir', 'organize')).rejects.toThrow(
      'Claude error: Rate limited',
    );
  });

  it('previewClassify propagates Claude errors', async () => {
    setupListFiles(['test.txt']);
    mockStat.mockResolvedValue({ size: 50 });
    mockReadFile.mockResolvedValue('content');
    mockClaudeQuery.mockReturnValueOnce(makeClaudeError('Timeout')());

    await expect(previewClassify('/test/dir')).rejects.toThrow('Claude error: Timeout');
  });
});
