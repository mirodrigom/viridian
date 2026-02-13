/**
 * VS Code Claude behavior patterns for testing
 *
 * This file contains helper functions and constants that capture
 * specific behavioral patterns from VS Code Claude extension.
 * These ensure our web version matches the native experience.
 */

import { vi } from 'vitest'

// Timing constants that match VS Code Claude behavior
export const VSCODE_TIMINGS = {
  /** Time VS Code shows typing indicator before content appears */
  TYPING_INDICATOR_DELAY: 150,

  /** Typical delay between streaming chunks in VS Code */
  STREAM_CHUNK_INTERVAL: 50,

  /** Maximum acceptable delay for visual feedback */
  MAX_RESPONSE_DELAY: 1000,

  /** Time between rapid session operations */
  SESSION_TRANSITION_DELAY: 200,

  /** Network reconnection simulation delay */
  NETWORK_INTERRUPTION_DELAY: 2000,
}

// Visual state patterns
export const VSCODE_STATES = {
  /** States that should exist during streaming */
  STREAMING_STATES: ['typing', 'content', 'complete'],

  /** Tool approval flow states */
  TOOL_STATES: ['pending', 'approved', 'executing'],

  /** Error presentation modes */
  ERROR_MODES: ['inline', 'recoverable', 'fatal'],
}

/**
 * Simulate VS Code-like streaming behavior
 */
export class VSCodeStreamSimulator {
  private timingLogs: { event: string; timestamp: number }[] = []

  /**
   * Simulate realistic streaming with VS Code-like timing
   */
  async simulateRealisticStream(
    webSocketMock: any,
    content: string,
    options: {
      chunkSize?: number
      chunkDelay?: number
      showTypingIndicator?: boolean
    } = {}
  ) {
    const {
      chunkSize = 20,
      chunkDelay = VSCODE_TIMINGS.STREAM_CHUNK_INTERVAL,
      showTypingIndicator = true
    } = options

    this.logEvent('stream_simulation_start')

    if (showTypingIndicator) {
      webSocketMock.emit('stream_start')
      this.logEvent('typing_indicator_shown')
      vi.advanceTimersByTime(VSCODE_TIMINGS.TYPING_INDICATOR_DELAY)
    }

    const chunks = this.chunkText(content, chunkSize)

    for (const chunk of chunks) {
      webSocketMock.emit('stream_delta', { text: chunk })
      this.logEvent('chunk_sent')
      vi.advanceTimersByTime(chunkDelay)
    }

    webSocketMock.emit('stream_end', {})
    this.logEvent('stream_complete')
  }

  /**
   * Simulate VS Code-like tool workflow
   */
  async simulateToolWorkflow(
    webSocketMock: any,
    tools: Array<{
      name: string
      input: Record<string, unknown>
      preText?: string
      postText?: string
    }>
  ) {
    this.logEvent('tool_workflow_start')

    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i]!

      if (tool.preText) {
        webSocketMock.emit('stream_delta', { text: tool.preText })
        this.logEvent('tool_context_added')
      }

      webSocketMock.emit('tool_use', {
        tool: tool.name,
        input: tool.input,
        requestId: `req-${tool.name}-${i}`
      })
      this.logEvent('tool_requested')

      // Simulate brief pause for user approval (like VS Code)
      vi.advanceTimersByTime(100)

      if (tool.postText) {
        webSocketMock.emit('stream_delta', { text: tool.postText })
        this.logEvent('tool_followup_added')
      }

