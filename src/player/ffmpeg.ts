import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough, type Readable } from "node:stream";

const PCM_BYTES_PER_SECOND = 48_000 * 2 * 2;
const PREBUFFER_BYTES = PCM_BYTES_PER_SECOND;
const PREBUFFER_TIMEOUT_MS = 4_000;
const BUFFER_BYTES = PCM_BYTES_PER_SECOND * 4;

function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  if (existsSync("/usr/bin/ffmpeg")) return "/usr/bin/ffmpeg";
  const ffmpegStatic = createRequire(import.meta.url)("ffmpeg-static") as string | null;
  if (ffmpegStatic) return ffmpegStatic;
  return "ffmpeg";
}

function waitForBytes(stream: Readable, minBytes: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (stream.readableLength >= minBytes) {
      resolve();
      return;
    }
    const finish = () => {
      stream.off("readable", onReadable);
      stream.off("end", finish);
      stream.off("error", finish);
      clearTimeout(timer);
      resolve();
    };
    const onReadable = () => {
      if (stream.readableLength >= minBytes) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.on("readable", onReadable);
    stream.once("end", finish);
    stream.once("error", finish);
  });
}

export type TranscodeSession = {
  stream: Readable;
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
};

export async function transcodeToPcm(input: Readable): Promise<TranscodeSession> {
  const ff = spawn(
    resolveFfmpeg(),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  const output = new PassThrough({ highWaterMark: BUFFER_BYTES });
  const stop = () => {
    input.destroy();
    if (!ff.killed) ff.kill("SIGKILL");
    output.destroy();
  };

  ff.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[rou] ffmpeg: ${text}`);
  });
  ff.on("error", (error) => {
    console.error("[rou] ffmpeg process error:", error);
    output.destroy(error);
  });
  ff.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") console.error("[rou] ffmpeg stdin error:", error);
  });
  ff.stdout.on("error", (error) => {
    console.error("[rou] ffmpeg stdout error:", error);
  });
  output.on("close", () => {
    if (!ff.killed) ff.kill("SIGKILL");
  });

  input.on("error", (error) => {
    console.error("[rou] stream input error:", error);
    stop();
  });
  const buffered = waitForBytes(output, PREBUFFER_BYTES, PREBUFFER_TIMEOUT_MS);
  input.pipe(ff.stdin);
  ff.stdout.pipe(output);
  await buffered;
  return { stream: output, process: ff, stop };
}
