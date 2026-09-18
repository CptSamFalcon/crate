import { ChannelType, PermissionFlagsBits, type Client, type VoiceBasedChannel } from "discord.js";

export type VoiceChannelInfo = {
  id: string;
  name: string;
  memberCount: number;
  current: boolean;
  you: boolean;
};

export type PickVoiceOptions = {
  preferredChannelId?: string;
  currentChannelId?: string;
  userId?: string;
  allowEmptyFallback?: boolean;
};

function isListedVoiceChannel(
  channel: { isVoiceBased: () => boolean; type: ChannelType; id: string },
  afkChannelId: string | null,
): channel is VoiceBasedChannel {
  if (!channel.isVoiceBased()) return false;
  if (channel.type === ChannelType.GuildStageVoice) return false;
  if (channel.id === afkChannelId) return false;
  return true;
}

function botCanConnect(channel: VoiceBasedChannel): boolean {
  const me = channel.guild.members.me;
  if (!me) return true;
  const permissions = channel.permissionsFor(me);
  if (!permissions) return true;
  return permissions.has(PermissionFlagsBits.Connect);
}

async function voiceChannelsOf(client: Client, guildId: string, refresh = true): Promise<VoiceBasedChannel[]> {
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
  const listed = () =>
    [...guild.channels.cache.values()]
      .filter((channel): channel is VoiceBasedChannel => isListedVoiceChannel(channel, guild.afkChannelId))
      .sort((left, right) => {
        const position = left.rawPosition - right.rawPosition;
        return position !== 0 ? position : left.name.localeCompare(right.name);
      });

  let voices = listed();
  if (refresh || voices.length === 0) {
    await guild.channels.fetch();
    voices = listed();
  }
  const joinable = voices.filter(botCanConnect);
  return joinable.length > 0 ? joinable : voices;
}

export async function listVoiceChannels(
  client: Client,
  guildId: string,
  options?: { botChannelId?: string; userId?: string; refresh?: boolean },
): Promise<VoiceChannelInfo[]> {
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
  const voices = await voiceChannelsOf(client, guildId, options?.refresh !== false);
  const userChannelId = options?.userId ? (guild.voiceStates.cache.get(options.userId)?.channelId ?? null) : null;
  return voices.map((channel) => ({
    id: channel.id,
    name: channel.name,
    memberCount: channel.members.filter((member) => !member.user.bot).size,
    current: channel.id === options?.botChannelId,
    you: Boolean(userChannelId && channel.id === userChannelId),
  }));
}

export async function pickVoiceChannel(
  client: Client,
  guildId: string,
  options: PickVoiceOptions = {},
): Promise<VoiceBasedChannel | null> {
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
  const voices = await voiceChannelsOf(client, guildId, true);
  const byId = (id?: string) => (id ? (voices.find((channel) => channel.id === id) ?? null) : null);

  const preferred = byId(options.preferredChannelId);
  if (preferred) return preferred;

  if (options.userId) {
    const yours = byId(guild.voiceStates.cache.get(options.userId)?.channelId ?? undefined);
    if (yours) return yours;
  }

  const current = byId(options.currentChannelId);
  if (current) return current;

  if (voices.length === 1) return voices[0] ?? null;

  const occupied = voices.find((channel) => channel.members.some((member) => !member.user.bot));
  if (occupied && options.allowEmptyFallback !== false) return occupied;

  if (options.allowEmptyFallback === false) return null;
  return occupied ?? voices[0] ?? null;
}

export async function memberInGuild(client: Client, guildId: string, userId: string): Promise<boolean> {
  try {
    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
    const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId));
    return Boolean(member);
  } catch {
    return false;
  }
}

export function listBotGuilds(client: Client): { id: string; name: string; iconUrl: string | null }[] {
  return [...client.guilds.cache.values()]
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 64 }),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
