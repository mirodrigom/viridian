import { describe, it, expect, beforeEach } from 'vitest'
import { useConfirmDialog } from './useConfirmDialog'

describe('useConfirmDialog', () => {
  let dialog: ReturnType<typeof useConfirmDialog>

  beforeEach(() => {
    dialog = useConfirmDialog()
    // Reset state between tests
    dialog.isOpen.value = false
  })

  describe('confirm()', () => {
    it('opens the dialog with correct title and description', () => {
      dialog.confirm({ title: 'Delete?', description: 'This cannot be undone.' })

      expect(dialog.isOpen.value).toBe(true)
      expect(dialog.title.value).toBe('Delete?')
      expect(dialog.description.value).toBe('This cannot be undone.')
    })

    it('returns a promise', () => {
      const result = dialog.confirm({ title: 'Test', description: 'Test desc' })
      expect(result).toBeInstanceOf(Promise)
      // Clean up: resolve the promise so it doesn't hang
      dialog.handleCancel()
    })
  })

  describe('handleConfirm()', () => {
    it('resolves promise with true', async () => {
      const promise = dialog.confirm({ title: 'Confirm?', description: 'Sure?' })
      dialog.handleConfirm()

      const result = await promise
      expect(result).toBe(true)
    })

    it('closes the dialog', async () => {
      const promise = dialog.confirm({ title: 'T', description: 'D' })
      expect(dialog.isOpen.value).toBe(true)

      dialog.handleConfirm()
      expect(dialog.isOpen.value).toBe(false)
      await promise
    })
  })

  describe('handleCancel()', () => {
    it('resolves promise with false', async () => {
      const promise = dialog.confirm({ title: 'Cancel?', description: 'Really?' })
      dialog.handleCancel()

      const result = await promise
      expect(result).toBe(false)
    })

    it('closes the dialog', async () => {
      const promise = dialog.confirm({ title: 'T', description: 'D' })
      expect(dialog.isOpen.value).toBe(true)

      dialog.handleCancel()
      expect(dialog.isOpen.value).toBe(false)
      await promise
    })
  })

  describe('sequential usage', () => {
    it('handles multiple confirm/cancel cycles', async () => {
      // First dialog — confirm
      const p1 = dialog.confirm({ title: 'First', description: 'First desc' })
      dialog.handleConfirm()
      expect(await p1).toBe(true)

      // Second dialog — cancel
      const p2 = dialog.confirm({ title: 'Second', description: 'Second desc' })
      expect(dialog.title.value).toBe('Second')
      dialog.handleCancel()
      expect(await p2).toBe(false)
    })
  })
})
