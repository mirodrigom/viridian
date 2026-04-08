# Confluence Converter

Convert raw text or Markdown into richly formatted content ready to paste into Confluence Cloud's visual editor.

## Input

The user will provide raw text, meeting notes, documentation, or Markdown. If no text is provided directly, ask them to paste it.

## Step 1 — Format with AI

Take the user's raw text and reformat it into rich, structured Markdown. Apply these rules aggressively:

### Structure
- Use `#` to `######` headings to break content into clear sections. Never leave walls of text.
- Use horizontal rules (`---`) between major sections.
- Split paragraphs with 3+ topics into sub-sections.

### Emphasis
- **Bold** for: service names, tool names, product names, key concepts, metrics, important values, action verbs in instructions ("Click **Save**"), and anything to spot while scanning.
- *Italic* for: technical terms on first mention, file names, paths, titles.
- `Inline code` for ALL: commands, CLI flags, function names, variables, ports, URLs, config keys, env vars, file paths, versions, error codes, HTTP methods, status codes, and any literal value.

### Code blocks
- Use fenced code blocks with language identifiers (`bash`, `python`, `json`, `yaml`, `sql`, `typescript`, `java`, `go`, `xml`, `dockerfile`, `hcl`, etc.).

### Lists & Tables
- Bulleted lists for unordered collections, numbered lists for sequential steps.
- Use Markdown tables when data has 2+ attributes (comparisons, config options, API params, service mappings, etc.).

### Admonitions (CRITICAL — use at least 2-3 per document)
Use GitHub-style alerts proactively. Extract them from context even when not explicitly labeled:

```
> [!NOTE]
> Supplementary info, background context, "good to know"

> [!TIP]
> Best practices, shortcuts, recommendations

> [!IMPORTANT]
> Prerequisites, mandatory steps, constraints, deadlines

> [!WARNING]
> Common mistakes, gotchas, breaking changes, side effects

> [!CAUTION]
> Destructive/irreversible operations, data loss, security risks
```

### Rules
- Preserve ALL original content — do NOT summarize or remove information.
- Do NOT add introductions, conclusions, or meta-commentary.
- Return ONLY the formatted Markdown.

## Step 2 — Convert to Confluence Storage Format

Apply these Markdown-to-Confluence-Storage-Format (XHTML) conversions:

| Markdown | Confluence Storage Format |
|----------|--------------------------|
| `# heading` | `<h1>heading</h1>` (plain XHTML) |
| `**bold**` | `<strong>bold</strong>` |
| `*italic*` | `<em>italic</em>` |
| `` `code` `` | `<code>code</code>` |
| ` ```lang ... ``` ` | See code macro below |
| `![alt](url)` | `<ac:image><ri:url ri:value="URL" /><ac:parameter ac:name="alt">ALT</ac:parameter></ac:image>` |
| `[text](url)` | `<a href="URL">text</a>` |
| Tables | Standard `<table><thead><tr><th>...</th></tr></thead><tbody>...</tbody></table>` |
| Lists | `<ul><li>...</li></ul>` or `<ol><li>...</li></ol>` |
| `---` | `<hr />` |
| `> quote` | `<blockquote>...</blockquote>` |
| `~~text~~` | `<del>text</del>` |

### Code block macro format

```xml
<ac:structured-macro ac:name="code" ac:schema-version="1">
  <ac:parameter ac:name="language">LANG</ac:parameter>
  <ac:parameter ac:name="theme">RDark</ac:parameter>
  <ac:parameter ac:name="linenumbers">true</ac:parameter>
  <ac:plain-text-body><![CDATA[CODE_HERE]]></ac:plain-text-body>
</ac:structured-macro>
```

### Language mapping for code blocks

```
js/javascript → javascript, ts/typescript → typescript, py/python → python,
rb/ruby → ruby, java → java, c → c, cpp/c++ → cpp, cs/csharp → csharp,
go → go, rust/rs → rust, sh/bash/shell/zsh → bash, sql → sql,
html → html, xml → xml, css → css, json → json, yaml/yml → yaml,
php → php, swift → swift, kotlin → kotlin, scala → scala,
groovy → groovy, perl → perl, r → r, lua → lua,
dockerfile → bash, makefile → bash
```

