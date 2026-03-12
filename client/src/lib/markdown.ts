import { marked, type Tokens, type TokenizerExtension, type RendererExtension } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';

import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('zsh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('vue', xml);
hljs.registerLanguage('svg', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }: Tokens.Code) {
  const language = lang && hljs.getLanguage(lang) ? lang : null;
  let highlighted: string;
  try {
    highlighted = language
      ? hljs.highlight(text, { language }).value
      : hljs.highlightAuto(text).value;
  } catch {
    highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const langLabel = language || 'text';
  const escaped = encodeURIComponent(text);

  return `<div class="code-block-wrapper group/code relative my-3">
    <div class="flex items-center justify-between rounded-t-md border border-b-0 border-border bg-muted/60 px-3 py-1.5">
      <span class="text-[11px] font-medium text-muted-foreground">${langLabel}</span>
      <button class="copy-code-btn flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100" data-code="${escaped}">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke-width="2"/></svg>
        <span>Copy</span>
      </button>
    </div>
    <pre class="!mt-0 !rounded-t-none !border-t-0"><code class="hljs language-${langLabel}">${highlighted}</code></pre>
  </div>`;
};

// ─── KaTeX math extensions for marked ──────────────────────────────
// Display math: $$...$$ (block-level)
const blockMath: TokenizerExtension & RendererExtension = {
  name: 'blockMath',
  level: 'block',
  start(src: string) {
    return src.indexOf('$$');
  },
  tokenizer(src: string) {
    const match = src.match(/^\$\$([\s\S]+?)\$\$/);
    if (match?.[1]) {
      return {
        type: 'blockMath',
        raw: match[0],
        text: match[1].trim(),
      };
    }
  },
  renderer(token) {
    try {
      return `<div class="katex-display-wrapper">${katex.renderToString(token.text, { displayMode: true, throwOnError: false, output: 'html' })}</div>`;
    } catch {
      return `<div class="katex-display-wrapper"><code>${token.text}</code></div>`;
    }
  },
};

// Inline math: $...$ (inline-level, avoids false positives on lone $ or $$ )
const inlineMath: TokenizerExtension & RendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src: string) {
    // Find a $ that is NOT preceded by \ and NOT followed by another $
    const idx = src.search(/(?<![\\$])\$(?!\$)/);
    return idx >= 0 ? idx : -1;
  },
  tokenizer(src: string) {
    // Match $...$ where content is non-empty and doesn't start/end with space
    // (avoids triggering on currency like "$5 and $10")
    const match = src.match(/^\$([^\s$](?:[^$]*?[^\s$])?)\$/);
    if (match) {
      return {
        type: 'inlineMath',
        raw: match[0],
        text: match[1],
      };
    }
  },
  renderer(token) {
    try {
      return katex.renderToString(token.text, { displayMode: false, throwOnError: false, output: 'html' });
    } catch {
      return `<code>${token.text}</code>`;
    }
  },
};

marked.use({ extensions: [blockMath, inlineMath] });

marked.setOptions({ breaks: true, gfm: true, renderer });

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'data-code') {
    data.forceKeepAttr = true;
  }
});

export function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-code', 'aria-hidden', 'style'],
    ADD_TAGS: ['svg', 'path', 'rect', 'math', 'semantics', 'mrow', 'mi', 'mo',
      'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'msqrt', 'mroot',
      'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'annotation', 'msubsup',
      'munderover', 'mpadded', 'mstyle', 'menclose', 'mglyph', 'mmultiscripts',
      'mprescripts', 'none'],
  });
}

export function setupCodeCopyHandler(): () => void {
  function handleClick(e: Event) {
    const btn = (e.target as HTMLElement).closest('.copy-code-btn') as HTMLElement | null;
    if (!btn) return;
    const code = decodeURIComponent(btn.dataset.code || '');
    const label = btn.querySelector('span');
    navigator.clipboard.writeText(code).then(() => {
      btn.classList.add('copied');
      if (label) label.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        if (label) label.textContent = 'Copy';
      }, 2000);
    });
  }

  document.addEventListener('click', handleClick);
  return () => document.removeEventListener('click', handleClick);
}
