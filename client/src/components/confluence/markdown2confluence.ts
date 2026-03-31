import { Marked, type Tokens } from 'marked';

const languageMap: Record<string, string> = {
  js: 'javascript', javascript: 'javascript',
  ts: 'typescript', typescript: 'typescript',
  py: 'python', python: 'python',
  rb: 'ruby', ruby: 'ruby',
  java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp',
  cs: 'csharp', csharp: 'csharp',
  go: 'go', rust: 'rust', rs: 'rust',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash',
  sql: 'sql', html: 'html', xml: 'xml', css: 'css',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  php: 'php', swift: 'swift', kotlin: 'kotlin',
  scala: 'scala', groovy: 'groovy', perl: 'perl',
  r: 'r', lua: 'lua', dockerfile: 'bash', makefile: 'bash',
};

// ─── Admonition helpers ───────────────────────────────────────────────

type AdmonitionType = 'NOTE' | 'WARNING' | 'IMPORTANT' | 'TIP' | 'CAUTION';

const admonitionMeta: Record<AdmonitionType, { emoji: string; icon: string; border: string; bg: string; titleColor: string; titleBg: string }> = {
  NOTE:      { emoji: 'ℹ️',  icon: 'ℹ',  border: '#0969da', bg: '#ddf4ff', titleColor: '#ffffff', titleBg: '#0969da' },
  WARNING:   { emoji: '⚠️',  icon: '⚠',  border: '#9a6700', bg: '#fff8c5', titleColor: '#ffffff', titleBg: '#9a6700' },
  IMPORTANT: { emoji: '🔔', icon: '❗', border: '#8250df', bg: '#fbefff', titleColor: '#ffffff', titleBg: '#8250df' },
  TIP:       { emoji: '💡', icon: '✅', border: '#1a7f37', bg: '#dafbe1', titleColor: '#ffffff', titleBg: '#1a7f37' },
  CAUTION:   { emoji: '🚨', icon: '⛔', border: '#cf222e', bg: '#ffebe9', titleColor: '#ffffff', titleBg: '#cf222e' },
};

/**
 * If the raw text of a blockquote starts with a GitHub-style alert marker
 * like `[!NOTE]`, extract the type and strip the marker from the content.
 * Returns null if this is not an admonition.
 */
function parseAdmonition(rawBlockquoteText: string): { type: AdmonitionType; content: string } | null {
  // rawBlockquoteText is what comes after the leading `> ` stripped by marked.
  // It may start with <p>[!NOTE]\nrest of text</p> or just [!NOTE]\nrest
  const match = rawBlockquoteText.match(/^\[!(NOTE|WARNING|IMPORTANT|TIP|CAUTION)\]\s*\n?([\s\S]*)/i);
  if (!match || !match[1]) return null;
  return {
    type: match[1].toUpperCase() as AdmonitionType,
    content: (match[2] ?? '').trim(),
  };
}

/**
 * Build an inline-styled HTML admonition panel.
 */
function buildAdmonitionHtml(type: AdmonitionType, contentHtml: string): string {
  const meta = admonitionMeta[type];
  // Use a <table> because Confluence's ProseMirror editor preserves tables with
  // inline styles on paste, but strips <div> elements entirely.
  return (
    `<table style="border-collapse:collapse;width:100%;margin:16px 0;border:1px solid ${meta.border};border-radius:8px;">` +
    `<tr><td style="background:${meta.titleBg};color:${meta.titleColor};padding:8px 16px;font-weight:700;font-size:0.85em;letter-spacing:0.5px;border:none;">${meta.icon} ${type}</td></tr>` +
    `<tr><td style="background:${meta.bg};padding:12px 16px;color:#24292f;line-height:1.6;border:none;">${contentHtml}</td></tr>` +
    `</table>`
  );
}

/**
 * Converts Markdown to Confluence Storage Format (XHTML).
 * This format is understood by Confluence's storage editor and API.
 */
