import { ref, watch, onUnmounted } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import { useSettingsStore } from '@/stores/settings';
import { useProviderStore } from '@/stores/provider';
import { useDiagramsStore } from '@/stores/diagrams';
import { buildDiagramArchitectPrompt } from '@/data/diagram-ai-prompt';
import { calculateLayout } from './useDiagramAILayout';
import { applyDagreLayout } from './useDiagramAutoLayout';
import { uuid } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────

export interface DiagramCommand {
  action: 'newDiagram' | 'addGroup' | 'addService' | 'setParent' | 'addEdge' | 'updateNode';
  params: Record<string, unknown>;
}

export interface AIAttachment {
  type: 'image' | 'html';
  name: string;
  thumbnail?: string; // small dataUrl preview for images
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  commands?: DiagramCommand[];
  applied?: boolean;
  attachment?: AIAttachment;
}

export interface SendPromptAttachments {
  images?: { name: string; dataUrl: string }[];
  htmlContent?: string;
  attachment?: AIAttachment;
}

// ─── Command parser ───────────────────────────────────────────────────

const COMMAND_BLOCK_RE = /```diagram-commands\s*\n([\s\S]*?)```/g;

export function parseCommandBlocks(text: string): DiagramCommand[] {
  const commands: DiagramCommand[] = [];
  let match: RegExpExecArray | null;
  COMMAND_BLOCK_RE.lastIndex = 0;

  while ((match = COMMAND_BLOCK_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1] ?? '');
      if (Array.isArray(parsed)) {
        commands.push(...parsed);
      }
    } catch {
      // Skip malformed blocks
    }
  }
  return commands;
}

// ─── Command executor ─────────────────────────────────────────────────