      // Brief pause between tools (like VS Code)
      if (i < tools.length - 1) {
        vi.advanceTimersByTime(200)
      }
    }

    this.logEvent('tool_workflow_complete')
  }

  /**
   * Simulate network interruption and recovery (like VS Code handles)
   */
  async simulateNetworkRecovery(
    webSocketMock: any,
    partialContent: string,
    remainingContent: string
  ) {
    this.logEvent('network_interruption_start')

    // Start streaming
    webSocketMock.emit('stream_start')
    webSocketMock.emit('stream_delta', { text: partialContent })

    // Simulate network loss
    webSocketMock.simulateDisconnection()
    this.logEvent('connection_lost')

    // Simulate network delay
    vi.advanceTimersByTime(VSCODE_TIMINGS.NETWORK_INTERRUPTION_DELAY)

    // Reconnect and recover
    webSocketMock.simulateConnection()
    webSocketMock.emit('session_status', {
      isStreaming: true,
      accumulatedText: partialContent
    })
    this.logEvent('session_recovered')

    // Continue streaming
    webSocketMock.emit('stream_delta', { text: remainingContent })
    webSocketMock.emit('stream_end', {})
    this.logEvent('stream_completed_after_recovery')
  }

  /**
   * Get timing analysis for performance validation
   */
  getTimingAnalysis() {
    const events = this.timingLogs
    const analysis = {
      totalDuration: events.length > 0 ?
        events[events.length - 1]!.timestamp - events[0]!.timestamp : 0,
      eventCount: events.length,
      averageInterval: 0,
      maxInterval: 0,
      timeline: events.map(e => ({ event: e.event, timestamp: e.timestamp }))
    }

    if (events.length > 1) {
      const intervals = []
      for (let i = 1; i < events.length; i++) {
        const interval = events[i]!.timestamp - events[i - 1]!.timestamp
        intervals.push(interval)
      }
      analysis.averageInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      analysis.maxInterval = Math.max(...intervals)
    }

    return analysis
  }

  /**
   * Reset timing logs for fresh test
   */
  reset() {
    this.timingLogs = []
  }

  private logEvent(event: string) {
    this.timingLogs.push({ event, timestamp: Date.now() })
  }

  private chunkText(text: string, chunkSize: number): string[] {
    const chunks = []
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize))
    }
    return chunks
  }
}

/**
 * Assert that timing behavior matches VS Code standards
 */
export function assertVSCodeTiming(analysis: ReturnType<VSCodeStreamSimulator['getTimingAnalysis']>) {
  // VS Code should respond quickly
  expect(analysis.totalDuration).toBeLessThan(10000) // Less than 10 seconds for any operation

  // Individual events shouldn't have long gaps
  expect(analysis.maxInterval).toBeLessThan(VSCODE_TIMINGS.MAX_RESPONSE_DELAY)

  // Should have reasonable event density
  if (analysis.totalDuration > 0) {
    const eventsPerSecond = (analysis.eventCount / analysis.totalDuration) * 1000
    expect(eventsPerSecond).toBeGreaterThan(0.5) // At least one event per 2 seconds
  }
}

/**
 * Assert that message flow matches VS Code patterns
 */
export function assertVSCodeMessageFlow(messages: any[], expectedPattern: string[]) {
  const actualPattern = messages.map(msg => {
    if (msg.role === 'user') return 'user'
    if (msg.role === 'assistant') return 'assistant'
    if (msg.role === 'system' && msg.toolUse) return 'tool'
    return 'unknown'
  })

  expect(actualPattern).toEqual(expectedPattern)
}

/**
 * Assert that streaming states match VS Code behavior
 */
export function assertVSCodeStreamingStates(
  messages: any[],
  expectedStreamingStates: boolean[]
) {
  const actualStates = messages
    .filter(m => m.role === 'assistant')
    .map(m => Boolean(m.isStreaming))

  expect(actualStates).toEqual(expectedStreamingStates)
}

/**
 * Create realistic VS Code-style content for testing
 */
export const VSCODE_TEST_CONTENT = {
  SHORT_RESPONSE: "I'll help you with that.",

  MEDIUM_RESPONSE: "I'll help you with that. Let me break this down step by step:\n\n1. First, we need to understand the requirements.\n2. Then we can design the solution.\n3. Finally, we'll implement and test.",

  LONG_RESPONSE: Array(100).fill(0).map((_, i) =>
    `This is sentence ${i + 1} of a very long response that tests streaming performance and visual feedback. `
  ).join(''),

  CODE_ANALYSIS: "Let me analyze this code for you. I'll read the file first, then provide suggestions for improvement.",

  MULTI_TOOL_WORKFLOW: "I'll help you refactor this code. First, let me read the current implementation, then I'll suggest improvements and run the tests.",

  ERROR_SCENARIOS: {
    RATE_LIMIT: "You've hit your usage limit. Your usage resets Feb 13, 3:45pm",
    NETWORK_ERROR: "Connection to server lost. Attempting to reconnect...",
    MALFORMED_INPUT: "Invalid input format received"
  }
}

export { expect } from 'vitest'