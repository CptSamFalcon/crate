import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowRequest, clampQuery, isSafeId } from "./security.js";

describe("isSafeId", () => {
  it("allows library and discord ids", () => {
    assert.equal(isSafeId("123456789012345678"), true);
    assert.equal(isSafeId("native:7d1c8a2b-3e4f-5a6b-7c8d-9e0f1a2b3c4d"), true);
    assert.equal(isSafeId("name:Radiohead|OK Computer"), true);
  });

  it("rejects path traversal and query injection", () => {
    assert.equal(isSafeId("../auth/me"), false);
    assert.equal(isSafeId("artist/../../v1/auth/me"), false);
    assert.equal(isSafeId("id?x=1"), false);
    assert.equal(isSafeId("id#frag"), false);
    assert.equal(isSafeId(""), false);
    assert.equal(isSafeId("a".repeat(129)), false);
  });
});

describe("clampQuery", () => {
  it("caps search input", () => {
    assert.equal(clampQuery("x".repeat(500)).length, 200);
    assert.equal(clampQuery("ok"), "ok");
  });
});

describe("allowRequest", () => {
  it("rate limits a key inside the window", () => {
    const key = `test:${Date.now()}`;
    assert.equal(allowRequest(key, 2, 60_000), true);
    assert.equal(allowRequest(key, 2, 60_000), true);
    assert.equal(allowRequest(key, 2, 60_000), false);
  });
});
