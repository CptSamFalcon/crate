import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cookieSecure,
  decode,
  encode,
  mutatingRequestAllowed,
  originAllowed,
  SESSION_MAX_AGE,
  sessionUserFromToken,
} from "./auth.js";

const secret = "test-session-secret";
const publicUrl = "https://rou.example";

describe("originAllowed", () => {
  it("rejects a missing origin", () => {
    assert.equal(originAllowed(undefined, publicUrl), false);
  });

  it("allows the dashboard origin only", () => {
    assert.equal(originAllowed("https://rou.example", publicUrl), true);
    assert.equal(originAllowed("https://evil.example", publicUrl), false);
    assert.equal(originAllowed("https://rou.example.evil.com", publicUrl), false);
  });
});

describe("mutatingRequestAllowed", () => {
  it("rejects cross-site posts even when a referer is present", () => {
    assert.equal(
      mutatingRequestAllowed("https://evil.example", "https://rou.example/crate", publicUrl),
      false,
    );
  });

  it("allows a same-origin referer when origin is missing", () => {
    assert.equal(mutatingRequestAllowed(undefined, "https://rou.example/crate", publicUrl), true);
    assert.equal(mutatingRequestAllowed(undefined, undefined, publicUrl), false);
  });
});

describe("session cookies", () => {
  it("rejects tampered and expired sessions", () => {
    const token = encode(secret, {
      id: "123456789012345678",
      username: "rou",
      globalName: "Rou",
      avatar: null,
      exp: Date.now() + SESSION_MAX_AGE * 1000,
    });
    assert.equal(sessionUserFromToken(secret, token)?.username, "rou");
    assert.equal(sessionUserFromToken("other-secret", token), null);
    assert.equal(sessionUserFromToken(secret, `${token}x`), null);

    const expired = encode(secret, {
      id: "123456789012345678",
      username: "rou",
      globalName: null,
      avatar: null,
      exp: Date.now() - 1000,
    });
    assert.equal(sessionUserFromToken(secret, expired), null);

    const legacy = encode(secret, { id: "123456789012345678", username: "rou" });
    assert.equal(sessionUserFromToken(secret, legacy), null);
  });

  it("does not treat a signed payload as a session without a discord id", () => {
    const token = encode(secret, {
      id: "not-a-snowflake",
      username: "rou",
      globalName: null,
      avatar: null,
      exp: Date.now() + 60_000,
    });
    assert.equal(sessionUserFromToken(secret, token), null);
  });

  it("round-trips signed oauth state", () => {
    const token = encode(secret, { state: "abc", verifier: "def", exp: Date.now() + 60_000 });
    const parsed = decode<{ state: string; verifier: string }>(secret, token);
    assert.equal(parsed?.state, "abc");
    assert.equal(parsed?.verifier, "def");
  });
});

describe("cookieSecure", () => {
  it("is secure only for https public urls", () => {
    assert.equal(cookieSecure("https://rou.example"), true);
    assert.equal(cookieSecure("http://localhost:8787"), false);
  });
});