export function markdown2confluence(md: string): string {
  const instance = new Marked();

  instance.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        return `<h${depth}>${text}</h${depth}>`;
      },

      paragraph({ tokens }: Tokens.Paragraph) {
        return `<p>${this.parser.parseInline(tokens)}</p>`;
      },

      strong({ tokens }: Tokens.Strong) {
        return `<strong>${this.parser.parseInline(tokens)}</strong>`;
      },

      em({ tokens }: Tokens.Em) {
        return `<em>${this.parser.parseInline(tokens)}</em>`;
      },

      del({ tokens }: Tokens.Del) {
        return `<del>${this.parser.parseInline(tokens)}</del>`;
      },

      codespan({ text }: Tokens.Codespan) {
        return `<code>${text}</code>`;
      },

      code({ text, lang }: Tokens.Code) {
        const language = languageMap[(lang ?? '').toLowerCase()] ?? 'none';
        return `<ac:structured-macro ac:name="code" ac:schema-version="1">` +
          `<ac:parameter ac:name="language">${language}</ac:parameter>` +
          `<ac:parameter ac:name="theme">RDark</ac:parameter>` +
          `<ac:parameter ac:name="linenumbers">true</ac:parameter>` +
          `<ac:plain-text-body><![CDATA[${text}]]></ac:plain-text-body>` +
          `</ac:structured-macro>`;
      },

      blockquote({ tokens }: Tokens.Blockquote) {
        const inner = this.parser.parse(tokens);
        return `<blockquote>${inner}</blockquote>`;
      },

      list({ items, ordered }: Tokens.List) {
        const tag = ordered ? 'ol' : 'ul';
        let body = '';
        for (const item of items) {
          const itemText = this.parser.parse(item.tokens);
          body += `<li>${itemText}</li>`;
        }
        return `<${tag}>${body}</${tag}>`;
      },

      link({ href, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        return `<a href="${href}">${text}</a>`;
      },

      image({ href, title, text }: Tokens.Image) {
        const alt = text || title || '';
        return `<ac:image><ri:url ri:value="${href}" /><ac:parameter ac:name="alt">${alt}</ac:parameter></ac:image>`;
      },

      table({ header, rows }: Tokens.Table) {
        let result = '<table><thead><tr>';
        for (const cell of header) {
          result += `<th>${this.parser.parseInline(cell.tokens)}</th>`;
        }
        result += '</tr></thead><tbody>';
        for (const row of rows) {
          result += '<tr>';
          for (const cell of row) {
            result += `<td>${this.parser.parseInline(cell.tokens)}</td>`;
          }
          result += '</tr>';
        }
        result += '</tbody></table>';
        return result;
      },

      hr() {
        return '<hr />';
      },

      br() {
        return '<br />';
      },

      html(token: Tokens.HTML | Tokens.Tag) {
        return token.text;
      },
    },
  });

  return instance.parse(md, { async: false }) as string;
}

/**
 * Converts Markdown to clean HTML (for rich-text clipboard copy).
 * Confluence's visual editor accepts pasted HTML and renders it correctly.
 * This version avoids Confluence-specific macros (ac:*) that only work in storage format.
 * All styles are inline so Confluence preserves them on paste.
 */
