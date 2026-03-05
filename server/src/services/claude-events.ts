/**
 * Claude Code SDK — Event processing (pure functions).
 *
 * Transforms raw CLI stream-json events into typed SDKMessage objects.
 */

import type { BlockState, SDKMessage } from './claude-types.js';
import { decodeUnicodeEscapes, debugLog } from './claude-utils.js';

// ─── Event processing ────────────────────────────────────────────────────────

export function processEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
  // Log every raw event type (except noisy stream_event internals)
  if (event.type !== 'stream_event') {
    debugLog(`[ClaudeSDK] event: type="${event.type}", keys=[${Object.keys(event).join(',')}]${event.parent_tool_use_id ? `, ptui="${event.parent_tool_use_id}"` : ''}`);
  }

  if (event.type === 'control_request') {
    const request = event.request as Record<string, unknown> | undefined;
    if (request?.subtype === 'can_use_tool') {
      debugLog(`[ClaudeSDK] control_request: tool="${request.tool_name}", request_id="${event.request_id}"`);
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
    // Track which agent (parent vs sub-agent) owns the current stream events
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
    // Log registered agents for debugging --agents flag
    if (event.agents) {
      debugLog(`[ClaudeSDK] Registered agents: [${(event.agents as string[]).join(', ')}]`);
    }
    return [{ type: 'system', sessionId: event.session_id as string | undefined }];
  }

  if (event.type === 'assistant') {
    const parentToolUseId = (event.parent_tool_use_id as string | null) ?? null;
    // Sub-agent messages come as complete `assistant` messages (not stream_events).
    // Extract tool calls and text from them.
    if (parentToolUseId) {
      const messages: SDKMessage[] = [];
      const message = event.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            const toolId = (block.id as string) || '';
            // Deduplicate: --include-partial-messages can re-emit assistant messages
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
    return []; // root assistant messages already handled via streaming
  }

  // Detect sub-agent completion via user messages (tool_result in message.content)
  if (event.type === 'user') {
    debugLog(`[ClaudeSDK] user event: keys=[${Object.keys(event).join(',')}]`);
    const msg = event.message as Record<string, unknown> | undefined;
    const msgContent = msg?.content as Record<string, unknown>[] | undefined;

    // Strategy 1: Check top-level tool_use_result (some CLI versions)
    const toolUseResult = event.tool_use_result as Record<string, unknown> | undefined;
    if (toolUseResult) {
      debugLog(`[ClaudeSDK] user event has tool_use_result: status="${toolUseResult.status}", keys=[${Object.keys(toolUseResult).join(',')}]`);
    }

    // Strategy 2: Check message.content for tool_result blocks (standard CLI format)
    let toolUseId = '';
    let resultText = '';
    let found = false;

    if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if (block.type === 'tool_result') {
          toolUseId = (block.tool_use_id as string) || '';
          // Extract text from content (can be string, array of text blocks, or undefined)
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

    // Also try top-level tool_use_result content if message.content didn't have it
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
      // Find toolUseId from message content
      if (Array.isArray(msgContent)) {
        const toolResult = msgContent.find((c) => c.type === 'tool_result');
        if (toolResult) toolUseId = (toolResult.tool_use_id as string) || '';
      }
      found = true;
    }

    if (found && toolUseId) {
      debugLog(`[ClaudeSDK] subagent_result detected: toolUseId="${toolUseId}", resultLen=${resultText.length}`);
      return [{
        type: 'subagent_result',
        toolUseId,
        status: 'completed',
        content: resultText,
        agentId: toolUseResult?.agentId as string | undefined,
      }];
    } else if (found) {
      debugLog(`[ClaudeSDK] WARN: user event has tool_result but no tool_use_id!`);
    }
  }

  return [];
}

export function processStreamEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
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
      // Deduplicate: --include-partial-messages can re-emit the same tool_use block
      if (toolId && state.emittedToolUseIds.has(toolId)) {
        return messages; // already emitted this tool_use
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
      } catch (e) {
        debugLog(`[ClaudeSDK] WARN: Failed to parse tool input JSON (tool=${state.currentToolName}, len=${state.currentToolInputJson.length}): ${e}`);
      }
      debugLog(`[ClaudeSDK] tool_input_complete: tool="${state.currentToolName}", requestId="${state.currentToolId}", inputKeys=[${Object.keys(parsedInput).join(',')}], ptui=${ptui}`);
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
