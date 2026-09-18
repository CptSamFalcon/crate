import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import type { PlayableTrack } from "../droppedneedle/types.js";
import type { QueueItem } from "../player/manager.js";

export const ACCENT = 0x5865f2;

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a track from your DroppedNeedle library")
    .addStringOption((option) =>
      option.setName("query").setDescription("Song, artist, or album").setRequired(true).setMaxLength(200),
    ),
  new SlashCommandBuilder()
    .setName("album")
    .setDescription("Queue a whole album from DroppedNeedle")
    .addStringOption((option) =>
      option.setName("query").setDescription("Album or artist + album").setRequired(true).setMaxLength(200),
    ),
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search DroppedNeedle and pick a track to play")
    .addStringOption((option) =>
      option.setName("query").setDescription("Song, artist, or album").setRequired(true).setMaxLength(200),
    ),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and leave the voice channel"),
  new SlashCommandBuilder().setName("queue").setDescription("Show the upcoming queue"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the track that is playing"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Set playback volume")
    .addIntegerOption((option) =>
      option.setName("percent").setDescription("0-150").setRequired(true).setMinValue(0).setMaxValue(150),
    ),
  new SlashCommandBuilder().setName("leave").setDescription("Disconnect Crate from voice"),
].map((command) => command.toJSON());

export function voiceChannelOf(interaction: ChatInputCommandInteraction) {
  const member = interaction.member;
  if (!member || typeof member === "string") return null;
  return (member as GuildMember).voice.channel;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "?:??";
  const whole = Math.round(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function trackLine(track: PlayableTrack): string {
  return `**${track.title}** — ${track.artist}`;
}

export function playingEmbed(track: QueueItem, extra?: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(track.title)
    .setDescription(`${track.artist}\n*${track.album}*`)
    .addFields({ name: "Duration", value: formatDuration(track.durationSeconds), inline: true })
    .setFooter({ text: `Queued by ${track.requestedBy} · DroppedNeedle` });
  if (track.coverUrl) embed.setThumbnail(track.coverUrl);
  if (extra) embed.addFields({ name: "Queue", value: extra, inline: true });
  return embed;
}

export function queueEmbed(current: QueueItem | undefined, upcoming: QueueItem[]): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(ACCENT).setTitle("Queue");
  if (current) {
    embed.addFields({
      name: "Now playing",
      value: `${trackLine(current)} (${formatDuration(current.durationSeconds)})`,
    });
  }
  if (upcoming.length === 0) {
    embed.addFields({ name: "Up next", value: current ? "Nothing else queued." : "Queue is empty." });
  } else {
    const lines = upcoming.slice(0, 15).map((track, index) => {
      return `${index + 1}. ${track.title} — ${track.artist} (${formatDuration(track.durationSeconds)})`;
    });
    if (upcoming.length > 15) lines.push(`…and ${upcoming.length - 15} more`);
    embed.addFields({ name: "Up next", value: lines.join("\n").slice(0, 1024) });
  }
  return embed;
}

export function playbackButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("crate:pause").setLabel("Pause").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("crate:resume").setLabel("Resume").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("crate:skip").setLabel("Skip").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("crate:stop").setLabel("Stop").setStyle(ButtonStyle.Danger),
  );
}

export function searchMenu(tracks: PlayableTrack[]) {
  const options = tracks.slice(0, 25).map((track, index) => ({
    label: track.title.slice(0, 100),
    description: `${track.artist} — ${track.album}`.slice(0, 100),
    value: `${index}:${track.fileId}`.slice(0, 100),
  }));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("crate:pick")
      .setPlaceholder("Pick a track to play")
      .addOptions(options),
  );
}
