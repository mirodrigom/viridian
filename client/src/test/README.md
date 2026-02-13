# Testing Documentation

This directory contains comprehensive test suites for the Claude Code Web client application, focusing on chat/session functionality to ensure reliability comparable to native Claude in VS Code.

## Test Structure

### Core Components

#### `setup.ts`
- Global test setup and configuration
- Mocks for `sessionStorage`, `WebSocket`, `fetch`, and `vue-router`
- Essential for all test files

#### `utils.ts`
- Test utility functions and helpers
- Mock data creators (`createMockMessage`, `createMockToolMessage`, etc.)
- Common test operations (`nextTick`, `wait`, `setupTestPinia`)

### Unit Tests

#### `stores/chat.test.ts`
Comprehensive tests for the main chat store (`useChatStore`):
- **Initialization**: State restoration from `sessionStorage`
- **Message Management**: Adding, updating, streaming text
- **Streaming State**: Start/stop, timing, response calculation
- **Usage Tracking**: Token counts, context percentage, session metrics
- **Rate Limiting**: Auto-clear timers, manual clearing, edge cases
- **Thinking Mode**: Start/update/finish thinking content
- **Tool Use**: Input streaming, completion, status updates
- **Todo Extraction**: Latest todos from `TodoWrite` tools
- **Pagination**: Message loading, prepending, appending
- **Session Persistence**: `sessionStorage` synchronization

#### `composables/useClaudeStream.test.ts`
Tests for the WebSocket streaming composable:
- **Initialization**: WebSocket connection, event handler setup
- **Stream Events**: Start, delta, end with session data
- **Tool Use Handling**: Auto-approval, plan mode tracking, input streaming
- **Thinking Mode**: Start/delta/end events
- **Error Handling**: Rate limits, general errors, message parsing
- **Session Management**: Status checks, reconnection scenarios
- **Message Sending**: Payload construction, thinking prefixes, images
- **Tool Responses**: Approval/rejection with user answers

### Integration Tests

#### `integration/websocket-flow.test.ts`
End-to-end WebSocket message flows:
- **Complete Chat Flow**: User message → streaming → completion
- **Tool Workflows**: Text splitting around tools, multi-tool sequences
- **Tool Input Streaming**: Progressive JSON building, parsing
- **Thinking Mode Integration**: Full thinking → response cycle
- **Session Recovery**: Mid-stream reconnection, missed message fetching
- **Error Recovery**: Rate limits, connection failures, malformed messages
- **Complex Scenarios**: Multi-tool workflows with approvals

### Specialized Tests

#### `error-handling.test.ts`
Focused on error scenarios and rate limiting:
- **Rate Limiting Logic**: Timer management, auto-clear, edge cases
- **Time Parsing**: Various reset time formats, year rollover
- **Error Detection**: Rate limit pattern matching
- **Session Recovery**: Edge cases, missing data, rapid changes
- **Performance**: Large error volumes, rapid state changes
- **Recovery Strategies**: State consistency, graceful degradation

#### `tool-workflows.test.ts`
Comprehensive tool use testing:
- **Tool Lifecycle**: Creation, approval, rejection
- **Input Streaming**: Progressive building, malformed JSON
- **User Responses**: `AskUserQuestion`, multi-choice answers
- **Multiple Tools**: Sequences, concurrent operations
- **Permission Modes**: Auto-approval vs manual approval
- **Todo Integration**: Extraction, filtering, performance
- **Plan Mode**: Entry/exit tracking
- **Error Scenarios**: Missing IDs, rapid changes
- **Performance**: Many tools, efficient todo finding

## Running Tests

```bash
# Run all tests
npm run test

# Run tests once (CI mode)
npm run test:run

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest stores/chat.test.ts

# Run tests in watch mode
npx vitest --watch
```

## Test Configuration

### `vitest.config.ts`
- Vue plugin integration
- Happy DOM environment for browser APIs
- Path aliases (`@` → `src`)
- Coverage configuration (V8 provider)
- File inclusion/exclusion patterns

### Coverage Targets
- **Stores**: `src/stores/*.ts` (chat, settings, auth)
- **Composables**: `src/composables/*.ts` (useClaudeStream, useWebSocket)
- **Utilities**: `src/lib/*.ts`

**Excluded**: Tests, main.ts, router, type definitions

## Key Testing Principles

### 1. **Reliability Focus**
Tests ensure the chat experience is as stable as native Claude in VS Code:
- Session persistence across page reloads
- WebSocket reconnection handling
- Rate limit management
- Tool use workflow integrity

### 2. **Real-World Scenarios**
Tests simulate actual usage patterns:
- Multi-tool workflows
- Streaming interruptions
- Network failures
- Rate limit recovery

### 3. **Performance Validation**
Critical paths are performance-tested:
- Large message volumes
- Rapid state changes
- Complex tool sequences
- Todo extraction efficiency

### 4. **Error Resilience**
Comprehensive error handling coverage:
- Malformed WebSocket messages
- Storage quota exceeded
- Network timeouts
- Invalid tool inputs

## Mock Strategy

### WebSocket Mocking
- Event-driven mock with `emit()` helper
- Connection state simulation
- Message flow control for integration tests

### Storage Mocking
- Full `sessionStorage` API implementation
- Persistence testing across "page reloads"
- Quota exceeded scenarios

### API Mocking
- `fetch` mock for session recovery
- Authentication header validation
- Response simulation for edge cases

## Test Data Patterns

### Message Creation
```typescript
const message = createMockMessage({
  role: 'assistant',
  content: 'Test response',
  isStreaming: true
})
```

### Tool Messages
```typescript
const toolMsg = createMockToolMessage('Read', {
  file_path: '/test/file.txt'
}, 'pending')
```

### Rate Limit Scenarios
```typescript
const error = createRateLimitError('Feb 13, 2pm')
```

## Debugging Tests

### Common Issues
1. **Timer-related tests**: Use `vi.useFakeTimers()` and `vi.advanceTimersByTime()`
2. **Async operations**: Always `await nextTick()` after state changes
3. **WebSocket events**: Ensure event handlers are registered before emitting
4. **Storage persistence**: Clear storage in `beforeEach` for isolation

### Useful Commands
```bash
# Debug specific test
npx vitest --reporter=verbose stores/chat.test.ts

# Run with UI for debugging
npx vitest --ui

# Run single test case
npx vitest -t "should handle streaming"
```

## Contributing to Tests

### Adding New Tests
1. Follow existing naming patterns
2. Use appropriate mock utilities
3. Include both happy path and error cases
4. Test performance for critical paths
5. Document complex test scenarios

### Test Categories
- **Unit**: Single component/function testing
- **Integration**: Multi-component interactions
- **Performance**: Large-scale operations
- **Error**: Edge cases and failure scenarios

This test suite provides the foundation for ensuring Claude Code Web delivers a reliable, native-quality chat experience.