# Integration Tests

This directory contains comprehensive integration tests that verify the application behavior matches user expectations, particularly from the VS Code Claude extension experience.

## Test Files

### `websocket-flow.test.ts`
**Focus**: Technical WebSocket functionality
- Tests WebSocket message flows and protocols
- Validates state management during streaming
- Covers error recovery and session management
- Ensures tool workflows function correctly

### `vscode-parity.test.ts`
**Focus**: VS Code-like user experience behavior
- Tests visual streaming states and timing
- Validates session continuity patterns
- Ensures seamless tool integration UX
- Covers error presentation and recovery
- Performance and responsiveness standards

## Testing Philosophy

These tests complement each other:

1. **Technical Correctness** (`websocket-flow.test.ts`):
   - Ensures the WebSocket protocol works correctly
   - Validates that messages are processed in the right order
   - Tests that state mutations happen as expected

2. **Behavioral Fidelity** (`vscode-parity.test.ts`):
   - Ensures the experience **feels** like native VS Code Claude
   - Tests timing and visual feedback patterns
   - Validates that errors don't break user flow
   - Ensures performance meets user expectations

## Key Behavioral Tests

### Visual Streaming States
- **Typing indicators**: Brief pause before content streams (like VS Code)
- **Progressive rendering**: Smooth incremental content updates
- **Streaming interruptions**: Tool requests don't break visual flow
- **Thinking mode**: Visual indicators match VS Code patterns

### Session Continuity
- **Seamless restoration**: No jarring reloads when reconnecting
- **Mid-stream recovery**: Network interruptions handled gracefully
- **Session transitions**: URL updates don't disrupt user flow

### Tool Integration UX
- **Parameter streaming**: Tool inputs build progressively (like VS Code)
- **Multi-tool workflows**: Complex chains feel natural
- **Approval flow**: Tool requests integrate smoothly in conversation

### Error Recovery
- **Inline errors**: Rate limits and failures shown contextually
- **Connection issues**: Network problems don't lose context
- **Malformed data**: App remains stable during protocol errors

## Running Tests

```bash
# Run all integration tests
npm test -- --run src/test/integration/

# Run specific test file
npm test -- --run src/test/integration/vscode-parity.test.ts

# Run with coverage
npm run test:coverage
```

## Test Structure

Each behavioral test follows this pattern:

1. **Setup realistic scenario**: Simulate actual user interaction
2. **Execute behavior**: Trigger the specific UX pattern being tested
3. **Validate experience**: Check timing, visual states, and flow continuity
4. **Verify standards**: Ensure performance meets VS Code expectations

## Key Insights

The main insight behind `vscode-parity.test.ts` is that **technical correctness != good user experience**.

While `websocket-flow.test.ts` ensures the WebSocket protocol works correctly, it doesn't test whether the experience **feels** polished and responsive like the native VS Code extension.

The behavioral tests fill this gap by validating:
- **Timing patterns**: How quickly visual feedback appears
- **Flow continuity**: Whether interactions feel seamless
- **Error presentation**: How problems are communicated to users
- **Performance standards**: Whether the app feels responsive

This comprehensive testing approach ensures the web version provides an experience that matches user expectations from VS Code Claude.