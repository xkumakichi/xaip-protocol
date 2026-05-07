"use strict";

const { __internals } = require("../lib/index.js");
const { canonicalize, sha256short, inferFailureType, slugify, resolveToolName } = __internals;

describe("canonicalize (JCS)", () => {
  test("primitives", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(undefined)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("a")).toBe('"a"');
  });

  test("rejects non-finite numbers", () => {
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(-Infinity)).toThrow();
  });

  test("arrays preserve order", () => {
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalize(["b", "a"])).toBe('["b","a"]');
  });

  test("objects emit keys in lexicographic order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: 1, m: 2, a: 3 })).toBe('{"a":3,"m":2,"z":1}');
  });

  test("nested ordering is recursive", () => {
    const a = canonicalize({ outer: { z: 1, a: 2 }, alpha: [3, 1, 2] });
    expect(a).toBe('{"alpha":[3,1,2],"outer":{"a":2,"z":1}}');
  });

  test("equal objects with shuffled key order produce identical output", () => {
    const a = canonicalize({ x: 1, y: { c: 3, a: 1, b: 2 } });
    const b = canonicalize({ y: { b: 2, a: 1, c: 3 }, x: 1 });
    expect(a).toBe(b);
  });
});

describe("sha256short", () => {
  test("returns 16 hex chars", () => {
    expect(sha256short("hello")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic", () => {
    expect(sha256short("abc")).toBe(sha256short("abc"));
  });

  test("differs for different inputs", () => {
    expect(sha256short("a")).not.toBe(sha256short("b"));
  });
});

describe("inferFailureType", () => {
  test("returns empty for falsy", () => {
    expect(inferFailureType(null)).toBe("");
    expect(inferFailureType(undefined)).toBe("");
  });

  test("classifies known patterns", () => {
    expect(inferFailureType(new Error("Request timed out after 30s"))).toBe("timeout");
    expect(inferFailureType(new Error("rate limit exceeded"))).toBe("rate_limit");
    expect(inferFailureType(new Error("403 Forbidden"))).toBe("auth");
    expect(inferFailureType(new Error("Unauthorized access"))).toBe("auth");
    expect(inferFailureType(new Error("schema validation failed"))).toBe("validation");
  });

  test("falls back to tool_error", () => {
    expect(inferFailureType(new Error("something else"))).toBe("tool_error");
  });
});

describe("slugify", () => {
  test("lowercases and replaces non-alphanum", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("XRPL_Payment Tool")).toBe("xrpl-payment-tool");
  });

  test("trims dashes", () => {
    expect(slugify("--foo--")).toBe("foo");
  });
});

describe("resolveToolName", () => {
  test("explicit runName wins over everything", () => {
    expect(resolveToolName({ kwargs: { name: "kw" }, name: "n", id: "i" }, "explicit")).toBe(
      "explicit"
    );
  });

  test("LangChain Serialized form: tool.kwargs.name preferred", () => {
    // Realistic shape passed by LangChain handleToolStart.
    const serialized = {
      lc: 1,
      type: "constructor",
      id: ["langchain", "tools", "DynamicTool"],
      kwargs: { name: "doc_search", description: "..." },
    };
    expect(resolveToolName(serialized)).toBe("doc_search");
  });

  test("falls back to tool.name when string", () => {
    expect(resolveToolName({ name: "plain_name" })).toBe("plain_name");
  });

  test("does not return id when id is an array", () => {
    expect(resolveToolName({ id: ["a", "b", "c"] })).toBe("unknown_tool");
  });

  test("returns id when id is a non-empty string", () => {
    expect(resolveToolName({ id: "tool-id-string" })).toBe("tool-id-string");
  });

  test("returns unknown_tool for empty inputs", () => {
    expect(resolveToolName(null)).toBe("unknown_tool");
    expect(resolveToolName(undefined)).toBe("unknown_tool");
    expect(resolveToolName({})).toBe("unknown_tool");
  });
});
