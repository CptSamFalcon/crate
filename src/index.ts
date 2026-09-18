import "dotenv/config";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { generateDependencyReport } from "@discordjs/voice";
import { loadConfig } from "./config.js";
import { DroppedNeedleClient } from "./droppedneedle/client.js";
import { createBot } from "./discord/bot.js";
import { startWeb } from "./web/server.js";

try {
  await import("@snazzah/davey");
} catch (error) {
  console.error("[rou] DAVE native module failed to load:", error);
  throw error;
}

try {
  await import("@discordjs/opus");
} catch (error) {
  console.warn("[rou] native opus failed to load, audio may hitch:", error);
}

const ffmpegStatic = createRequire(import.meta.url)("ffmpeg-static") as string | null;
const ffmpegPath = existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : ffmpegStatic;
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
  process.env.FFMPEG_BIN = ffmpegPath;
}

const config = loadConfig();
const needle = new DroppedNeedleClient(config.droppedNeedleUrl, {
  token: config.DROPPEDNEEDLE_TOKEN,
  username: config.DROPPEDNEEDLE_USERNAME,
  password: config.DROPPEDNEEDLE_PASSWORD,
});

console.log("[rou] checking DroppedNeedle…");
const user = await needle.connect();
console.log(`[rou] DroppedNeedle ok as ${user.display_name} (${user.role}) @ ${config.droppedNeedleUrl}`);
console.log(generateDependencyReport());

const { client, players } = createBot({
  token: config.DISCORD_TOKEN,
  clientId: config.DISCORD_CLIENT_ID,
  guildId: config.DISCORD_GUILD_ID,
  needle,
});

await client.login(config.DISCORD_TOKEN);

if (config.web) {
  startWeb({ config, web: config.web, client, players, needle });
} else if (config.WEB_PUBLIC_URL || config.DISCORD_CLIENT_SECRET) {
  console.warn("[rou] web UI disabled: set WEB_PUBLIC_URL, CLIENT_SECRET, and GUILD_ID");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void client.destroy().then(() => process.exit(0));
  });
}
