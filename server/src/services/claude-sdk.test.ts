import { describe, it, expect } from 'vitest';

/**
 * Tests for pure functions from claude-sdk.ts.
 * Re-implemented to avoid importing the module (heavy side effects: child_process, fs).
 */

// ─── Re-implemented: decodeUnicodeEscapes ───────────────────────────────

function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

// ─── Re-implemented: processEvent + processStreamEvent (core event parsing) ──

interface BlockState {
  currentBlockType: string | null;
  currentToolId: string | null;
  currentToolName: string | null;
  currentToolInputJson: string;
  currentParentToolUseId: string | null;
  hasEmittedText: boolean;
  claudeSessionId: string | null;
  emittedToolUseIds: Set<string>;
}

function createBlockState(): BlockState {
  return {
    currentBlockType: null,
    currentToolId: null,
    currentToolName: null,
    currentToolInputJson: '',
    currentParentToolUseId: null,
    hasEmittedText: false,
    claudeSessionId: null,
    emittedToolUseIds: new Set(),
  };
}

interface SDKMessage {
  type: string;
  [key: string]: unknown;
}

function processStreamEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
  const messages: SDKMessage[] = [];
  const ptui = state.currentParentToolUseId;

  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (!block) return messages;

    if (block.type === 'thinking') {
      state.currentBlockType = 'thinking';
      messages.push({ type: 'thinking_start', parentToolUseId: ptui });
    } else if (block.type === 'tool_use') {
      const toolId = (block.id as string) || '';
      state.currentBlockType = 'tool_use';
      state.currentToolId = toolId || null;
      state.currentToolName = (block.name as string) || null;
      state.currentToolInputJson = '';
      if (toolId && state.emittedToolUseIds.has(toolId)) {
        return messages;
      }
      if (toolId) state.emittedToolUseIds.add(toolId);
      messages.push({
        type: 'tool_use',
        tool: (block.name as string) || '',
        requestId: toolId,
        input: (block.input as Record<string, unknown>) || {},
        parentToolUseId: ptui,
      });
    } else if (block.type === 'text') {
      state.currentBlockType = 'text';
    }
    return messages;
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (!delta) return messages;

    if (delta.type === 'thinking_delta' && delta.thinking) {
      messages.push({ type: 'thinking_delta', text: decodeUnicodeEscapes(delta.thinking as string), parentToolUseId: ptui });
    } else if (delta.type === 'text_delta' && delta.text) {
      state.hasEmittedText = true;
      messages.push({ type: 'text_delta', text: decodeUnicodeEscapes(delta.text as string), parentToolUseId: ptui });
    } else if (delta.type === 'input_json_delta' && delta.partial_json) {
      state.currentToolInputJson += delta.partial_json as string;
      messages.push({
        type: 'tool_input_delta',
        requestId: state.currentToolId,
        tool: state.currentToolName,
        partialJson: delta.partial_json as string,
        accumulatedJson: state.currentToolInputJson,
        parentToolUseId: ptui,
      });
    }
    return messages;
  }

  if (event.type === 'content_block_stop') {
    if (state.currentBlockType === 'thinking') {
      messages.push({ type: 'thinking_end', parentToolUseId: ptui });
    }
    if (state.currentBlockType === 'tool_use') {
      let parsedInput: Record<string, unknown> = {};
      try {
        if (state.currentToolInputJson) parsedInput = JSON.parse(state.currentToolInputJson);
      } catch { /* ignore */ }
      messages.push({
        type: 'tool_input_complete',
        requestId: state.currentToolId,
        tool: state.currentToolName,
        input: parsedInput,
        parentToolUseId: ptui,
      });
      state.currentToolInputJson = '';
    }
    state.currentBlockType = null;
    return messages;
  }

  if (event.type === 'message_start') {
    const message = event.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (usage) {
      messages.push({
        type: 'message_start',
        inputTokens: usage.input_tokens as number | undefined,
        cacheCreationInputTokens: usage.cache_creation_input_tokens as number | undefined,
        cacheReadInputTokens: usage.cache_read_input_tokens as number | undefined,
        parentToolUseId: ptui,
      });
    }
    return messages;
  }

  if (event.type === 'message_delta') {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      messages.push({ type: 'message_delta', outputTokens: usage.output_tokens as number | undefined, parentToolUseId: ptui });
    }
    return messages;
  }

  return messages;
}

function processEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
  if (event.type === 'control_request') {
    const request = event.request as Record<string, unknown> | undefined;
    if (request?.subtype === 'can_use_tool') {
      return [{
        type: 'control_request',
        requestId: event.request_id as string,
        toolName: request.tool_name as string,
        toolInput: (request.input as Record<string, unknown>) || {},
        toolUseId: request.tool_use_id as string | undefined,
      }];
    }
    return [];
  }

  if (event.type === 'stream_event') {
    const inner = event.event as Record<string, unknown> | undefined;
    if (!inner) return [];
    const parentToolUseId = (event.parent_tool_use_id as string | null) ?? null;
    state.currentParentToolUseId = parentToolUseId;
    return processStreamEvent(state, inner);
  }

  if (event.type === 'result') {
    if (event.session_id) state.claudeSessionId = event.session_id as string;
    return [];
  }

  if (event.type === 'system') {
    if (event.session_id) state.claudeSessionId = event.session_id as string;
    return [{ type: 'system', sessionId: event.session_id as string | undefined }];
  }

  if (event.type === 'assistant') {
    const parentToolUseId = (event.parent_tool_use_id as string | null) ?? null;
    if (parentToolUseId) {
      const messages: SDKMessage[] = [];
      const message = event.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            const toolId = (block.id as string) || '';
            if (toolId && state.emittedToolUseIds.has(toolId)) continue;
            if (toolId) state.emittedToolUseIds.add(toolId);
            messages.push({
              type: 'tool_use',
              tool: (block.name as string) || '',
              requestId: toolId,
              input: (block.input as Record<string, unknown>) || {},
              parentToolUseId,
            });
          } else if (block.type === 'text' && block.text) {
            messages.push({
              type: 'text_delta',
              text: decodeUnicodeEscapes(block.text as string),
              parentToolUseId,
            });
          }
        }
      }
      return messages;
    }
    return [];
  }

  if (event.type === 'user') {
    const msg = event.message as Record<string, unknown> | undefined;
    const msgContent = msg?.content as Record<string, unknown>[] | undefined;
    const toolUseResult = event.tool_use_result as Record<string, unknown> | undefined;

    let toolUseId = '';
    let resultText = '';
    let found = false;

    if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if (block.type === 'tool_result') {
          toolUseId = (block.tool_use_id as string) || '';
          const blockContent = block.content;
          if (typeof blockContent === 'string') {
            resultText = blockContent;
          } else if (Array.isArray(blockContent)) {
            resultText = (blockContent as Record<string, unknown>[])
              .filter(c => c.type === 'text')
              .map(c => c.text as string)
              .join('\n');
          }
          found = true;
          break;
        }
      }
    }

    if (!found && toolUseResult && toolUseResult.status === 'completed') {
      const content = toolUseResult.content;
      if (Array.isArray(content)) {
        resultText = (content as Record<string, unknown>[])
          .filter(c => typeof c === 'object' && c !== null && c.type === 'text')
          .map(c => c.text as string)
          .join('\n');
      } else if (typeof content === 'string') {
        resultText = content;
      }
      if (Array.isArray(msgContent)) {
        const toolResult = msgContent.find((c) => c.type === 'tool_result');
        if (toolResult) toolUseId = (toolResult.tool_use_id as string) || '';
      }
      found = true;
    }

    if (found && toolUseId) {
      return [{
        type: 'subagent_result',
        toolUseId,
        status: 'completed',
        content: resultText,
        agentId: toolUseResult?.agentId as string | undefined,
      }];
    }
  }

  return [];
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('decodeUnicodeEscapes', () => {
  it('decodes basic latin unicode escapes', () => {
    expect(decodeUnicodeEscapes('\\u0048\\u0065\\u006C\\u006C\\u006F')).toBe('Hello');
  });

  it('decodes accented characters', () => {
    expect(decodeUnicodeEscapes('caf\\u00e9')).toBe('café');
    expect(decodeUnicodeEscapes('\\u00ed')).toBe('í');
  });

  it('preserves text without escapes', () => {
    expect(decodeUnicodeEscapes('hello world')).toBe('hello world');
  });

  it('preserves already-decoded unicode (real chars, not escapes)', () => {
    expect(decodeUnicodeEscapes('café')).toBe('café');
  });

  it('handles mixed escaped and unescaped text', () => {
    expect(decodeUnicodeEscapes('hello \\u0077orld')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(decodeUnicodeEscapes('')).toBe('');
  });

  it('handles CJK characters', () => {
    // 你 = \u4F60
    expect(decodeUnicodeEscapes('\\u4F60\\u597D')).toBe('你好');
  });

  it('handles uppercase hex digits', () => {
    expect(decodeUnicodeEscapes('\\u004A')).toBe('J');
  });

  it('does NOT decode partial escapes (less than 4 hex digits)', () => {
    expect(decodeUnicodeEscapes('\\u00')).toBe('\\u00');
    expect(decodeUnicodeEscapes('\\u0')).toBe('\\u0');
  });

  it('does NOT decode invalid hex chars', () => {
    expect(decodeUnicodeEscapes('\\uZZZZ')).toBe('\\uZZZZ');
    expect(decodeUnicodeEscapes('\\uGGGG')).toBe('\\uGGGG');
  });
});

describe('processEvent — control_request', () => {
  it('parses can_use_tool control requests', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'control_request',
      request_id: 'req-123',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
        tool_use_id: 'tu-456',
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'control_request',
      requestId: 'req-123',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-456',
    });
  });

  it('returns empty for unknown control request subtypes', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'control_request',
      request: { subtype: 'unknown_subtype' },
    });
    expect(result).toEqual([]);
  });
});