export function executeDiagramCommands(
  commands: DiagramCommand[],
  diagrams: ReturnType<typeof useDiagramsStore>,
  fitViewFn?: () => void,
): { success: boolean; nodesCreated: number; edgesCreated: number } {
  const refToId = new Map<string, string>();
  let nodesCreated = 0;
  let edgesCreated = 0;

  // ── Deduplication preprocessing ────────────────────────────────────────────
  // The AI model sometimes generates two addGroup commands for the same group
  // (e.g. two "us-east-1" region groups). We collapse duplicates by keeping
  // the first occurrence and remapping all refs that pointed to a duplicate.
  {
    // Step 1: build a parent map from all setParent commands in the raw list
    const preParentMap = new Map<string, string>();
    for (const cmd of commands) {
      if (cmd.action === 'setParent') {
        preParentMap.set(cmd.params.childRef as string, cmd.params.parentRef as string);
      }
    }

    // Step 2: scan addGroup commands and collect duplicates
    const seen = new Map<string, string>(); // key -> canonical refId
    const refRemap = new Map<string, string>(); // dupRef -> canonicalRef
    const skipRefs = new Set<string>();

    for (const cmd of commands) {
      if (cmd.action === 'addGroup') {
        const { refId, groupTypeId, label } = cmd.params as {
          refId: string;
          groupTypeId: string;
          label?: string;
        };
        const parentRef = preParentMap.get(refId) ?? '__root__';
        const key = `${parentRef}:${groupTypeId}:${(label ?? '').toLowerCase().trim()}`;
        if (seen.has(key)) {
          // This is a duplicate — remap its ref to the canonical one
          refRemap.set(refId, seen.get(key)!);
          skipRefs.add(refId);
        } else {
          seen.set(key, refId);
        }
      }
    }

    // Step 3: build normalizedCmds only when there are actual duplicates
    if (refRemap.size > 0) {
      /** Replace any ref value that has been remapped. */
      function remapRef(val: unknown): unknown {
        if (typeof val === 'string' && refRemap.has(val)) return refRemap.get(val)!;
        return val;
      }

      const paramKeys = ['refId', 'childRef', 'parentRef', 'sourceRef', 'targetRef', 'ref'] as const;

      commands = commands
        .filter(cmd => {
          // Drop duplicate addGroup commands
          if (cmd.action === 'addGroup' && skipRefs.has(cmd.params.refId as string)) return false;
          return true;
        })
        .map(cmd => {
          const newParams = { ...cmd.params };
          for (const key of paramKeys) {
            if (key in newParams) {
              (newParams as Record<string, unknown>)[key] = remapRef(newParams[key as keyof typeof newParams]);
            }
          }
          return { ...cmd, params: newParams };
        });
    }
  }
  // ── End deduplication ──────────────────────────────────────────────────────

  // Calculate layout positions (uses the normalised command list)
  const layout = calculateLayout(commands);

  // Build a parentMap from setParent commands so we can compute absolute
  // positions for edge handle direction detection.
  const cmdParentMap = new Map<string, string>();
  for (const cmd of commands) {
    if (cmd.action === 'setParent') {
      cmdParentMap.set(cmd.params.childRef as string, cmd.params.parentRef as string);
    }
  }

  /** Accumulate layout positions up the parent chain to get an absolute position. */
  function absLayoutPos(refId: string): { x: number; y: number } {
    const pos = { ...(layout.get(refId)?.position ?? { x: 0, y: 0 }) };
    let cur = refId;
    while (cmdParentMap.has(cur)) {
      cur = cmdParentMap.get(cur)!;
      const p = layout.get(cur)?.position ?? { x: 0, y: 0 };
      pos.x += p.x;
      pos.y += p.y;
    }
    return pos;
  }

  /**
   * Choose source/target handle IDs based on the relative positions of the two
   * nodes so that edges route horizontally (right→left) when nodes are side by
   * side and vertically (bottom→top) when stacked.
   */
  function chooseHandles(sourceRef: string, targetRef: string): { sourceHandle: string; targetHandle: string } {
    const src = absLayoutPos(sourceRef);
    const tgt = absLayoutPos(targetRef);
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // Horizontal flow
      return dx >= 0
        ? { sourceHandle: 'right', targetHandle: 'left' }
        : { sourceHandle: 'left', targetHandle: 'right' };
    }
    // Vertical flow
    return dy >= 0
      ? { sourceHandle: 'bottom', targetHandle: 'top' }
      : { sourceHandle: 'top', targetHandle: 'bottom' };
  }

  for (const cmd of commands) {
    try {
      switch (cmd.action) {
        case 'newDiagram': {
          diagrams.newDiagram();
          break;
        }

        case 'addGroup': {
          const { refId, groupTypeId, label } = cmd.params as {
            refId: string;
            groupTypeId: string;
            label?: string;
          };

          const layoutInfo = layout.get(refId);
          const position = layoutInfo?.position ?? { x: 100, y: 100 };

          const nodeId = diagrams.addGroupNode(groupTypeId, position);
          if (nodeId) {
            refToId.set(refId, nodeId);
            nodesCreated++;

            // Apply size from layout
            if (layoutInfo?.size) {
              const node = diagrams.nodes.find(n => n.id === nodeId);
              if (node) {
                node.style = {
                  ...(node.style as Record<string, string> || {}),
                  width: `${layoutInfo.size.width}px`,
                  height: `${layoutInfo.size.height}px`,
                };
              }
            }

            // Apply custom label
            if (label) {
              diagrams.updateNodeData(nodeId, { customLabel: label });
            }
          }
          break;
        }

        case 'addService': {
          const { refId, serviceId, label } = cmd.params as {
            refId: string;
            serviceId: string;
            label?: string;
          };

          const layoutInfo = layout.get(refId);
          const position = layoutInfo?.position ?? { x: 200, y: 200 };

          const nodeId = diagrams.addServiceNode(serviceId, position);
          if (nodeId) {
            refToId.set(refId, nodeId);
            nodesCreated++;

            if (label) {
              diagrams.updateNodeData(nodeId, { customLabel: label });
            }
          }
          break;
        }

        case 'setParent': {
          const { childRef, parentRef } = cmd.params as {
            childRef: string;
            parentRef: string;
          };

          const childId = refToId.get(childRef);
          const parentId = refToId.get(parentRef);
          if (childId && parentId) {
            // setNodeParent recomputes relative position from current absolute
            // positions, but at this point the child's "position" is already
            // the relative offset we calculated in the layout (it was stored as
            // an absolute position on a node that had no parent). We call
            // setNodeParent for the parentNode/extent bookkeeping, then
            // immediately overwrite position with the layout-computed relative
            // value so the child lands in the right spot inside the group.
            diagrams.setNodeParent(childId, parentId);

            const childLayoutInfo = layout.get(childRef);
            if (childLayoutInfo) {
              const childNode = diagrams.nodes.find(n => n.id === childId);
              if (childNode) {
                childNode.position = { ...childLayoutInfo.position };
              }
            }
          }
          break;
        }

        case 'addEdge': {
          const { sourceRef, targetRef, label, flowOrder } = cmd.params as {
            sourceRef: string;
            targetRef: string;
            label?: string;
            flowOrder?: number;
          };

          const sourceId = refToId.get(sourceRef);
          const targetId = refToId.get(targetRef);
          if (sourceId && targetId) {
            const { sourceHandle, targetHandle } = chooseHandles(sourceRef, targetRef);
            diagrams.addEdge({
              source: sourceId,
              target: targetId,
              sourceHandle,
              targetHandle,
            });
            edgesCreated++;

            const edgeId = `e-${sourceId}-${targetId}`;
            if (label || flowOrder != null) {
              diagrams.updateEdgeData(edgeId, {
                ...(label ? { label } : {}),
                ...(flowOrder != null ? { flowOrder } : {}),
              });
            }
          }
          break;
        }

        case 'updateNode': {
          const { ref: nodeRef, updates } = cmd.params as {
            ref: string;
            updates: Record<string, unknown>;
          };

          const nodeId = refToId.get(nodeRef);
          if (nodeId) {
            diagrams.updateNodeData(nodeId, updates);
          }
          break;
        }
      }
    } catch (err) {
      console.warn('[DiagramAI] Failed to execute command:', cmd, err);
    }
  }

  // ── Orphan rescue + auto account ───────────────────────────────────────
  // Find the account group created by the commands (if the AI generated one).
  let accountId: string | null = (() => {
    for (const cmd of commands) {
      if (cmd.action === 'addGroup' && (cmd.params as { groupTypeId: string }).groupTypeId === 'account') {
        return refToId.get(cmd.params.refId as string) ?? null;
      }
    }
    return null;
  })();

  // Count how many account groups the AI created.
  const accountGroupIds = new Set(
    commands
      .filter(cmd => cmd.action === 'addGroup' && (cmd.params as { groupTypeId: string }).groupTypeId === 'account')
      .map(cmd => refToId.get(cmd.params.refId as string))
      .filter(Boolean) as string[],
  );
  const isMultiAccount = accountGroupIds.size > 1;

  // If the AI omitted the account group entirely, create one automatically so
  // there is always a top-level AWS Account boundary on the canvas.
  if (!accountId) {
    const autoId = diagrams.addGroupNode('account', { x: 50, y: 50 });
    if (autoId) {
      diagrams.updateNodeData(autoId, { customLabel: 'AWS Account' });
      accountId = autoId;
    }
  }

  // Attach any top-level orphan nodes (no parentNode) to the account group.
  // In multi-account diagrams, other account groups must NOT be nested inside
  // the first account — they are siblings at the top level.
  if (accountId) {
    for (const [, nodeId] of refToId) {
      const node = diagrams.nodes.find(n => n.id === nodeId);
      if (!node || node.parentNode || node.id === accountId) continue;
      if (isMultiAccount && accountGroupIds.has(nodeId)) continue; // keep sibling accounts at root
      diagrams.setNodeParent(nodeId, accountId);
    }
  }

  // Remove empty groups (groups that ended up with no children)
  const nodesWithParent = new Set(diagrams.nodes.filter(n => n.parentNode).map(n => n.parentNode as string));
  const emptyGroups = diagrams.nodes.filter(n => n.type === 'aws-group' && !nodesWithParent.has(n.id));
  for (const g of emptyGroups) {
    diagrams.removeNode(g.id);
  }

  // Run dagre auto-layout to minimise edge crossings, then fit view
  if (nodesCreated > 0) {
    applyDagreLayout(diagrams, fitViewFn);
  }

  return { success: true, nodesCreated, edgesCreated };
}

