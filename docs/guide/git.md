# Git Integration

Viridian includes a full-featured Git interface that mirrors the workflows you would perform on the command line, while adding visual diffs and AI-powered commit messages. The Git tab is available in the main tab bar whenever a project directory is open.

## Overview

The interface is split into two panels on desktop:

- **Left panel (fixed 288 px)** — branch indicator, remote operations, commit form (pinned at top), file status list (scrollable), branch management, and commit history.
- **Right panel (flexible)** — inline diff viewer that renders working-tree or staged diffs with syntax-level coloring.

On mobile (viewport < 768px), the layout switches to a **tab-based view** with two tabs:

- **Controls** — Remote operations, pinned commit form, scrollable file status, branches, and history.
- **Diff** — Selected file diff with Working/Staged toggle.

Clicking a file in the status list on mobile automatically switches to the Diff tab.

All Git operations go through an authenticated REST API (`/api/git/*`) which delegates to [simple-git](https://github.com/nickt/simple-git) on the server. Every request includes the project's `cwd` so the server operates on the correct repository.

## File Status

The file status list is rendered by the `GitStatus` component and organizes files into two visual groups:

| Section | Badge | Contents |
|---------|-------|----------|
| **Staged Changes** | `staged` | Files already added to the index (`git add`) |
| **Changes** | `M` / `U` | Modified tracked files and untracked files |

When there are no changes in either group, a "No changes" placeholder is shown.

### How status is fetched

On mount, the store calls `GET /api/git/status?cwd=...` which returns the current branch name, a `files` array (with per-file index and working-directory indicators), `modified` paths, and `not_added` (untracked) paths. The client-side store normalizes these into three reactive arrays: `staged`, `modified`, and `untracked`.

## Staging and Unstaging Files

### Individual file operations

- Click the **+** button next to any modified or untracked file to stage it.
- Staged files show an **Unstage All** button at the section header level.

### Checkbox multi-select

Every file in the Changes section has a checkbox. A header-level checkbox provides select-all / deselect-all behavior with three states:

| State | Meaning |
|-------|---------|
| Unchecked | No files selected |
| Indeterminate | Some files selected |
| Checked | All unstaged files selected |

When one or more files are selected, a **Stage Selected (N)** button appears. Clicking it stages only the checked files and then clears the selection.

**Design rationale:** Checkboxes allow precise multi-file staging without requiring keyboard modifiers (Ctrl/Shift-click), which is more natural for a web UI.

### Bulk operations

- **Stage All** stages every modified and untracked file in one request.
- **Unstage All** resets every staged file back to the working tree.

Both operations send a `POST /api/git/stage` or `POST /api/git/unstage` request with the full file list, then automatically refresh the status.

## Inline Diff Viewer

The `DiffViewer` component parses raw unified-diff output into a structured, per-file view. Two toggle buttons at the top of the right panel switch between **Working Changes** (`git diff`) and **Staged Changes** (`git diff --cached`).

### Diff parsing

The raw diff string is split on `diff --git` boundaries. For each file, the parser extracts:

- **File path** from the `a/... b/...` header.
- **Hunks** delineated by `@@` markers. Each hunk header is displayed in a blue-tinted bar.
- **Lines** classified into four types:

| Type | Prefix | Row color | Text color |
|------|--------|-----------|------------|
| `add` | `+` | Green 10% | Green 300 |
| `del` | `-` | Red 10% | Red 300 |
| `ctx` | (space) | None | Foreground 70% |
| `hdr` | `\` | None | Muted italic |

### Line numbers

Each line tracks both old-file and new-file line numbers. Added lines only show the new-file number; deleted lines only show the old-file number; context lines show both. This matches the two-column gutter style used by GitHub and VS Code.

### Summary bar

When multiple files are changed, a sticky summary bar shows total files changed, total additions, and total deletions.

### Editor integration

Each file header in the diff view has two action buttons:

- **Open in editor** — opens the file in the built-in code editor.
- **Open diff in editor** — fetches both the original and modified versions of the file (`GET /api/git/file-versions`) and opens a side-by-side Monaco diff editor via the files store.

## Committing Changes

The commit form sits above the file list in the left panel. It consists of:

1. A multi-line textarea for the commit message (pinned at the top, not scrollable).
2. A **Commit** button with a badge showing the number of staged files (disabled when the message is empty or no files are staged).
3. An **AI generate** button (the sparkle icon, covered below).

When you click Commit, the store sends `POST /api/git/commit` with the message. On success, the message is cleared, the status is refreshed, and the diff view is reset.

## AI-Generated Commit Messages

Clicking the sparkle button next to the Commit button triggers `POST /api/git/generate-commit-message`. The server-side flow is:

1. **Fetch the staged diff** using `git diff --cached`.
2. **Truncate** the diff to 8 000 characters to stay within token limits.
3. **Stream** the result back to the client using Server-Sent Events (SSE).

### The prompt

The server sends the following system prompt to Claude (via `claudeQuery` in plan mode with no tools):

> Write a concise, conventional commit message. First line: short summary (max 72 chars), imperative mood. If needed, add a blank line followed by a brief body. No markdown, no code fences, no Co-Authored-By.

### Client-side streaming

The client reads the SSE stream using a `ReadableStream` reader. As `delta` events arrive, each text fragment is appended to the `commitMessage` ref, giving the user a live typewriter effect. When the stream ends, the message is trimmed.

The button is disabled while generating and shows a spinner. It is also disabled when no files are staged (there is nothing for Claude to analyze).

**Design rationale:** Using SSE rather than a single response gives immediate feedback. Truncating the diff to 8 000 characters balances context quality against latency and cost. Running Claude in `plan` mode with no tools ensures it produces only text output and cannot execute any side effects.

## Branch Management

The Branches section is a collapsible panel that lazy-loads the branch list on first open. It displays:

- Each branch name with a git-branch icon.
- The current branch highlighted with a `current` badge and primary-color background.
- A text input and **+** button to create a new branch.

### Switching branches

Click any non-current branch to check it out. The store sends `POST /api/git/checkout`, then refreshes both status and branches.

### Creating a branch

Enter a name in the input field and press Enter or click the **+** button. The store sends `POST /api/git/create-branch`, then refreshes status and branches. The new branch is automatically checked out.

## Remote Operations

Three buttons in the remote-operations bar provide:

| Button | API endpoint | Description |
|--------|-------------|-------------|
| **Fetch** | `POST /api/git/fetch` | Downloads objects and refs from the remote without merging. |
| **Pull** | `POST /api/git/pull` | Fetches and merges the tracking branch. Refreshes status and log on success. |
| **Push** | `POST /api/git/push` | Pushes local commits to the remote. |

All three buttons are disabled while any remote operation is in progress (a shared `remoteLoading` flag). A spinner appears next to the buttons during the operation. Errors are shown as toast notifications with the server's error message.

## Commit History

The History section is a collapsible panel that lazy-loads the log on first open via `GET /api/git/log`. Each entry shows:

- **Commit message** (truncated to one line).
- **Short hash** (first 7 characters) in a monospace code badge.
- **Author name**.
- **Date** formatted as `Mon DD, H:MM AM/PM`.

Clicking a commit entry calls `GET /api/git/show?hash=...` and renders the full commit diff in the right-panel diff viewer. This lets you inspect any historical commit without leaving the UI.

## Discard Changes

Modified files show a red **undo** icon on hover. Clicking it opens a confirmation dialog:

> Discard all changes to `<filename>`? This cannot be undone.

The dialog uses the app's `useConfirmDialog` composable (a promise-based modal). On confirmation, the store sends `POST /api/git/discard` which runs `git checkout -- <file>` on the server, then refreshes the status.

**Design rationale:** Discarding is destructive and irreversible, so it requires explicit confirmation. The button is hidden until hover to reduce visual clutter and accidental clicks.

## File-Specific Diffs

Clicking any file in the status list (staged or unstaged) fetches its individual diff via `GET /api/git/file-diff?file=...&staged=...`. The selected file path is shown in the diff viewer header, and the diff viewer renders only that file's hunks.

This is distinct from the full "Working Changes" / "Staged Changes" view, which shows all changed files at once.

## Git User Configuration

The server exposes two endpoints for managing the repository's Git identity:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/git/user-config?cwd=...` | Read the current `user.name` and `user.email` |
| `PUT` | `/api/git/user-config` | Set `user.name` and `user.email` for the repository |

This allows users to configure their Git identity from within the app without needing terminal access. The configuration is applied at the repository level (not global).
