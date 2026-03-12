import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestPinia } from '@/test/utils'
import { usePreviewStore } from './preview'

// Mock apiFetch
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
}))

// Mock vue-sonner
vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// Mock files store
vi.mock('@/stores/files', () => ({
  useFilesStore: () => ({
    rootPath: '/test/project',
  }),
}))

import { apiFetch } from '@/lib/apiFetch'

const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>

function mockFetchResponse(content: string) {
  mockApiFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ content }),
  })
}

describe('usePreviewStore', () => {
  beforeEach(() => {
    setupTestPinia()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('should have no tabs and no active tab', () => {
      const store = usePreviewStore()

      expect(store.tabs).toHaveLength(0)
      expect(store.activeTabId).toBeNull()
      expect(store.activeTab).toBeNull()
      expect(store.tabCount).toBe(0)
    })
  })

  describe('openPreview()', () => {
    it('should open a markdown file tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('# Hello')

      await store.openPreview('docs/readme.md')

      expect(store.tabs).toHaveLength(1)
      expect(store.tabs[0].name).toBe('readme.md')
      expect(store.tabs[0].fileType).toBe('markdown')
      expect(store.tabs[0].path).toBe('docs/readme.md')
      expect(store.activeTabId).toBe(store.tabs[0].id)
    })

    it('should open an html file tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('<h1>Hello</h1>')

      await store.openPreview('index.html')

      expect(store.tabs[0].fileType).toBe('html')
    })

    it('should open an image file without fetching content', async () => {
      const store = usePreviewStore()

      await store.openPreview('assets/logo.png')

      expect(store.tabs[0].fileType).toBe('image')
      expect(store.tabs[0].loading).toBe(false)
      expect(mockApiFetch).not.toHaveBeenCalled()
    })

    it('should open a pdf file without fetching content', async () => {
      const store = usePreviewStore()

      await store.openPreview('docs/manual.pdf')

      expect(store.tabs[0].fileType).toBe('pdf')
      expect(store.tabs[0].loading).toBe(false)
      expect(mockApiFetch).not.toHaveBeenCalled()
    })

    it('should open a code file tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('print("hello")')

      await store.openPreview('main.py')

      expect(store.tabs[0].fileType).toBe('code')
      expect(store.tabs[0].language).toBe('python')
    })

    it('should open a mermaid file tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('graph TD; A-->B;')

      await store.openPreview('diagram.mmd')

      expect(store.tabs[0].fileType).toBe('mermaid')
    })

    it('should not create a duplicate tab for the same file', async () => {
      const store = usePreviewStore()
      mockFetchResponse('# Hello')

      await store.openPreview('readme.md')
      const firstTabId = store.activeTabId

      await store.openPreview('readme.md')

      expect(store.tabs).toHaveLength(1)
      expect(store.activeTabId).toBe(firstTabId)
    })

    it('should switch to existing tab when opening the same file', async () => {
      const store = usePreviewStore()
      mockFetchResponse('# File 1')
      mockFetchResponse('# File 2')

      await store.openPreview('file1.md')
      await store.openPreview('file2.md')
      const file2TabId = store.activeTabId

      await store.openPreview('file1.md')

      expect(store.tabs).toHaveLength(2)
      expect(store.activeTabId).toBe(store.tabs[0].id)
      expect(store.activeTabId).not.toBe(file2TabId)
    })
  })

  describe('file type detection', () => {
    const cases: [string, string][] = [
      ['readme.md', 'markdown'],
      ['readme.mdx', 'markdown'],
      ['page.html', 'html'],
      ['page.htm', 'html'],
      ['logo.svg', 'image'],
      ['photo.jpg', 'image'],
      ['photo.jpeg', 'image'],
      ['icon.png', 'image'],
      ['anim.gif', 'image'],
      ['pic.webp', 'image'],
      ['script.py', 'code'],
      ['app.ts', 'code'],
      ['style.css', 'code'],
      ['config.json', 'code'],
      ['config.yaml', 'code'],
      ['diagram.mmd', 'mermaid'],
      ['diagram.mermaid', 'mermaid'],
      ['doc.pdf', 'pdf'],
    ]

    it.each(cases)('should detect %s as %s', async (filename, expectedType) => {
      const store = usePreviewStore()

      // For non-image/non-pdf files, mock a fetch response
      if (expectedType !== 'image' && expectedType !== 'pdf') {
        mockFetchResponse('content')
      }

      await store.openPreview(filename)

      expect(store.tabs[0].fileType).toBe(expectedType)
    })
  })

  describe('closeTab()', () => {
    it('should remove the tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('content')

      await store.openPreview('file.md')
      const tabId = store.tabs[0].id

      store.closeTab(tabId)

      expect(store.tabs).toHaveLength(0)
      expect(store.activeTabId).toBeNull()
    })

    it('should switch to the nearest tab when closing the active tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('file 1')
      mockFetchResponse('file 2')
      mockFetchResponse('file 3')

      await store.openPreview('file1.md')
      await store.openPreview('file2.md')
      await store.openPreview('file3.md')

      const tab2Id = store.tabs[1].id
      const tab3Id = store.tabs[2].id

      // Active is file3 (last opened). Close it.
      store.closeTab(tab3Id)

      expect(store.tabs).toHaveLength(2)
      expect(store.activeTabId).toBe(tab2Id)
    })

    it('should switch to first tab when closing the first active tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('file 1')
      mockFetchResponse('file 2')

      await store.openPreview('file1.md')
      const tab1Id = store.tabs[0].id
      await store.openPreview('file2.md')

      // Switch active to first tab, then close it
      store.setActiveTab(tab1Id)
      store.closeTab(tab1Id)

      expect(store.tabs).toHaveLength(1)
      expect(store.activeTabId).toBe(store.tabs[0].id)
    })

    it('should not affect active tab when closing a non-active tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('file 1')
      mockFetchResponse('file 2')

      await store.openPreview('file1.md')
      const tab1Id = store.tabs[0].id
      await store.openPreview('file2.md')
      const tab2Id = store.tabs[1].id

      // Active is file2. Close file1.
      store.closeTab(tab1Id)

      expect(store.tabs).toHaveLength(1)
      expect(store.activeTabId).toBe(tab2Id)
    })

    it('should do nothing for non-existent tab id', () => {
      const store = usePreviewStore()
      store.closeTab('non-existent')
      expect(store.tabs).toHaveLength(0)
    })
  })

  describe('setActiveTab()', () => {
    it('should switch the active tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('file 1')
      mockFetchResponse('file 2')

      await store.openPreview('file1.md')
      const tab1Id = store.tabs[0].id
      await store.openPreview('file2.md')

      expect(store.activeTabId).not.toBe(tab1Id)

      store.setActiveTab(tab1Id)

      expect(store.activeTabId).toBe(tab1Id)
      expect(store.activeTab?.path).toBe('file1.md')
    })
  })

  describe('closeAllTabs()', () => {
    it('should clear all tabs and active tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('file 1')
      mockFetchResponse('file 2')

      await store.openPreview('file1.md')
      await store.openPreview('file2.md')

      expect(store.tabs).toHaveLength(2)

      store.closeAllTabs()

      expect(store.tabs).toHaveLength(0)
      expect(store.activeTabId).toBeNull()
      expect(store.activeTab).toBeNull()
      expect(store.tabCount).toBe(0)
    })
  })

  describe('refreshTab()', () => {
    it('should reload content for a text-based tab', async () => {
      const store = usePreviewStore()
      mockFetchResponse('original content')

      await store.openPreview('file.md')
      const tabId = store.tabs[0].id

      expect(store.tabs[0].content).toBe('original content')

      mockFetchResponse('updated content')
      await store.refreshTab(tabId)

      expect(store.tabs[0].content).toBe('updated content')
    })

    it('should update lastModified for image tabs without fetching', async () => {
      const store = usePreviewStore()

      await store.openPreview('photo.png')
      const tabId = store.tabs[0].id
      const originalModified = store.tabs[0].lastModified

      // Advance time so lastModified will differ
      vi.advanceTimersByTime(1000)

      await store.refreshTab(tabId)

      expect(store.tabs[0].lastModified).toBeGreaterThan(originalModified)
      // No fetch should have been made (one for open, zero more for refresh)
      expect(mockApiFetch).not.toHaveBeenCalled()
    })

    it('should do nothing for non-existent tab', async () => {
      const store = usePreviewStore()
      await store.refreshTab('non-existent')
      // Should not throw
      expect(mockApiFetch).not.toHaveBeenCalled()
    })
  })
})