describe('processEvent — stream_event routing', () => {
  it('routes stream events to processStreamEvent', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_start',
        content_block: { type: 'text' },
      },
    });
    // text block start doesn't emit messages, but sets state
    expect(result).toEqual([]);
    expect(state.currentBlockType).toBe('text');
  });

  it('tracks parent_tool_use_id for sub-agent events', () => {
    const state = createBlockState();
    processEvent(state, {
      type: 'stream_event',
      parent_tool_use_id: 'ptui-789',
      event: {
        type: 'content_block_start',
        content_block: { type: 'thinking' },
      },
    });
    expect(state.currentParentToolUseId).toBe('ptui-789');
  });

  it('returns empty when inner event is missing', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'stream_event',
      event: undefined,
    });
    expect(result).toEqual([]);
  });
});

describe('processEvent — result & system', () => {
  it('captures session_id from result event', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'result',
      session_id: 'sess-abc',
    });
    expect(result).toEqual([]);
    expect(state.claudeSessionId).toBe('sess-abc');
  });

  it('emits system message with session_id', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'system',
      session_id: 'sess-xyz',
    });
    expect(result).toEqual([{ type: 'system', sessionId: 'sess-xyz' }]);
    expect(state.claudeSessionId).toBe('sess-xyz');
  });
});

describe('processEvent — assistant (sub-agent messages)', () => {
  it('extracts tool_use blocks from sub-agent assistant messages', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'assistant',
      parent_tool_use_id: 'ptui-1',
      message: {
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/test' } },
        ],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'tool_use',
      tool: 'Read',
      requestId: 'tu-1',
      parentToolUseId: 'ptui-1',
    });
  });

  it('extracts text blocks from sub-agent assistant messages', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'assistant',
      parent_tool_use_id: 'ptui-1',
      message: {
        content: [{ type: 'text', text: 'Hello from sub-agent' }],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'text_delta',
      text: 'Hello from sub-agent',
      parentToolUseId: 'ptui-1',
    });
  });

  it('deduplicates tool_use by id', () => {
    const state = createBlockState();
    // First time: emitted
    processEvent(state, {
      type: 'assistant',
      parent_tool_use_id: 'ptui-1',
      message: { content: [{ type: 'tool_use', id: 'tu-dup', name: 'Bash', input: {} }] },
    });
    // Second time: deduped
    const result = processEvent(state, {
      type: 'assistant',
      parent_tool_use_id: 'ptui-1',
      message: { content: [{ type: 'tool_use', id: 'tu-dup', name: 'Bash', input: {} }] },
    });
    expect(result).toEqual([]); // deduped
  });

  it('ignores root assistant messages (no parent_tool_use_id)', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'root msg' }] },
    });
    expect(result).toEqual([]);
  });

  it('decodes unicode escapes in sub-agent text', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'assistant',
      parent_tool_use_id: 'ptui-1',
      message: { content: [{ type: 'text', text: 'caf\\u00e9' }] },
    });
    expect(result[0]!.text).toBe('café');
  });
});

