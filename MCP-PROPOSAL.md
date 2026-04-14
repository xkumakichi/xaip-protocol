# MCP Specification Proposal: Tool Execution Hooks

**Proposal for:** modelcontextprotocol/specification
**Author:** Hiro (xkumakichi)
**Date:** 2026-04-12
**Status:** Draft (pre-submission)

---

## Summary

Add standard lifecycle hooks for tool execution in the MCP Server SDK, enabling middleware-style instrumentation without relying on private APIs.

## Motivation

### Problem

MCP server developers need to instrument tool executions for:

1. **Trust & Safety** — Logging execution results, computing trust scores, verifying behavior
2. **Observability** — Latency tracking, error classification, OpenTelemetry integration
3. **Compliance** — Audit trails with signed execution receipts for regulated industries
4. **Rate Limiting** — Per-tool and per-caller throttling

Currently, the only way to wrap tool handlers is by accessing `server._registeredTools` (a private property) and modifying callback functions directly. This approach:

- Breaks on SDK version updates without notice
- Cannot be type-checked
- Requires understanding of internal SDK structure
- Makes it impossible to build interoperable middleware

### Evidence of Need

- **30+ MCP CVEs in 60 days** (2026 Q1) — tool execution monitoring is critical
- **7,000+ servers on Smithery, 1,600+ on Glama** — no standardized way to add instrumentation
- Multiple independent projects have implemented the same `_registeredTools` hack:
  - XAIP Protocol (trust scoring)
  - Veridict (execution logging)
  - Various community wrappers

## Proposed API

### Option A: Hook-based (Recommended)

```typescript
server.onToolCall(async (toolName, args, next) => {
  const start = Date.now();
  try {
    const result = await next(args);
    console.log(`${toolName} ok ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.log(`${toolName} error ${Date.now() - start}ms`);
    throw error;
  }
});
```

**API Surface:**

```typescript
interface McpServer {
  // Existing
  tool(name: string, ...): void;

  // Proposed
  onToolCall(handler: ToolCallHook): void;
  onToolResult?(handler: ToolResultHook): void;
}

type ToolCallHook = (
  toolName: string,
  args: Record<string, unknown>,
  next: (args: Record<string, unknown>) => Promise<ToolResult>
) => Promise<ToolResult>;
```

### Option B: Event-based (Simpler but less powerful)

```typescript
server.on("tool:before", (event) => { /* read-only */ });
server.on("tool:after", (event) => { /* read-only */ });
server.on("tool:error", (event) => { /* read-only */ });
```

### Recommendation

**Option A** — the middleware pattern (`next()`) is well-understood (Express, Koa, tRPC) and enables both observation and transformation. Option B is read-only and cannot implement use cases like caching or input validation.

## Use Cases Enabled

| Use Case | Today | With Hooks |
|----------|-------|------------|
| Execution logging | `_registeredTools` hack | `onToolCall` |
| Trust scoring (XAIP) | `_registeredTools` hack | `onToolCall` + signed receipts |
| OpenTelemetry spans | Manual wrapping | `onToolCall` + OTel SDK |
| Rate limiting | Not possible cleanly | `onToolCall` + throw before `next()` |
| Input validation | Not possible cleanly | `onToolCall` + validate before `next()` |
| Response caching | Manual per-tool | `onToolCall` + cache layer |
| Audit trail | `_registeredTools` hack | `onToolCall` + append-only log |

## Backward Compatibility

This is a purely additive change. No existing APIs are modified. Servers that don't use hooks behave identically.

## Implementation Notes

The implementation is straightforward: maintain an ordered list of hooks. When a tool call arrives, chain through hooks before invoking the registered handler.

```typescript
// Pseudocode
async function handleToolCall(name, args) {
  const handler = this._registeredTools.get(name).callback;
  const chain = [...this._hooks, (args) => handler(args)];
  return executeChain(chain, name, args);
}
```

## Prior Art

| Framework | Hook API |
|-----------|----------|
| Express.js | `app.use(middleware)` |
| Koa | `app.use(async (ctx, next) => {})` |
| tRPC | `.middleware()` |
| OpenTelemetry | `Instrumentation` |
| gRPC | Interceptors |

## Next Steps

1. Submit as Issue on modelcontextprotocol/specification
2. Discuss with Anthropic MCP team
3. Reference implementation in TypeScript SDK
4. Adopt in XAIP, Veridict, and other instrumentors
