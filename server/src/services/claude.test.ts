import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

/**
 * Test the core logic of claude.ts — specifically buildEmitEvent and emitSDKMessage
 * which implement the AskUserQuestion buffering mechanism.
 *
 * We re-implement these functions to test them without requiring the full
 * claude-sdk module (which spawns real processes).
 */

// ─── Minimal types mirroring claude.ts ──────────────────────────────────

interface SDKMessage {
  type: string
  text?: string
  tool?: string
  input?: Record<string, unknown>
  requestId?: string
  partialJson?: string
  accumulatedJson?: string
  error?: string
  sessionId?: string
  inputTokens?: number
  outputTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  exitCode?: number
  toolName?: string
  toolInput?: Record<string, unknown>
  toolUseId?: string
}

interface Session {
  id: string
  claudeSessionId?: string
  emitter: EventEmitter
  usage: { inputTokens: number; outputTokens: number }
  isStreaming: boolean
  accumulatedText: string
  stdinWrite?: (data: string) => void
  pendingQuestionBuffer: { event: string; data: unknown }[] | null
  lastActivity: number
}

function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session-id',
    emitter: new EventEmitter(),
    usage: { inputTokens: 0, outputTokens: 0 },
    isStreaming: true,
    accumulatedText: '',
    pendingQuestionBuffer: null,
    lastActivity: Date.now(),
    ...overrides,
  }
}

// ─── Re-implemented logic from claude.ts ────────────────────────────────

function buildEmitEvent(session: Session, msg: SDKMessage): { event: string; data: unknown } | null {
  switch (msg.type) {
    case 'text_delta':
      session.accumulatedText += msg.text
      return { event: 'stream_delta', data: { text: msg.text } }
    case 'thinking_start':
      return { event: 'thinking_start', data: {} }
    case 'thinking_delta':
      return { event: 'thinking_delta', data: { text: msg.text } }
    case 'thinking_end':
      return { event: 'thinking_end', data: {} }
    case 'tool_use':
      return { event: 'tool_use', data: { tool: msg.tool, input: msg.input, requestId: msg.requestId } }
    case 'tool_input_delta':
      return { event: 'tool_input_delta', data: { requestId: msg.requestId, tool: msg.tool, partialJson: msg.partialJson, accumulatedJson: msg.accumulatedJson } }
    case 'tool_input_complete':
      return { event: 'tool_input_complete', data: { requestId: msg.requestId, tool: msg.tool, input: msg.input } }
    case 'error':
      return { event: 'error', data: { error: msg.error } }
    case 'system':
      if (msg.sessionId) session.claudeSessionId = msg.sessionId
      return null
    case 'message_start': {
      const input = msg.inputTokens || 0
      const cacheCreation = msg.cacheCreationInputTokens || 0
      const cacheRead = msg.cacheReadInputTokens || 0
      session.usage.inputTokens = input + cacheCreation + cacheRead
      return null
    }
    case 'message_delta':
      if (msg.outputTokens) session.usage.outputTokens = msg.outputTokens
      return null
    case 'control_request':
      return { event: 'control_request', data: { requestId: msg.requestId, toolName: msg.toolName, toolInput: msg.toolInput, toolUseId: msg.toolUseId } }
    case 'result':
      if (msg.sessionId) session.claudeSessionId = msg.sessionId
      session.isStreaming = false
      session.lastActivity = Date.now()
      session.stdinWrite = undefined
      return { event: 'stream_end', data: { sessionId: session.id, claudeSessionId: session.claudeSessionId, exitCode: msg.exitCode, usage: { input_tokens: session.usage.inputTokens, output_tokens: session.usage.outputTokens } } }
    default:
      return null
  }
}

function emitSDKMessage(session: Session, msg: SDKMessage) {
  if (session.pendingQuestionBuffer !== null) {
    if (msg.type === 'control_request' || msg.type === 'tool_input_delta' || msg.type === 'tool_input_complete') {
      // pass through
    } else {
      const evt = buildEmitEvent(session, msg)
      if (evt) session.pendingQuestionBuffer.push(evt)
      return
    }
  }

  const evt = buildEmitEvent(session, msg)
  if (!evt) return

  if (msg.type === 'tool_use' && msg.tool === 'AskUserQuestion') {
    session.pendingQuestionBuffer = []
  }

  session.emitter.emit(evt.event, evt.data)
}