// ─── Composable ───────────────────────────────────────────────────────

export function useDiagramAI() {
  const messages = ref<AIMessage[]>([]);
  const isStreaming = ref(false);
  const isConnected = ref(false);
  const accumulatedText = ref('');

  const settings = useSettingsStore();
  const providerStore = useProviderStore();

  // Own WebSocket connection (separate from main chat)
  const { connected, connect, send, on, disconnect } = useWebSocket('/ws/chat');

  // Dedicated session for diagram AI.
  // The client sends a clientSessionId with the first request, but the server
  // creates its own session with a different ID. We capture the server's ID
  // from the first stream_start event and use it for subsequent filtering.
  const clientSessionId = `diagram-ai-${uuid()}`;
  let serverSessionId: string | null = null;
  let claudeSessionId: string | null = null;
  let awaitingFirstResponse = false;

  /** Check if the event belongs to this diagram AI session */
  function isOurSession(data: any): boolean {
    if (data.sessionId === serverSessionId) return true;
    if (data.sessionId === clientSessionId) return true;
    // While awaiting the first response the server may assign any session ID
    // (new or resumed). Since this WebSocket is dedicated to diagram AI, any
    // incoming event at this point belongs to us.
    if (awaitingFirstResponse) return true;
    return false;
  }

  function init() {
    connect();

    // Sync isConnected with actual WebSocket state.
    watch(connected, (val) => {
      isConnected.value = val;
      if (!val) {
        // Connection dropped — reset streaming state so it never gets stuck.
        isStreaming.value = false;
        awaitingFirstResponse = false;
      } else {
        // WebSocket reconnected. Sessions survive server-side disconnects, but
        // we can't be sure the server still has our session. Reset serverSessionId
        // so the next send uses awaitingFirstResponse to capture whatever session
        // ID the server assigns (new or resumed). Keep claudeSessionId so the
        // Claude conversation context is preserved across reconnects.
        serverSessionId = null;
      }
    });

    on('stream_start', (data: any) => {
      if (!isOurSession(data)) return;
      // Capture the server-assigned session ID so we can match subsequent events
      if (data.sessionId && data.sessionId !== clientSessionId) {
        serverSessionId = data.sessionId;
      }
      awaitingFirstResponse = false;
      isStreaming.value = true;
      accumulatedText.value = '';
      claudeSessionId = data.claudeSessionId || claudeSessionId;

      messages.value.push({
        id: uuid(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      });
    });

    on('stream_delta', (data: any) => {
      if (!isOurSession(data)) return;
      accumulatedText.value += data.text || '';

      // Update last assistant message
      const last = messages.value[messages.value.length - 1];
      if (last?.role === 'assistant') {
        last.content = accumulatedText.value;
      }
    });

    on('stream_end', (data: any) => {
      if (!isOurSession(data)) return;
      isStreaming.value = false;

      // Parse commands from the final text
      const last = messages.value[messages.value.length - 1];
      if (last?.role === 'assistant') {
        last.content = accumulatedText.value;
        const cmds = parseCommandBlocks(accumulatedText.value);
        if (cmds.length > 0) {
          last.commands = cmds;
        }
      }
    });

    on('error', (data: any) => {
      if (!isOurSession(data)) return;
      awaitingFirstResponse = false;
      isStreaming.value = false;

      messages.value.push({
        id: uuid(),
        role: 'assistant',
        content: `Error: ${data.message || data.error || 'Unknown error'}`,
        timestamp: Date.now(),
      });
    });
  }

  function sendPrompt(prompt: string, attachments?: SendPromptAttachments) {
    if (!connected.value) {
      // Attempt to reconnect and inform the user
      connect();
      messages.value.push({
        id: uuid(),
        role: 'assistant',
        content: 'Not connected to server. Reconnecting — please try again in a moment.',
        timestamp: Date.now(),
      });
      return;
    }

    // Add user message (show original prompt, not the augmented one)
    messages.value.push({
      id: uuid(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      attachment: attachments?.attachment,
    });

    // Always flag that we're awaiting the server's first response so
    // isOurSession can accept the stream_start event regardless of whether
    // the server reuses the previous session or creates a new one.
    awaitingFirstResponse = true;

    // Build the effective prompt — prepend HTML content as context if provided
    let effectivePrompt = prompt;
    if (attachments?.htmlContent) {
      effectivePrompt = `The user uploaded an HTML file. Here is its text content:\n\n<html_content>\n${attachments.htmlContent}\n</html_content>\n\nUser message: ${prompt}`;
    }

    const payload: Record<string, unknown> = {
      type: 'chat',
      prompt: effectivePrompt,
      sessionId: serverSessionId || clientSessionId,
      claudeSessionId,
      cwd: '.',
      provider: providerStore.activeProviderId,
      model: settings.model,
      permissionMode: 'bypassPermissions',
      disallowedTools: [
        'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
        'NotebookEdit', 'TodoWrite', 'WebFetch', 'WebSearch',
      ],
      personaPrompt: buildDiagramArchitectPrompt(),
    };

    // Include images for vision-capable models
    if (attachments?.images?.length) {
      payload.images = attachments.images;
    }

    send(payload);
  }

  function applyCommands(messageId: string, diagrams: ReturnType<typeof useDiagramsStore>, fitViewFn?: () => void) {
    const msg = messages.value.find(m => m.id === messageId);
    if (!msg?.commands || msg.applied) return null;

    const result = executeDiagramCommands(msg.commands, diagrams, fitViewFn);
    msg.applied = true;
    return result;
  }

  function abort() {
    send({ type: 'abort', sessionId: serverSessionId || clientSessionId });
    isStreaming.value = false;
  }

  function reLayout(fitViewFn?: () => void) {
    const diagrams = useDiagramsStore();
    applyDagreLayout(diagrams, fitViewFn);
  }

  function clearMessages() {
    messages.value = [];
    serverSessionId = null;
    claudeSessionId = null;
    awaitingFirstResponse = false;
  }

  onUnmounted(() => {
    disconnect();
  });

  return {
    messages,
    isStreaming,
    isConnected,
    connected,
    init,
    sendPrompt,
    applyCommands,
    abort,
    reLayout,
    clearMessages,
    disconnect,
  };
}
