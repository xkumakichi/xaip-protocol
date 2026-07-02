"use strict";

const { __internals } = require("../lib/index.js");
const { canonicalize, sha256hex, inferFailureType, slugify, safeStringify } = __internals;

describe("canonicalize (JCS)", () => {
  test("primitives", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(undefined)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize("a")).toBe('"a"');
  });

  test("rejects non-finite numbers", () => {
    expect(() => canonicalize(NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
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

describe("sha256hex", () => {
  test("returns the full 64-char SHA-256 hex digest", () => {
    expect(sha256hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });
  test("hashes null/undefined as the empty-input sentinel", () => {
    const sentinel =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(sha256hex(undefined)).toBe(sentinel);
    expect(sha256hex(null)).toBe(sentinel);
  });
  test("hashes JSON values via JCS: key order cannot change the hash", () => {
    expect(sha256hex({ a: 1, b: 2 })).toBe(sha256hex({ b: 2, a: 1 }));
  });
  test("circular values fall back to a stable marker hash", () => {
    const a = {};
    a.self = a;
    expect(sha256hex(a)).toBe(sha256hex(a));
    expect(sha256hex(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  test("is deterministic", () => {
    expect(sha256hex("abc")).toBe(sha256hex("abc"));
  });
});

describe("inferFailureType", () => {
  test("returns empty for falsy", () => {
    expect(inferFailureType(null)).toBe("");
    expect(inferFailureType(undefined)).toBe("");
  });

  test("classifies known patterns", () => {
    expect(inferFailureType(new Error("Request timed out"))).toBe("timeout");
    expect(inferFailureType(new Error("rate limit hit"))).toBe("rate_limit");
    expect(inferFailureType(new Error("403 Forbidden"))).toBe("auth");
    expect(inferFailureType(new Error("schema validation failed"))).toBe("validation");
  });

  test("falls back to the registry catch-all \"error\"", () => {
    expect(inferFailureType(new Error("something else"))).toBe("error");
  });
});

describe("slugify", () => {
  test("lowercases and replaces non-alphanum", () => {
    expect(slugify("Search Docs!")).toBe("search-docs");
    expect(slugify("get_weather")).toBe("get-weather");
  });
  test("trims dashes", () => {
    expect(slugify("--foo--")).toBe("foo");
  });
});

describe("safeStringify", () => {
  test("serializes ordinary values", () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
    expect(safeStringify("hello")).toBe('"hello"');
    expect(safeStringify(42)).toBe("42");
  });

  test("falls back to stable marker for circular references", () => {
    const a = {};
    a.self = a;
    expect(safeStringify(a)).toBe('{"_xaip_unserializable":true}');
  });

  test("falls back for BigInt (JSON.stringify throws)", () => {
    expect(safeStringify(BigInt(1))).toBe('{"_xaip_unserializable":true}');
  });
});
