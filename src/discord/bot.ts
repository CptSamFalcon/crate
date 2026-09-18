import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Interaction,
} from "discord.js";
import type { DroppedNeedleClient } from "../droppedneedle/client.js";
import type { PlayableTrack } from "../droppedneedle/types.js";
import { findAlbum, findTracks, missingLibraryMessage, toQueueItem } from "../library.js";
import { PlayerManager } from "../player/manager.js";
import {
  playbackButtons,
  playingEmbed,
  queueEmbed,
  searchMenu,
  slashCommands,
  trackLine,
  voiceChannelOf,
} from "./commands.js";
import { registerSlashCommands } from "./registerCommands.js";

const searchCache = new Map<string, PlayableTrack[]>();

export type RouBot = {
  client: Client;
  players: PlayerManager;
};

export function createBot(options: {
  token: string;
  clientId?: string;
  guildId?: string;
  needle: DroppedNeedleClient;
}): RouBot {
  const players = new PlayerManager(options.needle);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  client.once(Events.ClientReady, async (ready) => {
    console.log(`[rou] logged in as ${ready.user.tag}`);
    const clientId = options.clientId ?? ready.user.id;
    for (const guild of ready.guilds.cache.values()) {
      try {
        await registerSlashCommands({
          token: options.token,
          clientId,
          guildId: guild.id,
          commands: slashCommands,
        });
      } catch (error) {
        console.warn(`[rou] could not register commands in ${guild.name}:`, error);
      }
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    const clientId = options.clientId ?? client.user?.id;
    if (!clientId) return;
    try {
      await registerSlashCommands({
        token: options.token,
        clientId,
        guildId: guild.id,
        commands: slashCommands,
      });
    } catch (error) {
      console.warn(`[rou] could not register commands in ${guild.name}:`, error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction, options.needle, players);
    } catch (error) {
      console.error("[rou] interaction failed:", error);
      const message = "Something went wrong.";
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      } else if (interaction.isRepliable()) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  });

  return { client, players };
}

async function handleInteraction(
  interaction: Interaction,
  needle: DroppedNeedleClient,
  players: PlayerManager,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction, needle, players);
    return;
  }
  if (interaction.isButton()) {
    if (!interaction.inGuild()) return;
    const player = players.get(interaction.guildId);
    if (interaction.customId === "rou:skip") {
      const skipped = player.skip();
      await interaction.reply(skipped ? `Skipped **${skipped.title}**.` : "Nothing is playing.");
      return;
    }
    if (interaction.customId === "rou:pause") {
      await interaction.reply(player.pause() ? "Paused." : "Nothing is playing.");
      return;
    }
    if (interaction.customId === "rou:resume") {
      await interaction.reply(player.resume() ? "Resumed." : "Nothing is paused.");
      return;
    }
    if (interaction.customId === "rou:stop") {
      player.stop();
      await interaction.reply("Stopped and left the voice channel.");
    }
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === "rou:pick") {
    if (!interaction.inGuild() || !interaction.guild) return;
    const member = interaction.member as GuildMember;
    const channel = member.voice.channel;
    if (!channel) {
      await interaction.reply({ content: "Join a voice channel first.", flags: MessageFlags.Ephemeral });
      return;
    }
    const value = interaction.values[0] ?? "";
    const separator = value.indexOf(":");
    const fileId = separator >= 0 ? value.slice(separator + 1) : value;
    const cached = searchCache.get(cacheKey(interaction.guildId, interaction.user.id)) ?? [];
    const track = cached.find((item) => item.fileId === fileId);
    if (!track) {
      await interaction.reply({
        content: "That search expired. Run `/search` again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const queued = toQueueItem(track, interaction.user.displayName);
    const player = players.get(interaction.guildId);
    const position = await player.enqueue(channel, [queued]);
    players.leaveOthers(interaction.guildId);
    await interaction.reply({
      embeds: [playingEmbed(queued, position === 0 ? "Playing now" : `Queued #${position}`)],
      components: [playbackButtons()],
    });
  }
}

async function handleCommand(
  interaction: ChatInputCommandInteraction,
  needle: DroppedNeedleClient,
  players: PlayerManager,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) {
    await interaction.reply({ content: "Rou only works in servers.", flags: MessageFlags.Ephemeral });
    return;
  }

  const player = players.get(interaction.guildId);

  switch (interaction.commandName) {
    case "play":
      await playQuery(interaction, needle, players, player, "track");
      return;
    case "album":
      await playQuery(interaction, needle, players, player, "album");
      return;
    case "search": {
      const query = interaction.options.getString("query", true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const tracks = await findTracks(needle, query);
      if (tracks.length === 0) {
        await interaction.editReply(await missingLibraryMessage(needle, query));
        return;
      }
      searchCache.set(cacheKey(interaction.guildId, interaction.user.id), tracks.slice(0, 25));
      await interaction.editReply({
        content: `Found ${Math.min(tracks.length, 25)} track${tracks.length === 1 ? "" : "s"} in DroppedNeedle.`,
        components: [searchMenu(tracks)],
      });
      return;
    }
    case "skip": {
      const skipped = player.skip();
      await interaction.reply(skipped ? `Skipped **${skipped.title}**.` : "Nothing is playing.");
      return;
    }
    case "pause":
      await interaction.reply(player.pause() ? "Paused." : "Nothing is playing.");
      return;
    case "resume":
      await interaction.reply(player.resume() ? "Resumed." : "Nothing is paused.");
      return;
    case "stop":
    case "leave":
      player.stop();
      await interaction.reply("Stopped and left the voice channel.");
      return;
    case "queue":
      await interaction.reply({ embeds: [queueEmbed(player.nowPlaying?.track, player.upcoming)] });
      return;
    case "nowplaying": {
      const current = player.nowPlaying;
      if (!current) {
        await interaction.reply("Nothing is playing.");
        return;
      }
      await interaction.reply({ embeds: [playingEmbed(current.track)], components: [playbackButtons()] });
      return;
    }
    case "volume": {
      const percent = interaction.options.getInteger("percent", true);
      player.setVolume(percent);
      await interaction.reply(`Volume set to ${percent}%.`);
      return;
    }
    default:
      await interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral });
  }
}

