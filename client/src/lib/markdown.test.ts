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
