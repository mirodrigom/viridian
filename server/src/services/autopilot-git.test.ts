import { describe, it, expect } from 'vitest'

/**
 * globToRegex and filterByScope are private in autopilot-git.ts.
 * We re-implement them here to test the pure logic without importing
 * the module (which has side effects via git service imports).
 */

function globToRegex(pattern: string): RegExp {
  let re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  re = re.replace(/\*\*/g, '{{GLOBSTAR}}')
  re = re.replace(/\*/g, '[^/]*')
  re = re.replace(/\{\{GLOBSTAR\}\}/g, '.*')
  return new RegExp(`^${re}$`)
}

function filterByScope(files: string[], allowedPaths: string[]): string[] {
  if (allowedPaths.length === 0) return files
  const regexes = allowedPaths.map(globToRegex)
  return files.filter((file) => regexes.some((rx) => rx.test(file)))
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('globToRegex', () => {
  it('matches exact file path', () => {
    const rx = globToRegex('src/index.ts')
    expect(rx.test('src/index.ts')).toBe(true)
    expect(rx.test('src/other.ts')).toBe(false)
  })

  it('* matches any chars within a single segment', () => {
    const rx = globToRegex('src/*.ts')
    expect(rx.test('src/index.ts')).toBe(true)
    expect(rx.test('src/utils.ts')).toBe(true)
    expect(rx.test('src/deep/file.ts')).toBe(false) // * doesn't cross /
  })

  it('** matches any number of path segments', () => {
    const rx = globToRegex('src/**')
    expect(rx.test('src/index.ts')).toBe(true)
    expect(rx.test('src/deep/nested/file.ts')).toBe(true)
    expect(rx.test('other/file.ts')).toBe(false)
  })

  it('handles **/*.ts pattern', () => {
    const rx = globToRegex('**/*.ts')
    // ** expands to .*, then * expands to [^/]* — so **/* requires at least a /
    expect(rx.test('src/index.ts')).toBe(true)
    expect(rx.test('src/deep/file.ts')).toBe(true)
    expect(rx.test('src/file.js')).toBe(false)
    // Root-level files need a / due to the /* part
    expect(rx.test('index.ts')).toBe(false)
  })

  it('escapes regex special characters', () => {
    const rx = globToRegex('src/file.test.ts')
    expect(rx.test('src/file.test.ts')).toBe(true)
    expect(rx.test('src/fileXtest.ts')).toBe(false) // . is escaped, not wildcard
  })

  it('handles patterns with brackets and parens', () => {
    const rx = globToRegex('src/(components)/[id].tsx')
    expect(rx.test('src/(components)/[id].tsx')).toBe(true)
  })

  it('handles pattern with no wildcards', () => {
    const rx = globToRegex('package.json')
    expect(rx.test('package.json')).toBe(true)
    expect(rx.test('other.json')).toBe(false)
  })

  it('handles ** in the middle of pattern', () => {
    const rx = globToRegex('src/**/test/*.ts')
    // ** requires at least one char between src/ and /test, so src/X/test works
    expect(rx.test('src/deep/test/foo.ts')).toBe(true)
    expect(rx.test('src/deep/nested/test/bar.ts')).toBe(true)
    expect(rx.test('src/test/deep/baz.ts')).toBe(false) // after test/ only * (single segment)
    expect(rx.test('other/deep/test/foo.ts')).toBe(false) // wrong prefix
  })
})

describe('filterByScope', () => {
  const testFiles = [
    'src/index.ts',
    'src/utils.ts',
    'src/components/Button.vue',
    'src/components/Modal.vue',
    'server/src/index.ts',
    'server/src/routes/auth.ts',
    'package.json',
    'README.md',
  ]

  it('returns all files when allowedPaths is empty', () => {
    expect(filterByScope(testFiles, [])).toEqual(testFiles)
  })

  it('filters by exact file match', () => {
    const result = filterByScope(testFiles, ['package.json'])
    expect(result).toEqual(['package.json'])
  })

  it('filters by single glob pattern', () => {
    const result = filterByScope(testFiles, ['src/*.ts'])
    expect(result).toEqual(['src/index.ts', 'src/utils.ts'])
  })

  it('filters by ** pattern', () => {
    const result = filterByScope(testFiles, ['src/**'])
    expect(result).toEqual([
      'src/index.ts',
      'src/utils.ts',
      'src/components/Button.vue',
      'src/components/Modal.vue',
    ])
  })

  it('filters by multiple patterns', () => {
    const result = filterByScope(testFiles, ['src/*.ts', 'package.json'])
    expect(result).toEqual(['src/index.ts', 'src/utils.ts', 'package.json'])
  })

  it('filters by file extension pattern', () => {
    const result = filterByScope(testFiles, ['**/*.vue'])
    expect(result).toEqual(['src/components/Button.vue', 'src/components/Modal.vue'])
  })

  it('returns empty array when nothing matches', () => {
    const result = filterByScope(testFiles, ['nonexistent/**'])
    expect(result).toEqual([])
  })

  it('filters server files separately from client', () => {
    const result = filterByScope(testFiles, ['server/**'])
    expect(result).toEqual(['server/src/index.ts', 'server/src/routes/auth.ts'])
  })
})
