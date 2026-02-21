import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

/**
 * Test the core logic of claude.ts — specifically buildEmitEvent, emitSDKMessage,
 * and server-side auto-approval of control_requests.
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
  userPermissionMode?: string
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
    userPermissionMode: 'default',
    ...overrides,
  }
}

// ─── Re-implemented logic from claude.ts ────────────────────────────────

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'NotebookEdit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'WebSearch']
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite']

function shouldAutoApprove(session: Session, toolName: string): boolean {
  const mode = session.userPermissionMode || 'default'
  if (mode === 'bypassPermissions') return true
  if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') return false
  if (mode === 'acceptEdits' && FILE_TOOLS.includes(toolName)) return true
  if (mode === 'plan' && READ_ONLY_TOOLS.includes(toolName)) return true
  return false
}

function autoApproveControlRequest(session: Session, requestId: string, toolUseId?: string) {
  if (!session.stdinWrite) return
  const response = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: { behavior: 'allow' },
    },
  }
  session.stdinWrite(JSON.stringify(response))
  if (toolUseId) {
    session.emitter.emit('tool_approved', { toolUseId })
  }
}

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
    if (msg.type === 'result') {
      const buffered = session.pendingQuestionBuffer
      session.pendingQuestionBuffer = null
      for (const evt of buffered) {
        session.emitter.emit(evt.event, evt.data)
      }
      // Fall through to emit the result/stream_end normally
    } else if (msg.type === 'control_request') {
      if (shouldAutoApprove(session, msg.toolName!)) {
        autoApproveControlRequest(session, msg.requestId!, msg.toolUseId)
        return
      }
      // Falls through to emit control_request to client
    } else if (msg.type === 'tool_input_delta' || msg.type === 'tool_input_complete') {
      // pass through
    } else {
      const evt = buildEmitEvent(session, msg)
      if (evt) session.pendingQuestionBuffer.push(evt)
      return
    }
  }

  const evt = buildEmitEvent(session, msg)
  if (!evt) return

  if (msg.type === 'control_request') {
    if (shouldAutoApprove(session, msg.toolName!)) {
      autoApproveControlRequest(session, msg.requestId!, msg.toolUseId)
      return
    }
    if (session.pendingQuestionBuffer === null) {
      session.pendingQuestionBuffer = []
    }
  }

  const BLOCKING_TOOLS = ['AskUserQuestion', 'ExitPlanMode']
  if (msg.type === 'tool_use' && BLOCKING_TOOLS.includes(msg.tool!) && session.userPermissionMode !== 'bypassPermissions') {
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

describe('shouldAutoApprove', () => {
  it('bypassPermissions auto-approves ALL tools including AskUserQuestion', () => {
    const session = createTestSession({ userPermissionMode: 'bypassPermissions' })
    expect(shouldAutoApprove(session, 'AskUserQuestion')).toBe(true)
    expect(shouldAutoApprove(session, 'Read')).toBe(true)
    expect(shouldAutoApprove(session, 'Bash')).toBe(true)
    expect(shouldAutoApprove(session, 'Write')).toBe(true)
  })

  it('non-bypassPermissions modes never auto-approve AskUserQuestion', () => {
    expect(shouldAutoApprove(createTestSession({ userPermissionMode: 'acceptEdits' }), 'AskUserQuestion')).toBe(false)
    expect(shouldAutoApprove(createTestSession({ userPermissionMode: 'plan' }), 'AskUserQuestion')).toBe(false)
    expect(shouldAutoApprove(createTestSession({ userPermissionMode: 'default' }), 'AskUserQuestion')).toBe(false)
  })

  it('non-bypassPermissions modes never auto-approve ExitPlanMode', () => {
    expect(shouldAutoApprove(createTestSession({ userPermissionMode: 'acceptEdits' }), 'ExitPlanMode')).toBe(false)
    expect(shouldAutoApprove(createTestSession({ userPermissionMode: 'plan' }), 'ExitPlanMode')).toBe(false)
    expect(shouldAutoApprove(createTestSession({ userPermissionMode: 'default' }), 'ExitPlanMode')).toBe(false)
  })

  it('bypassPermissions auto-approves ExitPlanMode', () => {
    const session = createTestSession({ userPermissionMode: 'bypassPermissions' })
    expect(shouldAutoApprove(session, 'ExitPlanMode')).toBe(true)
  })

  it('acceptEdits auto-approves file tools only', () => {
    const session = createTestSession({ userPermissionMode: 'acceptEdits' })
    expect(shouldAutoApprove(session, 'Read')).toBe(true)
    expect(shouldAutoApprove(session, 'Write')).toBe(true)
    expect(shouldAutoApprove(session, 'Edit')).toBe(true)
    expect(shouldAutoApprove(session, 'Bash')).toBe(false)
    expect(shouldAutoApprove(session, 'Task')).toBe(false)
  })

  it('plan auto-approves read-only tools only', () => {
    const session = createTestSession({ userPermissionMode: 'plan' })
    expect(shouldAutoApprove(session, 'Read')).toBe(true)
    expect(shouldAutoApprove(session, 'Grep')).toBe(true)
    expect(shouldAutoApprove(session, 'Write')).toBe(false)
    expect(shouldAutoApprove(session, 'Edit')).toBe(false)
    expect(shouldAutoApprove(session, 'Bash')).toBe(false)
  })

  it('default mode never auto-approves', () => {
    const session = createTestSession({ userPermissionMode: 'default' })
    expect(shouldAutoApprove(session, 'Read')).toBe(false)
    expect(shouldAutoApprove(session, 'Write')).toBe(false)
    expect(shouldAutoApprove(session, 'Bash')).toBe(false)
  })
})

describe('server-side auto-approval', () => {
  it('auto-approves Read control_request in bypassPermissions mode', () => {
    const session = createTestSession({ userPermissionMode: 'bypassPermissions' })
    session.stdinWrite = vi.fn()
    const controlHandler = vi.fn()
    const approvedHandler = vi.fn()
    session.emitter.on('control_request', controlHandler)
    session.emitter.on('tool_approved', approvedHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'Read', input: { file_path: '/test' }, requestId: 'r-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Read', toolInput: {}, toolUseId: 'r-1' })

    // control_request should NOT be forwarded to client
    expect(controlHandler).not.toHaveBeenCalled()
    // stdinWrite should have been called with auto-approval
    expect(session.stdinWrite).toHaveBeenCalledOnce()
    const sent = JSON.parse((session.stdinWrite as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(sent.response.response.behavior).toBe('allow')
    // tool_approved event should be emitted
    expect(approvedHandler).toHaveBeenCalledWith({ toolUseId: 'r-1' })
    // No buffering should be started
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('auto-approves AskUserQuestion in bypassPermissions mode', () => {
    const session = createTestSession({ userPermissionMode: 'bypassPermissions' })
    session.stdinWrite = vi.fn()
    const controlHandler = vi.fn()
    const approvedHandler = vi.fn()
    session.emitter.on('control_request', controlHandler)
    session.emitter.on('tool_approved', approvedHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'AskUserQuestion', toolInput: {}, toolUseId: 'ask-1' })

    // control_request should NOT be forwarded (auto-approved in Full Auto)
    expect(controlHandler).not.toHaveBeenCalled()
    // stdinWrite should have been called with auto-approval
    expect(session.stdinWrite).toHaveBeenCalledOnce()
    expect(approvedHandler).toHaveBeenCalledWith({ toolUseId: 'ask-1' })
    // No buffering in bypassPermissions mode for AskUserQuestion
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('does NOT auto-approve AskUserQuestion in acceptEdits mode', () => {
    const session = createTestSession({ userPermissionMode: 'acceptEdits' })
    session.stdinWrite = vi.fn()
    const controlHandler = vi.fn()
    session.emitter.on('control_request', controlHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'AskUserQuestion', toolInput: {}, toolUseId: 'ask-1' })

    // control_request SHOULD be forwarded (needs user input)
    expect(controlHandler).toHaveBeenCalled()
    expect(session.stdinWrite).not.toHaveBeenCalled()
  })

  it('auto-approves file tools in acceptEdits mode but not Bash', () => {
    const session = createTestSession({ userPermissionMode: 'acceptEdits' })
    session.stdinWrite = vi.fn()
    const controlHandler = vi.fn()
    const approvedHandler = vi.fn()
    session.emitter.on('control_request', controlHandler)
    session.emitter.on('tool_approved', approvedHandler)

    // Write — should auto-approve
    emitSDKMessage(session, { type: 'tool_use', tool: 'Write', input: {}, requestId: 'w-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Write', toolInput: {}, toolUseId: 'w-1' })
    expect(controlHandler).not.toHaveBeenCalled()
    expect(approvedHandler).toHaveBeenCalledWith({ toolUseId: 'w-1' })

    approvedHandler.mockClear()

    // Bash — should NOT auto-approve
    emitSDKMessage(session, { type: 'tool_use', tool: 'Bash', input: {}, requestId: 'b-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-2', toolName: 'Bash', toolInput: {}, toolUseId: 'b-1' })
    expect(controlHandler).toHaveBeenCalled()
    expect(approvedHandler).not.toHaveBeenCalled()
  })

  it('auto-approves control_request during buffering without adding a second buffer', () => {
    // Use acceptEdits mode so AskUserQuestion triggers buffering
    // (bypassPermissions auto-approves AskUserQuestion, skipping buffering entirely)
    const session = createTestSession({ userPermissionMode: 'acceptEdits' })
    session.stdinWrite = vi.fn()

    // Start buffering with AskUserQuestion
    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    expect(session.pendingQuestionBuffer).toEqual([])

    // control_request for a Read tool arrives during buffering — auto-approve it
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Read', toolInput: {}, toolUseId: 'r-1' })

    // Should have auto-approved via stdinWrite (Read is auto-approved in acceptEdits)
    expect(session.stdinWrite).toHaveBeenCalledOnce()
    // Buffer should still be active (not flushed)
    expect(session.pendingQuestionBuffer).toEqual([])
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

  it('control_request for AskUserQuestion passes through during buffering', () => {
    const session = createTestSession()
    const controlHandler = vi.fn()
    session.emitter.on('control_request', controlHandler)

    // Start buffering
    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })

    // control_request for AskUserQuestion should pass through (never auto-approved)
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

  it('ExitPlanMode tool_use starts buffering', () => {
    const session = createTestSession()
    const toolHandler = vi.fn()
    session.emitter.on('tool_use', toolHandler)

    emitSDKMessage(session, {
      type: 'tool_use',
      tool: 'ExitPlanMode',
      input: {},
      requestId: 'exit-1',
    })

    expect(toolHandler).toHaveBeenCalled()
    expect(session.pendingQuestionBuffer).toEqual([])
  })

  it('ExitPlanMode does NOT start buffering in bypassPermissions mode', () => {
    const session = createTestSession({ userPermissionMode: 'bypassPermissions' })
    emitSDKMessage(session, { type: 'tool_use', tool: 'ExitPlanMode', input: {}, requestId: 'exit-1' })
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('non-blocking tool_use does NOT start buffering', () => {
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

describe('control_request buffering for regular tools', () => {
  it('control_request starts buffering for non-auto-approved tools', () => {
    const session = createTestSession({ userPermissionMode: 'default' })
    const controlHandler = vi.fn()
    session.emitter.on('control_request', controlHandler)

    // tool_use alone does NOT start buffering
    emitSDKMessage(session, { type: 'tool_use', tool: 'Read', input: { file_path: '/test' }, requestId: 'r-1' })
    expect(session.pendingQuestionBuffer).toBeNull()

    // control_request starts buffering (in default mode, Read needs approval)
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Read', toolInput: { file_path: '/test' }, toolUseId: 'r-1' })
    expect(controlHandler).toHaveBeenCalled()
    expect(session.pendingQuestionBuffer).toEqual([])
  })

  it('buffers text_delta after control_request for regular tools', () => {
    const session = createTestSession({ userPermissionMode: 'default' })
    const deltaHandler = vi.fn()
    session.emitter.on('stream_delta', deltaHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'Bash', input: { command: 'ls' }, requestId: 'b-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 'b-1' })

    // Text after control_request should be buffered
    emitSDKMessage(session, { type: 'text_delta', text: 'should not show yet' })
    expect(deltaHandler).not.toHaveBeenCalled()
    expect(session.pendingQuestionBuffer).toHaveLength(1)
  })

  it('flushes buffer when user approves regular tool', () => {
    const session = createTestSession({ userPermissionMode: 'default' })
    session.stdinWrite = vi.fn()
    const deltaHandler = vi.fn()
    session.emitter.on('stream_delta', deltaHandler)

    emitSDKMessage(session, { type: 'tool_use', tool: 'Bash', input: { command: 'ls' }, requestId: 'b-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Bash', toolInput: {}, toolUseId: 'b-1' })
    emitSDKMessage(session, { type: 'text_delta', text: 'buffered text' })

    expect(deltaHandler).not.toHaveBeenCalled()

    respondToPermission(session, 'ctrl-1', true)

    expect(deltaHandler).toHaveBeenCalledWith({ text: 'buffered text' })
    expect(session.pendingQuestionBuffer).toBeNull()
  })

  it('result during buffering flushes buffer then emits stream_end', () => {
    const session = createTestSession({ userPermissionMode: 'default' })
    const events: { event: string; data: unknown }[] = []
    session.emitter.on('stream_delta', (d) => events.push({ event: 'stream_delta', data: d }))
    session.emitter.on('stream_end', (d) => events.push({ event: 'stream_end', data: d }))

    emitSDKMessage(session, { type: 'tool_use', tool: 'Bash', input: {}, requestId: 'b-1' })
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Bash', toolInput: {}, toolUseId: 'b-1' })
    emitSDKMessage(session, { type: 'text_delta', text: 'buffered' })

    expect(events).toHaveLength(0)

    // result forces flush + stream_end
    emitSDKMessage(session, { type: 'result', sessionId: 'ses-1', exitCode: 0 })

    expect(events).toHaveLength(2)
    expect(events[0]!.event).toBe('stream_delta')
    expect(events[1]!.event).toBe('stream_end')
    expect(session.pendingQuestionBuffer).toBeNull()
  })
})

describe('full AskUserQuestion lifecycle', () => {
  it('buffers text, allows control_request through, flushes on response (non-bypass mode)', () => {
    // Use acceptEdits — AskUserQuestion requires user input in non-bypass modes
    const session = createTestSession({ userPermissionMode: 'acceptEdits' })
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

    // 4. control_request for AskUserQuestion — passes through (needs user input)
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'AskUserQuestion', toolInput: {}, toolUseId: 'ask-1' })
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

  it('auto-approves AskUserQuestion in bypassPermissions (Full Auto) mode — no buffering', () => {
    const session = createTestSession({ userPermissionMode: 'bypassPermissions' })
    session.stdinWrite = vi.fn()

    const events: { event: string; data: unknown }[] = []
    session.emitter.on('tool_use', (d) => events.push({ event: 'tool_use', data: d }))
    session.emitter.on('stream_delta', (d) => events.push({ event: 'stream_delta', data: d }))
    session.emitter.on('control_request', (d) => events.push({ event: 'control_request', data: d }))
    session.emitter.on('tool_approved', (d) => events.push({ event: 'tool_approved', data: d }))

    // 1. AskUserQuestion tool_use — emits, no buffering in bypass mode
    emitSDKMessage(session, { type: 'tool_use', tool: 'AskUserQuestion', input: {}, requestId: 'ask-1' })
    expect(events).toHaveLength(1)
    expect(session.pendingQuestionBuffer).toBeNull() // No buffering!

    // 2. control_request — auto-approved, not forwarded
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'AskUserQuestion', toolInput: {}, toolUseId: 'ask-1' })
    expect(session.stdinWrite).toHaveBeenCalledOnce()
    // tool_approved event emitted instead of control_request
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({ event: 'tool_approved', data: { toolUseId: 'ask-1' } })

    // 3. Text flows through immediately — no buffering
    emitSDKMessage(session, { type: 'text_delta', text: 'Continuing...' })
    expect(events).toHaveLength(3)
    expect(events[2]).toEqual({ event: 'stream_delta', data: { text: 'Continuing...' } })
  })
})

describe('full regular tool permission lifecycle', () => {
  it('text before tool emits, text after control_request buffers, flush on approval', () => {
    const session = createTestSession({ userPermissionMode: 'default' })
    session.stdinWrite = vi.fn()

    const events: { event: string; data: unknown }[] = []
    session.emitter.on('tool_use', (d) => events.push({ event: 'tool_use', data: d }))
    session.emitter.on('stream_delta', (d) => events.push({ event: 'stream_delta', data: d }))
    session.emitter.on('control_request', (d) => events.push({ event: 'control_request', data: d }))

    // 1. Text before tool — emits immediately
    emitSDKMessage(session, { type: 'text_delta', text: 'Let me read the file.' })
    expect(events).toHaveLength(1)

    // 2. tool_use — emits (no buffering yet for non-AskUserQuestion)
    emitSDKMessage(session, { type: 'tool_use', tool: 'Read', input: { file_path: '/test' }, requestId: 'r-1' })
    expect(events).toHaveLength(2)
    expect(session.pendingQuestionBuffer).toBeNull()

    // 3. control_request — emits AND starts buffering (in default mode, Read needs approval)
    emitSDKMessage(session, { type: 'control_request', requestId: 'ctrl-1', toolName: 'Read', toolInput: { file_path: '/test' }, toolUseId: 'r-1' })
    expect(events).toHaveLength(3)
    expect(session.pendingQuestionBuffer).toEqual([])

    // 4. Text arrives WHILE waiting for Allow/Deny — gets buffered
    emitSDKMessage(session, { type: 'text_delta', text: 'The file contains...' })
    expect(events).toHaveLength(3) // Still 3! Text was buffered
    expect(session.pendingQuestionBuffer).toHaveLength(1)

    // 5. User clicks Allow — flush
    respondToPermission(session, 'ctrl-1', true)
    expect(events).toHaveLength(4) // Buffered text now emitted
    expect(events[3]).toEqual({ event: 'stream_delta', data: { text: 'The file contains...' } })
    expect(session.pendingQuestionBuffer).toBeNull()
  })
})
