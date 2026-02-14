# Editor

The Editor tab provides a full-featured code editor built on [CodeMirror 6](https://codemirror.net/). It lets you view and edit project files directly in the browser, inspect diffs produced by Claude's tool calls, and save changes back to disk.

## Opening Files

There are two ways to open a file in the editor:

- **File tree** — Click any file in the sidebar explorer. The store calls `openFile()`, which fetches the file content from the server (`GET /api/files/content`) and pushes it into the `openFiles` array.
- **Tool results** — When Claude writes or edits a file, click the filename in the chat message to jump straight to it. The git panel also offers "Open in editor" and "Open diff in editor" buttons.

When a file is opened, the app automatically switches to the Editor tab.

::: tip
If the file is already open, clicking it again simply activates its tab without re-fetching from the server.
:::

## Editor Tabs

The `EditorTabs` component renders a horizontal tab bar above the editor area. Each open file gets a tab showing the filename and a close button.

- **Active tab** is highlighted with a solid background; inactive tabs are muted.
- **Unsaved indicator** — a small colored dot appears to the left of the filename when the file has been modified but not yet saved.
- Tabs scroll horizontally when many files are open. The Editor tab badge in the main navigation shows the count of open files.

Closing a tab removes the file from the `openFiles` array. If you close the active tab, the editor switches to the nearest remaining tab (or shows the empty state).

## Syntax Highlighting

Language detection happens on the server via `getLanguageFromPath()`, which maps file extensions to language identifiers. The editor then loads the corresponding CodeMirror language extension.

**Languages with full grammar support:**

| Extension | Language |
|-----------|----------|
| `.ts`, `.tsx` | TypeScript (with JSX) |
| `.js`, `.jsx` | JavaScript (with JSX) |
| `.py` | Python |
| `.html`, `.vue`, `.svelte`, `.astro` | HTML |
| `.css`, `.scss` | CSS |
| `.json` | JSON |
| `.md` | Markdown |

Other recognized extensions (`.rs`, `.go`, `.yaml`, `.toml`, `.sh`, `.sql`, `.graphql`) are detected by the server but fall back to plain text in the editor since their CodeMirror language packages are not currently bundled.

::: tip
Adding a new language is straightforward: install the `@codemirror/lang-*` package, add a case to the `getLanguageExtension()` switch in `EditorView.vue`, and the existing server-side extension map already covers the detection.
:::

## Editor Features

The editor ships with these CodeMirror extensions enabled by default:

- **Active line highlighting** — both the line content and its gutter are highlighted.
- **Bracket matching** — matching brackets are visually connected when the cursor is adjacent.
- **Indent with Tab** — Tab key inserts spaces (configurable size) rather than a literal tab character.
- **Default keymap** — standard editing shortcuts (undo, redo, select all, etc.).

Optional features controlled by settings:

| Feature | Setting | Default |
|---------|---------|---------|
| Line numbers | `editorShowLineNumbers` | On |
| Word wrap | `editorWordWrap` | Off |
| Minimap | `editorMinimap` | On |

## Minimap

When enabled, the editor displays a minimap on the right side powered by `@replit/codemirror-minimap`. It renders the document as colored block chunks with an overlay that tracks the visible viewport.

The minimap uses `displayText: 'blocks'` mode, which shows abstract colored bars representing code density rather than rendering actual text. An overlay is always visible to indicate the current scroll position.

::: tip
Toggle the minimap off in Settings if you prefer more horizontal editing space, especially on narrower screens.
:::

## Diff View

The diff view uses `@codemirror/merge` to show a unified side-by-side comparison of original and modified file content. It appears in the Editor tab, temporarily replacing the normal editor.

Key characteristics:

- **Read-only** — both sides are set to `EditorState.readOnly` so you cannot accidentally edit diff content.
- **Collapsed unchanged regions** — the `collapseUnchanged` option hides identical sections with a margin of 3 lines and a minimum collapsed block size of 4 lines, keeping the view focused on changes.
- **Header bar** — shows the filename, "Diff View" label, and color legend (red for original, green for modified), with a close button to return to the normal editor.
- **Full syntax highlighting** — the same language extensions and theme are applied to both sides.

Diffs are triggered from the Git panel: clicking "Open diff in editor" on any changed file calls `openDiffInEditor()`, which fetches both versions and passes them as a `DiffData` object (`{ path, original, modified, language }`) to the files store.

## Saving Files

Press **Ctrl+S** (or **Cmd+S** on macOS) to save the active file. The keydown handler is registered globally on mount and calls `saveFile()`, which sends a `PUT /api/files/content` request with the current editor content.

On success, the `modified` flag is cleared and the unsaved indicator dot disappears from the tab.

::: tip
The editor tracks modifications through a CodeMirror `updateListener`. Every document change sets `modified: true` on the file entry, so the unsaved indicator appears as soon as you type.
:::

## Editor Settings

All editor preferences are persisted to `localStorage` via the settings store and take effect immediately — changing any setting triggers a full editor re-creation with the updated extensions.

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Font size | `editorFontSize` | 13px | Applied to both content and gutters |
| Tab size | `editorTabSize` | 2 spaces | Controls indent unit width |
| Word wrap | `editorWordWrap` | Off | Enables `EditorView.lineWrapping` |
| Line numbers | `editorShowLineNumbers` | On | Toggles the line number gutter |
| Minimap | `editorMinimap` | On | Toggles the right-side minimap |
| Dark mode | `darkMode` | On | Switches between light and dark themes |

### Theming

The editor defines two full themes — `lightTheme` and `darkTheme` — that use the app's CSS custom properties (`var(--background)`, `var(--border)`, etc.) so the editor always matches the rest of the UI. Syntax highlighting uses `defaultHighlightStyle` in light mode and `oneDarkHighlightStyle` in dark mode.

The font stack is `'JetBrains Mono', 'Fira Code', monospace`, applied to `.cm-content`.

::: tip
Because the themes reference CSS variables rather than hard-coded colors, the editor inherits any custom color scheme applied to the app without needing separate CodeMirror theme packages.
:::
