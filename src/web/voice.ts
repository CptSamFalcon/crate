import { ChannelType, type Client, type VoiceBasedChannel } from "discord.js";

export async function pickVoiceChannel(
  client: Client,
  guildId: string,
  currentChannelId?: string,
): Promise<VoiceBasedChannel | null> {
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
  await guild.channels.fetch();

  if (currentChannelId) {
    const current = guild.channels.cache.get(currentChannelId);
    if (current?.isVoiceBased()) return current;
  }

  const voices = [...guild.channels.cache.values()].filter((channel): channel is VoiceBasedChannel => {
    return (
      channel.isVoiceBased() &&
      channel.type !== ChannelType.GuildStageVoice &&
      channel.id !== guild.afkChannelId
    );
  });
  const occupied = voices.find((channel) => channel.members.some((member) => !member.user.bot));
  return occupied ?? voices[0] ?? null;
}