export function markdown2html(md: string): string {
  const instance = new Marked();

  instance.use({
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        const styles: Record<number, string> = {
          1: 'font-size:2em;font-weight:700;margin:24px 0 12px 0;padding-bottom:6px;border-bottom:2px solid #0969da;color:#0550ae;',
          2: 'font-size:1.5em;font-weight:700;margin:20px 0 10px 0;padding-bottom:4px;border-bottom:1px solid #d0d7de;color:#24292f;',
          3: 'font-size:1.25em;font-weight:600;margin:16px 0 8px 0;color:#24292f;',
          4: 'font-size:1.1em;font-weight:600;margin:14px 0 6px 0;color:#32383f;',
          5: 'font-size:1em;font-weight:600;margin:12px 0 4px 0;color:#57606a;',
          6: 'font-size:0.9em;font-weight:600;margin:10px 0 4px 0;color:#57606a;text-transform:uppercase;letter-spacing:0.5px;',
        };
        return `<h${depth} style="${styles[depth] ?? 'font-weight:bold;'}">${text}</h${depth}>`;
      },

      paragraph({ tokens }: Tokens.Paragraph) {
        return `<p style="margin:8px 0;line-height:1.6;color:#24292f;">${this.parser.parseInline(tokens)}</p>`;
      },

      strong({ tokens }: Tokens.Strong) {
        return `<strong style="font-weight:600;color:#1f2328;">${this.parser.parseInline(tokens)}</strong>`;
      },

      code({ text, lang }: Tokens.Code) {
        const langLabel = lang ? languageMap[(lang).toLowerCase()] ?? lang : '';
        // Use <table> wrapper because Confluence strips <div> on paste
        const labelRow = langLabel
          ? `<tr><td style="background:#2d2d2d;color:#8b949e;padding:4px 16px;font-size:0.75em;font-family:monospace;border:none;border-bottom:1px solid #444;">${escapeHtml(langLabel.toUpperCase())}</td></tr>`
          : '';
        return (
          `<table style="border-collapse:collapse;width:100%;margin:12px 0;border:none;">` +
          labelRow +
          `<tr><td style="background:#1e1e1e;padding:0;border:none;">` +
          `<pre style="background:#1e1e1e;color:#d4d4d4;padding:16px;overflow-x:auto;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:0.85em;line-height:1.5;margin:0;">` +
          `<code style="background:none;color:inherit;padding:0;font-family:inherit;">${escapeHtml(text)}</code>` +
          `</pre></td></tr></table>`
        );
      },

      codespan({ text }: Tokens.Codespan) {
        return `<code style="background:#eff1f3;border:1px solid #d0d7de;border-radius:4px;padding:2px 6px;font-family:'SFMono-Regular',Consolas,monospace;font-size:0.85em;color:#0550ae;">${text}</code>`;
      },

      blockquote({ tokens }: Tokens.Blockquote) {
        // Check the raw text for a GitHub-style alert marker.
        const firstToken = tokens[0];
        const rawText =
          firstToken && 'text' in firstToken
            ? (firstToken as { text: string }).text
            : firstToken && 'raw' in firstToken
              ? (firstToken as { raw: string }).raw
              : '';

        const admonition = parseAdmonition(rawText);
        if (admonition) {
          const contentHtml = admonition.content
            ? (instance.parse(admonition.content, { async: false }) as string)
            : '';
          return buildAdmonitionHtml(admonition.type, contentHtml);
        }

        const inner = this.parser.parse(tokens);
        return (
          `<blockquote style="border-left:4px solid #d0d7de;background:#f6f8fa;margin:12px 0;padding:10px 16px;color:#57606a;border-radius:0 4px 4px 0;">` +
          `${inner}` +
          `</blockquote>`
        );
      },

      list({ items, ordered }: Tokens.List) {
        const tag = ordered ? 'ol' : 'ul';
        const listStyle = ordered
          ? 'padding-left:24px;margin:8px 0;line-height:1.6;'
          : 'padding-left:24px;margin:8px 0;line-height:1.6;list-style-type:disc;';
        let body = '';
        for (const item of items) {
          const itemText = this.parser.parse(item.tokens);
          body += `<li style="margin:4px 0;color:#24292f;">${itemText}</li>`;
        }
        return `<${tag} style="${listStyle}">${body}</${tag}>`;
      },

      table({ header, rows }: Tokens.Table) {
        let result =
          `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:0.95em;">` +
          `<thead><tr>`;
        for (const cell of header) {
          result += `<th style="border:1px solid #d0d7de;padding:10px 14px;background:#0969da;color:#ffffff;font-weight:600;text-align:left;">${this.parser.parseInline(cell.tokens)}</th>`;
        }
        result += `</tr></thead><tbody>`;
        for (let i = 0; i < rows.length; i++) {
          const rowBg = i % 2 === 0 ? '#ffffff' : '#f6f8fa';
          result += `<tr style="background:${rowBg};">`;
          for (const cell of rows[i]!) {
            result += `<td style="border:1px solid #d0d7de;padding:8px 14px;color:#24292f;">${this.parser.parseInline(cell.tokens)}</td>`;
          }
          result += `</tr>`;
        }
        result += `</tbody></table>`;
        return result;
      },

      hr() {
        return `<hr style="border:none;border-top:2px solid #d0d7de;margin:24px 0;" />`;
      },

      link({ href, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        return `<a href="${href}" style="color:#0969da;text-decoration:underline;">${text}</a>`;
      },

      image({ href, title, text }: Tokens.Image) {
        const alt = text || title || '';
        return `<img src="${href}" alt="${alt}" style="max-width:100%;height:auto;border-radius:6px;margin:8px 0;" />`;
      },
    },
  });

  return instance.parse(md, { async: false }) as string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