async function playQuery(
  interaction: ChatInputCommandInteraction,
  needle: DroppedNeedleClient,
  players: PlayerManager,
  player: ReturnType<PlayerManager["get"]>,
  mode: "track" | "album",
): Promise<void> {
  const channel = voiceChannelOf(interaction);
  if (!channel) {
    await interaction.reply({ content: "Join a voice channel first.", flags: MessageFlags.Ephemeral });
    return;
  }
  const query = interaction.options.getString("query", true);
  await interaction.deferReply();
  const tracks = mode === "album" ? await findAlbum(needle, query) : await findTracks(needle, query, true);
  console.log(
    `[rou] /${mode} "${query}" -> ${tracks.length} track(s)`,
    tracks.slice(0, 3).map((track) => `${track.title} — ${track.artist}`),
  );

  if (tracks.length === 0) {
    await interaction.editReply(await missingLibraryMessage(needle, query));
    return;
  }

  const queued = tracks.map((track) => toQueueItem(track, interaction.user.displayName));
  const first = queued[0]!;
  await interaction.editReply(`Found **${first.title}** — ${first.artist}. Joining voice…`);
  const position = await player.enqueue(channel, queued);
  players.leaveOthers(interaction.guildId!);
  const extra =
    queued.length > 1
      ? `${queued.length} tracks from *${first.album}*`
      : position === 0
        ? "Playing now"
        : `Queued #${position}`;
  await interaction.editReply({
    content: position === 0 ? `Playing ${trackLine(first)}` : `Queued ${trackLine(first)}`,
    embeds: [playingEmbed(first, extra)],
    components: [playbackButtons()],
  });
}

function cacheKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}