function respondToPermission(session: Session, requestId: string, approved: boolean) {
  if (session.stdinWrite) {
    const response = approved
      ? { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'allow' } } }
      : { type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { behavior: 'deny', message: 'User denied the tool request' } } }
    session.stdinWrite(JSON.stringify(response))
  }

  if (session.pendingQuestionBuffer) {
    const buffered = session.pendingQuestionBuffer
    session.pendingQuestionBuffer = null
    for (const evt of buffered) {
      session.emitter.emit(evt.event, evt.data)
    }
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('buildEmitEvent', () => {
  it('text_delta accumulates text and emits stream_delta', () => {
    const session = createTestSession()
    const result = buildEmitEvent(session, { type: 'text_delta', text: 'hello ' })
    expect(result).toEqual({ event: 'stream_delta', data: { text: 'hello ' } })
    expect(session.accumulatedText).toBe('hello ')

    buildEmitEvent(session, { type: 'text_delta', text: 'world' })
    expect(session.accumulatedText).toBe('hello world')
  })

  it('system message sets claudeSessionId', () => {
    const session = createTestSession()
    const result = buildEmitEvent(session, { type: 'system', sessionId: 'claude-abc' })
    expect(result).toBeNull()
    expect(session.claudeSessionId).toBe('claude-abc')
  })

  it('message_start tracks input tokens with cache', () => {
    const session = createTestSession()
    buildEmitEvent(session, {
      type: 'message_start',
      inputTokens: 100,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 25,
    })
    expect(session.usage.inputTokens).toBe(175)
  })

  it('message_delta tracks output tokens', () => {
    const session = createTestSession()
    buildEmitEvent(session, { type: 'message_delta', outputTokens: 500 })
    expect(session.usage.outputTokens).toBe(500)
  })

  it('result ends streaming and sets claudeSessionId', () => {
    const session = createTestSession()
    session.stdinWrite = vi.fn()
    const result = buildEmitEvent(session, { type: 'result', sessionId: 'session-123', exitCode: 0 })

    expect(session.isStreaming).toBe(false)
    expect(session.claudeSessionId).toBe('session-123')
    expect(session.stdinWrite).toBeUndefined()
    expect(result!.event).toBe('stream_end')
  })

  it('tool_use emits tool event', () => {
    const session = createTestSession()
    const result = buildEmitEvent(session, {
      type: 'tool_use',
      tool: 'Write',
      input: { file_path: '/test' },
      requestId: 'req-1',
    })
    expect(result).toEqual({
      event: 'tool_use',
      data: { tool: 'Write', input: { file_path: '/test' }, requestId: 'req-1' },
    })
  })

  it('unknown message type returns null', () => {
    const session = createTestSession()
    expect(buildEmitEvent(session, { type: 'unknown_type' })).toBeNull()
  })
})

describe('emitSDKMessage — AskUserQuestion buffering', () => {
  it('normal messages emit directly', () => {
    const session = createTestSession()
    const handler = vi.fn()
    session.emitter.on('stream_delta', handler)

    emitSDKMessage(session, { type: 'text_delta', text: 'hello' })
    expect(handler).toHaveBeenCalledWith({ text: 'hello' })
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('AskUserQuestion tool_use starts buffering', () => {
    const session = createTestSession()
    const toolHandler = vi.fn()
    session.emitter.on('tool_use', toolHandler)

    emitSDKMessage(session, {
      type: 'tool_use',
      tool: 'AskUserQuestion',
      input: { questions: [] },
      requestId: 'ask-1',
    })

    // The tool_use event itself IS emitted (so client shows the tool message)
    expect(toolHandler).toHaveBeenCalled()
    // But buffering is now active for subsequent messages
    expect(session.pendingQuestionBuffer).toEqual([])
  })

  it('subsequent text_delta messages are buffered after AskUserQuestion', () => {
    const session = createTestSession()
    const deltaHandler = vi.fn()
    session.emitter.on('stream_delta', deltaHandler)

    // Start AskUserQuestion
    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })

    // These should be buffered, NOT emitted
    emitSDKMessage(session, { type: 'text_delta', text: 'should be buffered' })
    emitSDKMessage(session, { type: 'text_delta', text: ' more text' })

    expect(deltaHandler).not.toHaveBeenCalled()
    expect(session.pendingQuestionBuffer).toHaveLength(2)
  })

  it('control_request passes through during buffering (so modal shows)', () => {
    const session = createTestSession()
    const controlHandler = vi.fn()
    session.emitter.on('control_request', controlHandler)

    // Start buffering
    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })

    // control_request should pass through
    emitSDKMessage(session, {
      type: 'control_request',
      requestId: 'ctrl-1',
      toolName: 'AskUserQuestion',
      toolInput: {},
    })

    expect(controlHandler).toHaveBeenCalled()
  })

  it('tool_input_delta passes through during buffering', () => {
    const session = createTestSession()
    const inputHandler = vi.fn()
    session.emitter.on('tool_input_delta', inputHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    emitSDKMessage(session, { type: 'tool_input_delta', requestId: 'ask-1', partialJson: '{"q' })

    expect(inputHandler).toHaveBeenCalled()
  })

  it('tool_input_complete passes through during buffering', () => {
    const session = createTestSession()
    const completeHandler = vi.fn()
    session.emitter.on('tool_input_complete', completeHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    emitSDKMessage(session, { type: 'tool_input_complete', requestId: 'ask-1', input: { questions: [] } })

    expect(completeHandler).toHaveBeenCalled()
  })

  it('non-AskUserQuestion tool_use does NOT start buffering', () => {
    const session = createTestSession()
    emitSDKMessage(session, { type: 'tool_use', tool: 'Write', input: {}, requestId: 'w-1' })
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('tool_use events during buffering are buffered (not emitted)', () => {
    const session = createTestSession()
    const toolHandler = vi.fn()
    session.emitter.on('tool_use', toolHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    toolHandler.mockClear()

    // Another tool_use during buffering should be queued
    emitSDKMessage(session, { type: 'tool_use', tool: 'Write', input: { file: 'x' }, requestId: 'w-1' })
    expect(toolHandler).not.toHaveBeenCalled()
    expect(session.pendingQuestionBuffer).toHaveLength(1)
  })
})

describe('respondToPermission — flush buffered events', () => {
  it('sends allow response via stdinWrite', () => {
    const session = createTestSession()
    session.stdinWrite = vi.fn()

    respondToPermission(session, 'ctrl-1', true)

    expect(session.stdinWrite).toHaveBeenCalledOnce()
    const sent = JSON.parse((session.stdinWrite as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(sent.type).toBe('control_response')
    expect(sent.response.response.behavior).toBe('allow')
    expect(sent.response.request_id).toBe('ctrl-1')
  })

  it('sends deny response via stdinWrite', () => {
    const session = createTestSession()
    session.stdinWrite = vi.fn()

    respondToPermission(session, 'ctrl-1', false)

    const sent = JSON.parse((session.stdinWrite as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(sent.response.response.behavior).toBe('deny')
  })

  it('flushes buffered events after approval', () => {
    const session = createTestSession()
    session.stdinWrite = vi.fn()
    const deltaHandler = vi.fn()
    const toolHandler = vi.fn()
    session.emitter.on('stream_delta', deltaHandler)
    session.emitter.on('tool_use', toolHandler)

    // Buffer some events
    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    emitSDKMessage(session, { type: 'text_delta', text: 'buffered text' })
    emitSDKMessage(session, { type: 'tool_use', tool: 'Write', input: {}, requestId: 'w-1' })

    expect(deltaHandler).not.toHaveBeenCalled()

    // Flush
    respondToPermission(session, 'ctrl-1', true)

    // Now the buffered events should have been emitted
    expect(deltaHandler).toHaveBeenCalledWith({ text: 'buffered text' })
    expect(toolHandler).toHaveBeenCalledWith({ tool: 'Write', input: {}, requestId: 'w-1' })
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('clears buffer even without stdinWrite', () => {
    const session = createTestSession()
    // No stdinWrite set
    session.pendingQuestionBuffer = [
      { event: 'stream_delta', data: { text: 'test' } },
    ]
    const handler = vi.fn()
    session.emitter.on('stream_delta', handler)

    respondToPermission(session, 'ctrl-1', true)

    expect(handler).toHaveBeenCalledWith({ text: 'test' })
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('does nothing when no buffer is active', () => {
    const session = createTestSession()
    session.stdinWrite = vi.fn()

    respondToPermission(session, 'ctrl-1', true)

    expect(session.stdinWrite).toHaveBeenCalled()
    // No error, no flush needed
    expect(session.pendingQuestionBuffer).toBeNull()
  })
})

describe('full AskUserQuestion lifecycle', () => {
  it('buffers text, allows control_request through, flushes on response', () => {
    const session = createTestSession()
    session.stdinWrite = vi.fn()

    const events: { event: string; data: unknown }[] = []
    session.emitter.on('tool_use', (d) => events.push({ event: 'tool_use', data: d }))
    session.emitter.on('stream_delta', (d) => events.push({ event: 'stream_delta', data: d }))
    session.emitter.on('control_request', (d) => events.push({ event: 'control_request', data: d }))
    session.emitter.on('tool_input_complete', (d) => events.push({ event: 'tool_input_complete', data: d }))

    // 1. Text before AskUserQuestion — emits immediately
    emitSDKMessage(session, { type: 'text_delta', text: 'Let me ask you...' })
    expect(events).toHaveLength(1)

    // 2. AskUserQuestion tool_use — emits AND starts buffering
    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    expect(events).toHaveLength(2)

    // 3. tool_input_complete — passes through (for modal rendering)
    emitSDKMessage(session, { type: 'tool_input_complete', requestId: 'ask-1', input: { questions: [{ question: 'Pick one?' }] } })
    expect(events).toHaveLength(3)

    // 4. control_request — passes through (triggers approval flow)
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'AskUserQuestion', toolInput: {} })
    expect(events).toHaveLength(4)

    // 5. Text arrives WHILE waiting for user — gets buffered
    emitSDKMessage(session, { type: 'text_delta', text: 'I will proceed with...' })
    expect(events).toHaveLength(4) // Still 4! Text was buffered
    expect(session.pendingQuestionBuffer).toHaveLength(1)

    // 6. User responds — flush
    respondToPermission(session, 'ctrl-1', true)
    expect(events).toHaveLength(5) // Buffered text now emitted
    expect(events[4]).toEqual({ event: 'stream_delta', data: { text: 'I will proceed with...' } })
    expect(session.pendingQuestionBuffer).toBeNull()
  })
})
