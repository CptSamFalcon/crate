import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedCoverUrl, isPublicCoverUrl, isSafeImageContentType } from "./client.js";

const needle = "https://needle.example";

describe("isPublicCoverUrl", () => {
  it("allows cover art archive over https only", () => {
    assert.equal(isPublicCoverUrl("https://coverartarchive.org/release-group/abc/front-500"), true);
    assert.equal(isPublicCoverUrl("http://coverartarchive.org/release-group/abc/front-500"), false);
    assert.equal(isPublicCoverUrl("https://evil.example/?u=https://coverartarchive.org"), false);
  });
});

describe("isAllowedCoverUrl", () => {
  it("allows DroppedNeedle cover and artwork paths", () => {
    assert.equal(
      isAllowedCoverUrl("https://needle.example/api/v1/covers/artist/11111111-1111-1111-1111-111111111111", needle),
      true,
    );
    assert.equal(
      isAllowedCoverUrl("https://needle.example/api/v1/library/albums/abc/artwork/cached", needle),
      true,
    );
  });

  it("blocks path traversal onto authenticated DroppedNeedle routes", () => {
    assert.equal(
      isAllowedCoverUrl("https://needle.example/api/v1/covers/artist/../../auth/me", needle),
      false,
    );
    assert.equal(isAllowedCoverUrl("https://needle.example/api/v1/auth/me", needle), false);
    assert.equal(
      isAllowedCoverUrl("https://needle.example/api/v1/stream/local/secret", needle),
      false,
    );
    assert.equal(isAllowedCoverUrl("https://other.example/api/v1/covers/artist/x", needle), false);
  });
});

describe("isSafeImageContentType", () => {
  it("rejects svg and html", () => {
    assert.equal(isSafeImageContentType("image/jpeg"), true);
    assert.equal(isSafeImageContentType("image/png; charset=binary"), true);
    assert.equal(isSafeImageContentType("image/svg+xml"), false);
    assert.equal(isSafeImageContentType("text/html"), false);
  });
});
