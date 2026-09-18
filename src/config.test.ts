import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertBind, assertPublicUrl, loadConfig } from "./config.js";

const required = {
  TOKEN: "discord-token",
  DROPPEDNEEDLE_URL: "https://needle.example",
  DROPPEDNEEDLE_TOKEN: "needle-token",
};

describe("assertPublicUrl", () => {
  it("requires https except on localhost", () => {
    assert.equal(assertPublicUrl("https://rou.example"), "https://rou.example");
    assert.equal(assertPublicUrl("http://localhost:8787"), "http://localhost:8787");
    assert.throws(() => assertPublicUrl("http://rou.example"), /https/);
    assert.throws(() => assertPublicUrl("not-a-url"), /valid URL/);
  });
});

describe("assertBind", () => {
  it("accepts loopback and all-interfaces binds", () => {
    assert.equal(assertBind("127.0.0.1"), "127.0.0.1");
    assert.equal(assertBind("0.0.0.0"), "0.0.0.0");
    assert.throws(() => assertBind("127.0.0.1; rm -rf /"), /hostname/);
  });
});

describe("loadConfig", () => {
  it("binds the dashboard to loopback by default", () => {
    const config = loadConfig({
      ...required,
      WEB_PUBLIC_URL: "https://rou.example",
      CLIENT_SECRET: "oauth-secret",
      GUILD_ID: "123",
    });
    assert.equal(config.web?.bind, "127.0.0.1");
    assert.equal(config.web?.publicUrl, "https://rou.example");
  });

  it("refuses a public http dashboard url", () => {
    assert.throws(
      () =>
        loadConfig({
          ...required,
          WEB_PUBLIC_URL: "http://rou.example",
          CLIENT_SECRET: "oauth-secret",
          GUILD_ID: "123",
        }),
      /https/,
    );
  });
});
