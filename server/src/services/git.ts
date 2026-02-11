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
  return getGit(cwd).push();
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
