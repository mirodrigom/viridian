import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  describe('basic markdown', () => {
    it('renders bold text', () => {
      const result = renderMarkdown('**bold**')
      expect(result).toContain('<strong>bold</strong>')
    })

    it('renders italic text', () => {
      const result = renderMarkdown('*italic*')
      expect(result).toContain('<em>italic</em>')
    })

    it('renders headings', () => {
      expect(renderMarkdown('# H1')).toContain('<h1')
      expect(renderMarkdown('## H2')).toContain('<h2')
      expect(renderMarkdown('### H3')).toContain('<h3')
    })

    it('renders links', () => {
      const result = renderMarkdown('[text](https://example.com)')
      expect(result).toContain('href="https://example.com"')
      expect(result).toContain('text')
    })

    it('renders inline code', () => {
      const result = renderMarkdown('use `const x = 1`')
      expect(result).toContain('<code>')
      expect(result).toContain('const x = 1')
    })

    it('renders unordered lists', () => {
      const result = renderMarkdown('- item 1\n- item 2')
      expect(result).toContain('<ul>')
      expect(result).toContain('<li>')
      expect(result).toContain('item 1')
      expect(result).toContain('item 2')
    })

    it('renders ordered lists', () => {
      const result = renderMarkdown('1. first\n2. second')
      expect(result).toContain('<ol>')
      expect(result).toContain('first')
    })

    it('renders blockquotes', () => {
      const result = renderMarkdown('> quoted text')
      expect(result).toContain('<blockquote>')
      expect(result).toContain('quoted text')
    })

    it('renders line breaks (GFM)', () => {
      const result = renderMarkdown('line1\nline2')
      expect(result).toContain('<br')
    })
  })

  describe('code blocks', () => {
    it('renders code blocks with language label', () => {
      const result = renderMarkdown('```typescript\nconst x = 1;\n```')
      expect(result).toContain('code-block-wrapper')
      expect(result).toContain('typescript')
      expect(result).toContain('const')
    })

    it('renders code blocks with copy button', () => {
      const result = renderMarkdown('```js\nalert("hi")\n```')
      expect(result).toContain('copy-code-btn')
      expect(result).toContain('data-code=')
      expect(result).toContain('Copy')
    })

    it('renders code blocks without language as text', () => {
      const result = renderMarkdown('```\nsome code\n```')
      expect(result).toContain('code-block-wrapper')
    })

    it('highlights known languages', () => {
      const result = renderMarkdown('```python\ndef foo():\n    pass\n```')
      expect(result).toContain('hljs')
      expect(result).toContain('language-python')
    })

    it('encodes code content for data-code attribute', () => {
      const result = renderMarkdown('```js\nconst x = "<div>";\n```')
      expect(result).toContain('data-code=')
      // The code should be URI-encoded in the data attribute
      const dataCodeMatch = result.match(/data-code="([^"]*)"/)
      expect(dataCodeMatch).toBeTruthy()
      const decoded = decodeURIComponent(dataCodeMatch![1])
      expect(decoded).toContain('const x = "<div>";')
    })
  })

  describe('XSS sanitization', () => {
    it('strips script tags', () => {
      const result = renderMarkdown('<script>alert("xss")</script>')
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('alert("xss")')
    })

    it('strips onerror attributes', () => {
      const result = renderMarkdown('<img src="x" onerror="alert(1)">')
      expect(result).not.toContain('onerror')
    })

    it('strips javascript: URLs', () => {
      const result = renderMarkdown('[click](javascript:alert(1))')
      expect(result).not.toContain('javascript:')
    })

    it('preserves data-code attribute (whitelisted)', () => {
      // data-code is used by the copy button and is explicitly allowed
      const result = renderMarkdown('```js\ncode\n```')
      expect(result).toContain('data-code=')
    })
  })

  describe('LaTeX / KaTeX rendering', () => {
    it('renders inline math $E = mc^2$ with KaTeX', () => {
      const result = renderMarkdown('The equation $E=mc^2$ is famous.')
      // KaTeX wraps output in a span with class "katex"
      expect(result).toContain('katex')
      // The original LaTeX source should not appear as raw text
      expect(result).not.toContain('$E=mc^2$')
    })

    it('renders display math $$...$$ with KaTeX', () => {
      const result = renderMarkdown('$$\\int_0^1 x^2 dx$$')
      expect(result).toContain('katex-display-wrapper')
      expect(result).toContain('katex')
    })

    it('does not process math inside code blocks', () => {
      const result = renderMarkdown('```\n$E=mc^2$\n```')
      // Should be rendered as code, not as KaTeX
      expect(result).toContain('code-block-wrapper')
      expect(result).not.toContain('katex-display-wrapper')
    })

    it('does not process math inside inline code', () => {
      const result = renderMarkdown('Use `$x^2$` for math.')
      // The inline code should preserve the dollar signs literally
      expect(result).toContain('<code>')
      expect(result).toContain('$x^2$')
      // Should not contain KaTeX-rendered output for the inline code portion
      // (the raw text inside <code> is fine, but there should be no katex span wrapping it)
    })

    it('handles invalid LaTeX gracefully without crashing', () => {
      // throwOnError is false, so this should not throw
      const result = renderMarkdown('$$\\invalid{command$$')
      expect(result).toBeDefined()
      // Should still produce some output (either fallback <code> or katex error rendering)
      expect(result.length).toBeGreaterThan(0)
    })

    it('renders multiple math expressions in one string', () => {
      const result = renderMarkdown('Inline $a^2$ and $b^2$ in one line.')
      // Both expressions should be rendered via KaTeX
      const katexMatches = result.match(/class="katex"/g)
      expect(katexMatches).toBeTruthy()
      expect(katexMatches!.length).toBeGreaterThanOrEqual(2)
    })

    it('does not treat escaped dollar signs as math', () => {
      const result = renderMarkdown('The price is \\$5 and \\$10.')
      // Escaped dollar signs should not trigger KaTeX rendering
      expect(result).not.toContain('katex-display-wrapper')
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = renderMarkdown('')
      expect(result).toBeDefined()
    })

    it('handles plain text without markdown', () => {
      const result = renderMarkdown('just plain text')
      expect(result).toContain('just plain text')
    })

    it('handles special HTML characters in text', () => {
      const result = renderMarkdown('1 < 2 && 3 > 2')
      expect(result).toContain('&lt;')
      expect(result).toContain('&gt;')
    })
  })
})
