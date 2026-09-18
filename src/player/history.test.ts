import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rememberPlayedTrack } from "./manager.js";

describe("rememberPlayedTrack", () => {
  it("puts the latest track first", () => {
    const history = rememberPlayedTrack(
      [{ fileId: "a" }, { fileId: "b" }],
      { fileId: "c" },
    );
    assert.deepEqual(
      history.map((item) => item.fileId),
      ["c", "a", "b"],
    );
  });

  it("does not duplicate the most recent track", () => {
    const history = rememberPlayedTrack([{ fileId: "a" }, { fileId: "b" }], { fileId: "a" });
    assert.deepEqual(
      history.map((item) => item.fileId),
      ["a", "b"],
    );
  });

  it("caps history length", () => {
    const start = Array.from({ length: 5 }, (_, index) => ({ fileId: String(index) }));
    const history = rememberPlayedTrack(start, { fileId: "new" }, 4);
    assert.equal(history.length, 4);
    assert.equal(history[0]?.fileId, "new");
  });

  it("keeps a track that returns later", () => {
    const history = rememberPlayedTrack(
      rememberPlayedTrack([{ fileId: "a" }], { fileId: "b" }),
      { fileId: "a" },
    );
    assert.deepEqual(
      history.map((item) => item.fileId),
      ["a", "b", "a"],
    );
  });
});
