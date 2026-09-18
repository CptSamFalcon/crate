import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactVoiceForMember } from "./voice.js";

describe("redactVoiceForMember", () => {
  it("keeps the current channel when the member can see it", () => {
    assert.deepEqual(redactVoiceForMember("1", "Staff", ["1", "2"]), { channelId: "1", channelName: "Staff" });
  });

  it("hides the name of a channel the member cannot view", () => {
    assert.deepEqual(redactVoiceForMember("99", "Secret Lounge", ["1", "2"]), {
      channelId: "99",
      channelName: null,
    });
  });

  it("clears an empty connection", () => {
    assert.deepEqual(redactVoiceForMember(null, "Staff", ["1"]), { channelId: null, channelName: null });
  });
});
