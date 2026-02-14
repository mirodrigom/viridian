# Tasks

The Tasks feature provides a Kanban-style task board for planning and tracking work within a project. Tasks are scoped to the current project directory and persisted in the server's SQLite database.

## Overview

The task board displays cards organized into columns by status. You can create tasks manually, have Claude generate them from a PRD document, or expand a high-level task into subtasks using AI. Tasks support parent/child hierarchies, inter-task dependencies, priority levels, and drag-and-drop reordering.

A progress bar in the header shows overall completion based on leaf tasks (tasks without children).

## Columns

The board has three columns:

| Column | Status | Description |
|---|---|---|
| **To Do** | `todo` | Tasks not yet started |
| **In Progress** | `in_progress` | Tasks currently being worked on |
| **Done** | `done` | Completed tasks |

You can filter the board by status or priority using the dropdown selectors in the header.

## Creating Tasks

Click **Add Task** to open the creation dialog. Each task requires a title and optionally accepts a description and priority level.

Fields:

- **Title** -- short imperative phrase (e.g. "Add user authentication")
- **Description** -- optional 1-2 sentence summary
- **Priority** -- `high`, `medium` (default), or `low`

New tasks are placed at the bottom of the **To Do** column.

## PRD Parsing

Click **From PRD** to paste a Product Requirements Document (markdown or plain text). Claude reads the document and produces a hierarchical task breakdown in a single streaming pass:

1. The full PRD text is sent to the server endpoint `POST /api/tasks/parse-prd`.
2. Claude runs in `plan` permission mode (read-only, no file writes) and outputs one JSON object per line, each representing a parent task (epic/feature) with nested subtasks.
3. The server parses Claude's output and saves tasks to the database using a three-pass transaction:
   - **Pass 1** -- Insert parent tasks.
   - **Pass 2** -- Insert subtasks linked to their parents via `parentId`.
   - **Pass 3** -- Resolve `dependencyTitles` strings into task IDs and set `dependencyIds`.
4. The resulting tasks stream back to the client via Server-Sent Events (SSE). A live output panel shows Claude's raw text while parsing is in progress.

::: tip
Write your PRD with clear section headings and feature descriptions. Claude maps each distinct feature into a parent task and breaks implementation steps into 2-5 subtasks per parent.
:::

## Task Expansion

Any root task (a task without a parent) can be expanded into subtasks by clicking the sparkle icon on its card. This calls `POST /api/tasks/:id/expand`, which:

1. Sends the task's title, description, and details to Claude.
2. Claude generates 3-7 subtask JSON objects.
3. Existing subtasks for that parent are replaced with the new set.
4. The parent card switches to an "epic" view showing inline subtask progress (e.g. "2/5").

::: tip
You can run expansion multiple times on the same task. Each run replaces the previous subtasks. Edit the task's description or details field before expanding to steer Claude toward different breakdowns.
:::

## Drag and Drop

Drag a task card by its grip handle and drop it into any column to change its status. Visual feedback highlights the target column during the drag. After the drop, the task's `status` is updated and its `sortOrder` is recalculated based on its position within the column.

Tasks with subtasks (parent/epic tasks) can also be dragged. However, clicking the status icon on a parent task does nothing -- the parent's status is automatically derived from its children:

- All subtasks **done** -- parent becomes `done`.
- All subtasks **todo** -- parent becomes `todo`.
- Mixed -- parent becomes `in_progress`.

## Task Properties

Each task has the following fields:

| Property | Type | Description |
|---|---|---|
| `id` | `string` | UUID, auto-generated |
| `title` | `string` | Short imperative title |
| `description` | `string` | Summary of the task |
| `details` | `string` | Implementation notes (shown in detail dialog) |
| `status` | `todo` \| `in_progress` \| `done` | Current column |
| `priority` | `high` \| `medium` \| `low` | Visual badge and filter |
| `parentId` | `string \| null` | Links a subtask to its parent |
| `dependencyIds` | `string[]` | IDs of tasks that must be completed first |
| `prdSource` | `string \| null` | First 500 chars of the PRD that generated this task |
| `sortOrder` | `number` | Position within its column |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp |

Click any task card to open the **Detail Dialog**, where you can edit the title, description, details, and priority. Changes auto-save when you close the dialog.

### Dependencies

Tasks can declare dependencies on other tasks. A dependency badge appears on the card with a link icon. If any dependency is not yet `done`, the task displays a **blocked** badge in orange. Dependencies are set during PRD parsing (resolved from `dependencyTitles`) or can be edited via the API.

### Subtasks

Subtasks are displayed inline within their parent card as a collapsible list. Each subtask shows a status icon that you can click to cycle through `todo` -> `in_progress` -> `done`. The parent card displays a progress counter (e.g. "3/5") next to its title.

## Project Scoping

Tasks are scoped to a **project directory path**. When you switch projects in the dashboard, the task board loads only the tasks associated with that directory. The `projectPath` field on each task matches the working directory selected in the chat interface.

This means different projects maintain independent task boards, and PRD-generated tasks are always tied to the project that was active when the PRD was parsed.

## REST API

All endpoints require authentication via `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tasks?project=<path>` | List tasks for a project. Optional filters: `status`, `priority`, `parentId`. |
| `GET` | `/api/tasks/:id` | Get a single task with its subtasks. |
| `POST` | `/api/tasks` | Create a task. Body: `{ title, project, description?, priority?, parentId?, dependencyIds? }` |
| `PUT` | `/api/tasks/:id` | Update a task. Body: partial fields to update. Returns `{ task, parentUpdate }`. |
| `DELETE` | `/api/tasks/:id` | Delete a task and its subtasks. |
| `POST` | `/api/tasks/reorder` | Reorder tasks. Body: `{ taskIds: string[] }` |
| `POST` | `/api/tasks/parse-prd` | Parse a PRD into tasks (SSE stream). Body: `{ prd, project }` |
| `POST` | `/api/tasks/:id/expand` | Expand a task into subtasks (SSE stream). |