If the language is not in the map, use `none`.

## Step 3 — Output

Write two files in the current working directory:

1. **`confluence-output.xml`** — The Confluence Storage Format XHTML from Step 2.
2. **`confluence-output.html`** — A rich HTML version (below) for clipboard pasting.

### Rich HTML conversion rules (for `confluence-output.html`)

This HTML uses inline styles so Confluence's ProseMirror editor preserves formatting on paste.

**CRITICAL**: Use `<table>` wrappers instead of `<div>` for code blocks and admonitions — Confluence strips `<div>` elements on paste.

#### Element styles

- **Headings**: h1: `font-size:2em;font-weight:700;margin:24px 0 12px;padding-bottom:6px;border-bottom:2px solid #0969da;color:#0550ae`, h2: `font-size:1.5em;font-weight:700;margin:20px 0 10px;padding-bottom:4px;border-bottom:1px solid #d0d7de;color:#24292f`, h3: `font-size:1.25em;font-weight:600;margin:16px 0 8px;color:#24292f`
- **Paragraphs**: `margin:8px 0;line-height:1.6;color:#24292f`
- **Bold**: `font-weight:600;color:#1f2328`
- **Inline code**: `background:#eff1f3;border:1px solid #d0d7de;border-radius:4px;padding:2px 6px;font-family:'SFMono-Regular',Consolas,monospace;font-size:0.85em;color:#0550ae`
- **Code blocks**: Wrap in `<table>` with optional lang label row (`background:#2d2d2d;color:#8b949e;font-size:0.75em;font-family:monospace`), code row has `<pre>` with `background:#1e1e1e;color:#d4d4d4;padding:16px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:0.85em;line-height:1.5`
- **Data tables**: `border-collapse:collapse;width:100%`, header: `background:#0969da;color:#ffffff;font-weight:600;padding:10px 14px;border:1px solid #d0d7de`, rows alternate `#ffffff` / `#f6f8fa`, cells: `padding:8px 14px;border:1px solid #d0d7de;color:#24292f`
- **Blockquotes**: `border-left:4px solid #d0d7de;background:#f6f8fa;margin:12px 0;padding:10px 16px;color:#57606a;border-radius:0 4px 4px 0`
- **Lists**: `padding-left:24px;margin:8px 0;line-height:1.6`, items: `margin:4px 0;color:#24292f`
- **Links**: `color:#0969da;text-decoration:underline`
- **Horizontal rules**: `border:none;border-top:2px solid #d0d7de;margin:24px 0`

#### Admonition styles (rendered as `<table>`, two rows)

| Type | Border | Background | Title BG | Icon |
|------|--------|------------|----------|------|
| NOTE | `#0969da` | `#ddf4ff` | `#0969da` | ℹ |
| WARNING | `#9a6700` | `#fff8c5` | `#9a6700` | ⚠ |
| IMPORTANT | `#8250df` | `#fbefff` | `#8250df` | ❗ |
| TIP | `#1a7f37` | `#dafbe1` | `#1a7f37` | ✅ |
| CAUTION | `#cf222e` | `#ffebe9` | `#cf222e` | ⛔ |

Structure:
```html
<table style="border-collapse:collapse;width:100%;margin:16px 0;border:1px solid BORDER;border-radius:8px;">
  <tr><td style="background:TITLE_BG;color:#ffffff;padding:8px 16px;font-weight:700;font-size:0.85em;letter-spacing:0.5px;border:none;">ICON TYPE</td></tr>
  <tr><td style="background:BG;padding:12px 16px;color:#24292f;line-height:1.6;border:none;">CONTENT</td></tr>
</table>
```

## Step 4 — Instructions to user

After writing both files, tell the user:

1. Open `confluence-output.html` in a browser
2. Select all (Ctrl+A) and copy (Ctrl+C)
3. In Confluence, click in the page editor and paste (Ctrl+V)
4. Review and publish

The XML in `confluence-output.xml` can also be pasted into Confluence's **Storage Format editor** (source editor or REST API).
