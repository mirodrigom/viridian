import { createPinia, setActivePinia } from 'pinia'
import type { ChatMessage, ToolUseInfo } from '@/stores/chat'

/**
 * Setup a fresh Pinia instance for testing
 */
export function setupTestPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

/**
 * Create a mock chat message with optional overrides
 */
export function createMockMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    role: 'user',
    content: 'Test message content',
    timestamp: Date.now(),
    ...overrides,
  }
}

/**
 * Create a mock assistant message that's streaming
 */
export function createMockStreamingMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return createMockMessage({
    role: 'assistant',
    content: '',
    isStreaming: true,
    ...overrides,
  })
}

/**
 * Create a mock tool use message
 */
export function createMockToolMessage(tool: string, input: Record<string, unknown> = {}, status: ToolUseInfo['status'] = 'pending'): ChatMessage {
  return createMockMessage({
    role: 'system',
    content: `Tool request: ${tool}`,
    toolUse: {
      tool,
      input,
      requestId: `req-${Date.now()}`,
      status,
    },
  })
}

/**
 * Wait for next tick (useful for waiting for reactive updates)
 */
export function nextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Mock a rate limit error message
 */
export function createRateLimitError(resetTime: string): string {
  return `You've hit your usage limit. Your usage will reset ${resetTime}.`
}

/**
 * Mock usage data
 */
export function createMockUsage(inputTokens = 100, outputTokens = 50, totalCost = 0.01) {
  return {
    inputTokens,
    outputTokens,
    totalCost,
  }
}

/**
 * Clear sessionStorage for clean test state
 */
export function clearSessionStorage() {
  window.sessionStorage.clear()
}