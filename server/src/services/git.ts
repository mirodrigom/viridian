import simpleGit, { type SimpleGit, type StatusResult, type DiffResult } from 'simple-git';

function getGit(cwd: string): SimpleGit {
  return simpleGit(cwd);
}

export async function getStatus(cwd: string): Promise<StatusResult> {
  return getGit(cwd).status();
}

export async function getDiff(cwd: string, staged = false): Promise<string> {
  const git = getGit(cwd);
  return staged ? git.diff(['--cached']) : git.diff();
}

export async function stageFiles(cwd: string, files: string[]) {
  return getGit(cwd).add(files);
}

export async function unstageFiles(cwd: string, files: string[]) {
  return getGit(cwd).reset(['HEAD', ...files]);
}

export async function commit(cwd: string, message: string) {
  return getGit(cwd).commit(message);
}

export async function getLog(cwd: string, maxCount = 20) {
  return getGit(cwd).log({ maxCount });
}

export async function getBranches(cwd: string) {
  return getGit(cwd).branch();
}

export async function discardFile(cwd: string, filePath: string) {
  return getGit(cwd).checkout(['--', filePath]);
}

export async function pull(cwd: string) {
  return getGit(cwd).pull();
}

export async function push(cwd: string) {
  const git = getGit(cwd);
  const status = await git.status();
  const branch = status.current;
  if (!branch || branch === 'HEAD') {
    throw new Error('Cannot push: not on a branch (detached HEAD). Please checkout a branch first.');
  }
  return git.push(['-u', 'origin', branch]);
}

export async function fetch(cwd: string) {
  return getGit(cwd).fetch();
}

export async function checkoutBranch(cwd: string, branchName: string) {
  return getGit(cwd).checkout(branchName);
}

export async function createBranch(cwd: string, branchName: string) {
  return getGit(cwd).checkoutLocalBranch(branchName);
}

export async function deleteBranch(cwd: string, branchName: string, force = false) {
  return getGit(cwd).branch([force ? '-D' : '-d', branchName]);
}

export async function getFileDiff(cwd: string, filePath: string, staged = false): Promise<string> {
  const git = getGit(cwd);
  return staged ? git.diff(['--cached', '--', filePath]) : git.diff(['--', filePath]);
}

export async function getShowCommit(cwd: string, hash: string): Promise<string> {
  const git = getGit(cwd);
  return git.show([hash, '--stat', '--patch']);
}

export async function getUserConfig(cwd: string): Promise<{ name: string; email: string }> {
  const git = getGit(cwd);
  const name = await git.getConfig('user.name');
  const email = await git.getConfig('user.email');
  return { name: name.value || '', email: email.value || '' };
}

export async function setUserConfig(cwd: string, name: string, email: string): Promise<void> {
  const git = getGit(cwd);
  await git.addConfig('user.name', name);
  await git.addConfig('user.email', email);
}

export interface FileHistoryEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
}

export async function getFileHistory(cwd: string, filePath: string, maxCount = 50): Promise<FileHistoryEntry[]> {
  const git = getGit(cwd);
  const result = await git.log({ file: filePath, maxCount, '--follow': null } as any);
  return (result.all || []).map((entry: any) => ({
    hash: entry.hash,
    date: entry.date,
    message: entry.message,
    author_name: entry.author_name,
  }));
}

export async function getFileAtCommit(cwd: string, filePath: string, commitHash: string): Promise<string> {
  const git = getGit(cwd);
  return git.show([`${commitHash}:${filePath}`]);
}

export async function restoreFileFromCommit(cwd: string, filePath: string, commitHash: string): Promise<void> {
  const git = getGit(cwd);
  const content = await git.show([`${commitHash}:${filePath}`]);
  const { writeFile } = await import('fs/promises');
  const { join } = await import('path');
  await writeFile(join(cwd, filePath), content, 'utf-8');
}

export async function getFileVersions(cwd: string, filePath: string, staged = false): Promise<{ original: string; modified: string }> {
  const git = getGit(cwd);
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');

  let original = '';
  try {
    original = await git.show([`HEAD:${filePath}`]);
  } catch {
    // New file — no HEAD version
    original = '';
  }

  let modified = '';
  if (staged) {
    // For staged files, show the index version
    try {
      modified = await git.show([`:${filePath}`]);
    } catch {
      modified = '';
    }
  } else {
    // For working dir changes, read the actual file
    try {
      modified = await readFile(join(cwd, filePath), 'utf-8');
    } catch {
      modified = '';
    }
  }

  return { original, modified };
}
