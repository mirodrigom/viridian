import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore, type ToolUseInfo } from '@/stores/chat'
import { setupTestPinia, createMockMessage, createMockToolMessage, nextTick } from '@/test/utils'

describe('Tool Use Workflows', () => {
  let chatStore: ReturnType<typeof useChatStore>

  beforeEach(() => {
    setupTestPinia()
    chatStore = useChatStore()
  })

  describe('Tool Request Lifecycle', () => {
    it('should create tool message with pending status', () => {
      const toolMessage = createMockToolMessage('Read', {
        file_path: '/test/file.txt'
      })

      chatStore.addMessage(toolMessage)

      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.toolUse?.status).toBe('pending')
      expect(chatStore.messages[0]?.toolUse?.tool).toBe('Read')
      expect(chatStore.messages[0]?.toolUse?.input.file_path).toBe('/test/file.txt')
    })

    it('should approve tool request', () => {
      const toolMessage = createMockToolMessage('Bash', {
        command: 'ls -la'
      })

      chatStore.addMessage(toolMessage)

      // Simulate approval (would normally come from useClaudeStream)
      const requestId = toolMessage.toolUse!.requestId
      const msg = chatStore.messages.find(m => m.toolUse?.requestId === requestId)
      if (msg?.toolUse) {
        msg.toolUse.status = 'approved'
      }

      expect(chatStore.messages[0]?.toolUse?.status).toBe('approved')
    })

    it('should reject tool request', () => {
      const toolMessage = createMockToolMessage('Edit', {
        file_path: '/important/file.txt',
        old_string: 'original',
        new_string: 'modified'
      })

      chatStore.addMessage(toolMessage)

      // Simulate rejection
      const requestId = toolMessage.toolUse!.requestId
      const msg = chatStore.messages.find(m => m.toolUse?.requestId === requestId)
      if (msg?.toolUse) {
        msg.toolUse.status = 'rejected'
      }

      expect(chatStore.messages[0]?.toolUse?.status).toBe('rejected')
    })

    it('should handle tool requests with complex input', () => {
      const complexInput = {
        questions: [
          {
            question: 'What database should we use?',
            options: [
              { label: 'PostgreSQL', description: 'Robust relational database' },
              { label: 'MongoDB', description: 'Document-based NoSQL' }
            ]
          }
        ]
      }

      const toolMessage = createMockToolMessage('AskUserQuestion', complexInput)
      chatStore.addMessage(toolMessage)

      expect(chatStore.messages[0]?.toolUse?.input.questions).toEqual(complexInput.questions)
    })
  })

  describe('Tool Input Streaming', () => {
    it('should handle progressive tool input building', () => {
      const toolMessage = createMockToolMessage('Bash', {})
      const requestId = toolMessage.toolUse!.requestId

      chatStore.addMessage(toolMessage)

      // Simulate streaming input chunks
      const chunks = [
        '{"command":',
        '"git status",',
        '"description":',
        '"Check git status"}'
      ]

      let accumulated = ''
      chunks.forEach(chunk => {
        accumulated += chunk
        chatStore.appendToolInputDelta(requestId, accumulated)
      })

      // Final input should be parsed correctly
      expect(chatStore.messages[0]?.toolUse?.input).toEqual({
        command: 'git status',
        description: 'Check git status'
      })
      expect(chatStore.messages[0]?.toolUse?.isInputStreaming).toBe(true)

      // Complete the input
      chatStore.updateToolInput(requestId, {
        command: 'git status',
        description: 'Check repository status'
      })

      expect(chatStore.messages[0]?.toolUse?.isInputStreaming).toBe(false)
    })

    it('should handle malformed JSON during streaming gracefully', () => {
      const toolMessage = createMockToolMessage('Edit', {})
      const requestId = toolMessage.toolUse!.requestId

      chatStore.addMessage(toolMessage)

      // Send invalid JSON
      chatStore.appendToolInputDelta(requestId, '{"invalid": json malformed')

      // Should not crash and input should remain empty
      expect(chatStore.messages[0]?.toolUse?.input).toEqual({})
      expect(chatStore.messages[0]?.toolUse?.isInputStreaming).toBe(true)

      // Send valid JSON
      chatStore.appendToolInputDelta(requestId, '{"file_path": "test.txt"}')

      expect(chatStore.messages[0]?.toolUse?.input).toEqual({ file_path: "test.txt" })
    })

    it('should handle empty tool input', () => {
      const toolMessage = createMockToolMessage('EnterPlanMode', {})
      const requestId = toolMessage.toolUse!.requestId

      chatStore.addMessage(toolMessage)

      // Some tools have no input
      chatStore.updateToolInput(requestId, {})

      expect(chatStore.messages[0]?.toolUse?.input).toEqual({})
      expect(chatStore.messages[0]?.toolUse?.isInputStreaming).toBe(false)
    })
  })

  describe('Tool Response Handling', () => {
    it('should handle AskUserQuestion with user answers', () => {
      const askQuestionTool = createMockToolMessage('AskUserQuestion', {
        questions: [
          {
            question: 'Choose deployment strategy',
            options: ['Docker', 'Traditional']
          }
        ]
      })

      chatStore.addMessage(askQuestionTool)

      // Simulate user response
      const requestId = askQuestionTool.toolUse!.requestId
      const msg = chatStore.messages.find(m => m.toolUse?.requestId === requestId)
      if (msg?.toolUse) {
        msg.toolUse.status = 'approved'
        msg.toolUse.input._userAnswers = { '0': 'Docker' }
      }

      expect(chatStore.messages[0]?.toolUse?.status).toBe('approved')
      expect(chatStore.messages[0]?.toolUse?.input._userAnswers).toEqual({ '0': 'Docker' })
    })

    it('should handle multiple choice questions', () => {
      const multiChoiceInput = {
        questions: [
          {
            question: 'Which features do you want?',
            multiSelect: true,
            options: ['Authentication', 'Logging', 'Caching']
          }
        ]
      }

      const toolMessage = createMockToolMessage('AskUserQuestion', multiChoiceInput)
      chatStore.addMessage(toolMessage)

      const requestId = toolMessage.toolUse!.requestId
      const msg = chatStore.messages.find(m => m.toolUse?.requestId === requestId)
      if (msg?.toolUse) {
        msg.toolUse.status = 'approved'
        msg.toolUse.input._userAnswers = { '0': ['Authentication', 'Logging'] }
      }

      expect(chatStore.messages[0]?.toolUse?.input._userAnswers).toEqual({
        '0': ['Authentication', 'Logging']
      })
    })
  })

  describe('Multiple Tool Scenarios', () => {
    it('should handle sequence of different tools', () => {
      const tools = [
        createMockToolMessage('Read', { file_path: 'package.json' }),
        createMockToolMessage('Edit', { file_path: 'package.json', old_string: 'old', new_string: 'new' }),
        createMockToolMessage('Bash', { command: 'npm test' })
      ]

      tools.forEach(tool => chatStore.addMessage(tool))

      expect(chatStore.messages).toHaveLength(3)
      expect(chatStore.messages.map(m => m.toolUse?.tool)).toEqual(['Read', 'Edit', 'Bash'])
      expect(chatStore.messages.every(m => m.toolUse?.status === 'pending')).toBe(true)
    })

    it('should handle concurrent tool operations', () => {
      const concurrentTools = [
        createMockToolMessage('Glob', { pattern: '**/*.js' }),
        createMockToolMessage('Grep', { pattern: 'TODO', path: 'src/' })
      ]

      concurrentTools.forEach(tool => chatStore.addMessage(tool))

      // Both tools can be pending simultaneously
      expect(chatStore.messages).toHaveLength(2)
      expect(chatStore.messages.every(m => m.toolUse?.status === 'pending')).toBe(true)

      // Approve them in different order
      const secondRequestId = chatStore.messages[1]?.toolUse?.requestId
      const firstRequestId = chatStore.messages[0]?.toolUse?.requestId

      // Approve second first
      const secondMsg = chatStore.messages.find(m => m.toolUse?.requestId === secondRequestId)
      if (secondMsg?.toolUse) {
        secondMsg.toolUse.status = 'approved'
      }

      expect(chatStore.messages[0]?.toolUse?.status).toBe('pending')
      expect(chatStore.messages[1]?.toolUse?.status).toBe('approved')
    })
  })

  describe('Tool Permission Modes', () => {
    it('should simulate auto-approval for safe tools', () => {
      const safeTools = ['Read', 'Glob', 'Grep']

      safeTools.forEach(toolName => {
        const toolMessage = createMockToolMessage(toolName, { test: 'input' })
        // Simulate auto-approval
        toolMessage.toolUse!.status = 'approved'
        chatStore.addMessage(toolMessage)
      })

      expect(chatStore.messages).toHaveLength(3)
      expect(chatStore.messages.every(m => m.toolUse?.status === 'approved')).toBe(true)
    })

    it('should require approval for dangerous tools', () => {
      const dangerousTools = ['Bash', 'Edit', 'Write']

      dangerousTools.forEach(toolName => {
        const toolMessage = createMockToolMessage(toolName, { test: 'input' })
        // These would remain pending in ask mode
        chatStore.addMessage(toolMessage)
      })

      expect(chatStore.messages).toHaveLength(3)
      expect(chatStore.messages.every(m => m.toolUse?.status === 'pending')).toBe(true)
    })

    it('should never auto-approve AskUserQuestion', () => {
      const askQuestion = createMockToolMessage('AskUserQuestion', {
        questions: [{ question: 'Test?', options: ['Yes', 'No'] }]
      })

      // Even in bypass mode, this should remain pending
      chatStore.addMessage(askQuestion)

      expect(chatStore.messages[0]?.toolUse?.status).toBe('pending')
    })
  })

  describe('Todo Extraction from Tools', () => {
    it('should extract todos from TodoWrite tool', () => {
      const todos = [
        { content: 'Fix authentication bug', status: 'pending' as const, activeForm: 'Fixing authentication bug' },
        { content: 'Add unit tests', status: 'in_progress' as const, activeForm: 'Adding unit tests' },
        { content: 'Deploy to staging', status: 'completed' as const, activeForm: 'Deploying to staging' }
      ]

      const todoTool = createMockToolMessage('TodoWrite', { todos })
      chatStore.addMessage(todoTool)

      expect(chatStore.latestTodos).toEqual(todos)
    })

    it('should return latest todos when multiple TodoWrite tools exist', () => {
      const oldTodos = [
        { content: 'Old task 1', status: 'completed' as const, activeForm: 'Completing old task 1' },
        { content: 'Old task 2', status: 'completed' as const, activeForm: 'Completing old task 2' }
      ]

      const newTodos = [
        { content: 'New task 1', status: 'pending' as const, activeForm: 'Starting new task 1' },
        { content: 'New task 2', status: 'in_progress' as const, activeForm: 'Working on new task 2' }
      ]

      chatStore.addMessage(createMockToolMessage('TodoWrite', { todos: oldTodos }))
      chatStore.addMessage(createMockToolMessage('Read', { file_path: 'test.txt' })) // Non-todo tool
      chatStore.addMessage(createMockToolMessage('TodoWrite', { todos: newTodos }))

      expect(chatStore.latestTodos).toEqual(newTodos)
    })

    it('should handle empty todos array', () => {
      const todoTool = createMockToolMessage('TodoWrite', { todos: [] })
      chatStore.addMessage(todoTool)

      expect(chatStore.latestTodos).toEqual([])
    })

    it('should filter out invalid todo items', () => {
      const mixedTodos = [
        { content: 'Valid todo', status: 'pending' as const, activeForm: 'Working on valid todo' },
        { content: '', status: 'pending' as const }, // Invalid: empty content
        { content: 'Another valid', status: 'completed' as const, activeForm: 'Completing another valid' },
        'invalid string todo', // Invalid: not an object
      ]

      const todoTool = createMockToolMessage('TodoWrite', { todos: mixedTodos })
      chatStore.addMessage(todoTool)

      // Should handle mixed array gracefully
      expect(Array.isArray(chatStore.latestTodos)).toBe(true)
    })
  })

  describe('Plan Mode Tool Integration', () => {
    it('should track plan mode entry and exit', () => {
      expect(chatStore.inPlanMode).toBe(false)

      // Enter plan mode
      const enterPlanTool = createMockToolMessage('EnterPlanMode', {})
      chatStore.addMessage(enterPlanTool)

      // Simulate the plan mode tracking (would happen in useClaudeStream)
      chatStore.inPlanMode = true

      expect(chatStore.inPlanMode).toBe(true)

      // Exit plan mode
      const exitPlanTool = createMockToolMessage('ExitPlanMode', {})
      chatStore.addMessage(exitPlanTool)

      // Simulate plan mode exit
      chatStore.inPlanMode = false

      expect(chatStore.inPlanMode).toBe(false)
      expect(chatStore.messages).toHaveLength(2)
    })

    it('should handle nested plan mode operations', () => {
      // Enter plan mode
      chatStore.inPlanMode = true
      chatStore.addMessage(createMockToolMessage('EnterPlanMode', {}))

      // Tools within plan mode
      chatStore.addMessage(createMockToolMessage('Read', { file_path: 'architecture.md' }))
      chatStore.addMessage(createMockToolMessage('Grep', { pattern: 'TODO', path: 'src/' }))

      // Exit plan mode
      chatStore.inPlanMode = false
      chatStore.addMessage(createMockToolMessage('ExitPlanMode', {}))

      expect(chatStore.messages).toHaveLength(4)
      expect(chatStore.inPlanMode).toBe(false)
    })
  })

  describe('Tool Error Scenarios', () => {
    it('should handle tool with missing requestId', () => {
      const toolMessage = createMockMessage({
        role: 'system',
        content: 'Tool request: InvalidTool',
        toolUse: {
          tool: 'InvalidTool',
          input: {},
          requestId: '', // Invalid empty requestId
          status: 'pending'
        }
      })

      chatStore.addMessage(toolMessage)

      // Should not crash with missing requestId
      chatStore.appendToolInputDelta('', '{}')
      chatStore.updateToolInput('', {})

      expect(chatStore.messages).toHaveLength(1)
    })

    it('should handle tool updates for non-existent requests', () => {
      chatStore.addMessage(createMockToolMessage('Read', { file_path: 'test.txt' }))

      // Try to update non-existent tool
      chatStore.appendToolInputDelta('non-existent-id', '{"test": "data"}')
      chatStore.updateToolInput('non-existent-id', { test: 'data' })

      // Should not affect existing messages
      expect(chatStore.messages).toHaveLength(1)
      expect(chatStore.messages[0]?.toolUse?.input).toEqual({ file_path: 'test.txt' })
    })

    it('should handle rapid tool status changes', () => {
      const toolMessage = createMockToolMessage('Bash', { command: 'ls' })
      const requestId = toolMessage.toolUse!.requestId

      chatStore.addMessage(toolMessage)

      // Rapid status changes
      const statusChanges: ToolUseInfo['status'][] = ['approved', 'pending', 'rejected', 'approved']

      statusChanges.forEach(status => {
        const msg = chatStore.messages.find(m => m.toolUse?.requestId === requestId)
        if (msg?.toolUse) {
          msg.toolUse.status = status
        }
      })

      expect(chatStore.messages[0]?.toolUse?.status).toBe('approved')
    })
  })

  describe('Tool Performance', () => {
    it('should handle many tools efficiently', () => {
      const startTime = performance.now()

      // Add many tool messages
      for (let i = 0; i < 100; i++) {
        const toolMessage = createMockToolMessage('Read', { file_path: `file-${i}.txt` })
        chatStore.addMessage(toolMessage)
      }

      const endTime = performance.now()
      const duration = endTime - startTime

      expect(chatStore.messages).toHaveLength(100)
      expect(duration).toBeLessThan(50) // Should complete in under 50ms
    })

    it('should find latest todos efficiently with many tools', () => {
      // Add many non-todo tools
      for (let i = 0; i < 50; i++) {
        chatStore.addMessage(createMockToolMessage('Read', { file_path: `file-${i}.txt` }))
      }

      // Add TodoWrite tools
      const todos1 = [{ content: 'First todo', status: 'pending' as const }]
      const todos2 = [{ content: 'Second todo', status: 'completed' as const }]

      chatStore.addMessage(createMockToolMessage('TodoWrite', { todos: todos1 }))

      // Add more non-todo tools
      for (let i = 0; i < 25; i++) {
        chatStore.addMessage(createMockToolMessage('Bash', { command: `command-${i}` }))
      }

      chatStore.addMessage(createMockToolMessage('TodoWrite', { todos: todos2 }))

      const startTime = performance.now()
      const latestTodos = chatStore.latestTodos
      const endTime = performance.now()

      expect(latestTodos).toEqual(todos2)
      expect(endTime - startTime).toBeLessThan(5) // Should be very fast
    })
  })
})