describe('processEvent — user (subagent_result detection)', () => {
  it('detects subagent result from tool_result in message content', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu-999', content: 'Task completed successfully' },
        ],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'subagent_result',
      toolUseId: 'tu-999',
      status: 'completed',
      content: 'Task completed successfully',
    });
  });

  it('extracts text from array content in tool_result', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-100',
            content: [
              { type: 'text', text: 'Line 1' },
              { type: 'text', text: 'Line 2' },
            ],
          },
        ],
      },
    });
    expect(result[0]!.content).toBe('Line 1\nLine 2');
  });

  it('falls back to tool_use_result for older CLI format', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-200' }],
      },
      tool_use_result: {
        status: 'completed',
        content: 'Fallback result text',
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.toolUseId).toBe('tu-200');
  });

  it('returns empty for user events without tool_result', () => {
    const state = createBlockState();
    const result = processEvent(state, {
      type: 'user',
      message: { content: [{ type: 'text', text: 'just a user message' }] },
    });
    expect(result).toEqual([]);
  });
});

describe('processStreamEvent — thinking lifecycle', () => {
  it('emits thinking_start on content_block_start with type=thinking', () => {
    const state = createBlockState();
    const result = processStreamEvent(state, {
      type: 'content_block_start',
      content_block: { type: 'thinking' },
    });
    expect(result).toEqual([{ type: 'thinking_start', parentToolUseId: null }]);
    expect(state.currentBlockType).toBe('thinking');
  });

  it('emits thinking_delta with decoded text', () => {
    const state = createBlockState();
    state.currentBlockType = 'thinking';
    const result = processStreamEvent(state, {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'Let me think about caf\\u00e9...' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Let me think about café...');
  });

  it('emits thinking_end on content_block_stop when in thinking block', () => {
    const state = createBlockState();
    state.currentBlockType = 'thinking';
    const result = processStreamEvent(state, { type: 'content_block_stop' });
    expect(result).toEqual([{ type: 'thinking_end', parentToolUseId: null }]);
    expect(state.currentBlockType).toBeNull();
  });
});

describe('processStreamEvent — text streaming', () => {
  it('emits text_delta with decoded unicode', () => {
    const state = createBlockState();
    state.currentBlockType = 'text';
    const result = processStreamEvent(state, {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello \\u0077orld' },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Hello world');
    expect(state.hasEmittedText).toBe(true);
  });
});

describe('processStreamEvent — tool_use lifecycle', () => {
  it('emits tool_use on content_block_start with tool info', () => {
    const state = createBlockState();
    const result = processStreamEvent(state, {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu-1', name: 'Write', input: {} },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'tool_use',
      tool: 'Write',
      requestId: 'tu-1',
    });
    expect(state.currentToolId).toBe('tu-1');
    expect(state.currentToolName).toBe('Write');
  });

  it('accumulates partial JSON input via tool_input_delta', () => {
    const state = createBlockState();
    state.currentBlockType = 'tool_use';
    state.currentToolId = 'tu-1';
    state.currentToolName = 'Write';

    const r1 = processStreamEvent(state, {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"file' },
    });
    expect(r1[0]!.partialJson).toBe('{"file');
    expect(r1[0]!.accumulatedJson).toBe('{"file');

    const r2 = processStreamEvent(state, {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '":"test.ts"}' },
    });
    expect(r2[0]!.accumulatedJson).toBe('{"file":"test.ts"}');
  });

  it('emits tool_input_complete with parsed JSON on content_block_stop', () => {
    const state = createBlockState();
    state.currentBlockType = 'tool_use';
    state.currentToolId = 'tu-1';
    state.currentToolName = 'Write';
    state.currentToolInputJson = '{"file":"test.ts","content":"hello"}';

    const result = processStreamEvent(state, { type: 'content_block_stop' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'tool_input_complete',
      requestId: 'tu-1',
      tool: 'Write',
      input: { file: 'test.ts', content: 'hello' },
    });
    expect(state.currentToolInputJson).toBe('');
  });

  it('handles malformed JSON input gracefully', () => {
    const state = createBlockState();
    state.currentBlockType = 'tool_use';
    state.currentToolId = 'tu-1';
    state.currentToolName = 'Write';
    state.currentToolInputJson = '{"broken":';

    const result = processStreamEvent(state, { type: 'content_block_stop' });
    expect(result).toHaveLength(1);
    expect(result[0]!.input).toEqual({}); // fallback to empty
  });

  it('deduplicates tool_use by id in stream events', () => {
    const state = createBlockState();

    // First emission
    processStreamEvent(state, {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu-dup', name: 'Bash', input: {} },
    });

    // Second emission (--include-partial-messages re-emit)
    const result = processStreamEvent(state, {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu-dup', name: 'Bash', input: {} },
    });
    expect(result).toEqual([]); // deduped
  });
});

describe('processStreamEvent — message_start/delta (usage)', () => {
  it('emits message_start with token counts', () => {
    const state = createBlockState();
    const result = processStreamEvent(state, {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 1500,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 100,
        },
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'message_start',
      inputTokens: 1500,
      cacheCreationInputTokens: 200,
      cacheReadInputTokens: 100,
    });
  });

  it('emits message_delta with output tokens', () => {
    const state = createBlockState();
    const result = processStreamEvent(state, {
      type: 'message_delta',
      usage: { output_tokens: 500 },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'message_delta',
      outputTokens: 500,
    });
  });

  it('returns empty for message_start without usage', () => {
    const state = createBlockState();
    const result = processStreamEvent(state, {
      type: 'message_start',
      message: {},
    });
    expect(result).toEqual([]);
  });
});

describe('processStreamEvent — parentToolUseId propagation', () => {
  it('includes parentToolUseId in all emitted messages', () => {
    const state = createBlockState();
    state.currentParentToolUseId = 'ptui-subagent';

    // text delta
    state.currentBlockType = 'text';
    const textResult = processStreamEvent(state, {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'hello' },
    });
    expect(textResult[0]!.parentToolUseId).toBe('ptui-subagent');

    // thinking start
    const thinkResult = processStreamEvent(state, {
      type: 'content_block_start',
      content_block: { type: 'thinking' },
    });
    expect(thinkResult[0]!.parentToolUseId).toBe('ptui-subagent');

    // message_delta
    const deltaResult = processStreamEvent(state, {
      type: 'message_delta',
      usage: { output_tokens: 10 },
    });
    expect(deltaResult[0]!.parentToolUseId).toBe('ptui-subagent');
  });
});

describe('full streaming lifecycle', () => {
  it('processes a complete tool use cycle: start → deltas → stop', () => {
    const state = createBlockState();

    // 1. Tool use starts
    const start = processStreamEvent(state, {
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu-lifecycle', name: 'Edit', input: {} },
    });
    expect(start[0]!.type).toBe('tool_use');
    expect(start[0]!.tool).toBe('Edit');

    // 2. JSON input arrives in chunks
    processStreamEvent(state, {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"old_string":"foo"' },
    });
    processStreamEvent(state, {
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: ',"new_string":"bar"}' },
    });

    // 3. Block stops — should emit complete with parsed input
    const stop = processStreamEvent(state, { type: 'content_block_stop' });
    expect(stop[0]!.type).toBe('tool_input_complete');
    expect(stop[0]!.input).toEqual({ old_string: 'foo', new_string: 'bar' });
  });
});
