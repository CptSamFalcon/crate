import "dotenv/config";
import { createRequire } from "node:module";
import { generateDependencyReport } from "@discordjs/voice";
import { loadConfig } from "./config.js";
import { DroppedNeedleClient } from "./droppedneedle/client.js";
import { createBot } from "./discord/bot.js";

const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as string | null;
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

const bot = createBot({
  token: config.DISCORD_TOKEN,
  clientId: config.DISCORD_CLIENT_ID,
  guildId: config.DISCORD_GUILD_ID,
  needle,
});

await bot.login(config.DISCORD_TOKEN);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void bot.destroy().then(() => process.exit(0));
  });
}
