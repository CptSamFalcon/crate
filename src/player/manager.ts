import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  type VoiceConnection,
  VoiceConnectionStatus,
} from "@discordjs/voice";
import { Readable } from "node:stream";
import type { VoiceBasedChannel } from "discord.js";
import type { DroppedNeedleClient } from "../droppedneedle/client.js";
import type { PlayableTrack } from "../droppedneedle/types.js";
import { transcodeToPcm, type TranscodeSession } from "./ffmpeg.js";

export type QueueItem = PlayableTrack & {
  requestedBy: string;
};

export type NowPlaying = {
  track: QueueItem;
  startedAt: number;
};

const MAX_QUEUE = 200;
export const MAX_PLAYED = 30;

export function rememberPlayedTrack<T extends { fileId: string }>(history: T[], track: T, max = MAX_PLAYED): T[] {
  if (history[0]?.fileId === track.fileId) return history.slice(0, max);
  return [track, ...history].slice(0, max);
}

type StatusListener = () => void;

let voiceJoinLock: Promise<void> = Promise.resolve();

async function withVoiceJoinLock<T>(fn: () => Promise<T>): Promise<T> {
  const waitFor = voiceJoinLock;
  let release!: () => void;
  voiceJoinLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await waitFor;
  try {
    return await fn();
  } finally {
    release();
  }
}

export class GuildPlayer {
  readonly player: AudioPlayer;
  private connection: VoiceConnection | undefined;
  private readonly queue: QueueItem[] = [];
  private readonly played: QueueItem[] = [];
  private current: NowPlaying | undefined;
  private stopped = false;
  private starting = false;
  private volume = 0.8;
  private transcode: TranscodeSession | undefined;
  private readonly statusListeners = new Set<StatusListener>();
  private opLock: Promise<void> = Promise.resolve();

  constructor(
    readonly guildId: string,
    private readonly needle: DroppedNeedleClient,
  ) {
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    this.player.on("error", (error) => {
      console.error(`[crate] audio error in guild ${guildId}:`, error);
      if (!this.starting) void this.advance();
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.stopped || this.starting) return;
      void this.advance();
    });
    this.player.on(AudioPlayerStatus.Playing, () => this.notify());
    this.player.on(AudioPlayerStatus.Paused, () => this.notify());
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  get nowPlaying(): NowPlaying | undefined {
    return this.current;
  }

  get upcoming(): QueueItem[] {
    return [...this.queue];
  }

  get previouslyPlayed(): QueueItem[] {
    return [...this.played];
  }

  get size(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  get paused(): boolean {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  get volumePercent(): number {
    return Math.round(this.volume * 100);
  }

  get channelId(): string | undefined {
    const connection = this.connection;
    if (!connection) return undefined;
    const status = connection.state.status;
    if (status === VoiceConnectionStatus.Destroyed || status === VoiceConnectionStatus.Disconnected) {
      return undefined;
    }
    return connection.joinConfig.channelId ?? undefined;
  }

  isIdle(): boolean {
    return !this.current && this.queue.length === 0;
  }

  async enqueue(channel: VoiceBasedChannel, tracks: QueueItem[]): Promise<number> {
    return this.withLock(async () => {
      if (this.queue.length + tracks.length > MAX_QUEUE) {
        throw new Error(`Queue would exceed ${MAX_QUEUE} tracks`);
      }
      await this.ensureConnected(channel);
      const startNow = this.isIdle();
      this.queue.push(...tracks);
      if (startNow) {
        const started = await this.advance();
        if (!started) {
          throw new Error(`Found ${tracks[0]?.title ?? "a track"} but could not start the audio stream`);
        }
      } else {
        this.notify();
      }
      return startNow ? 0 : this.queue.length - tracks.length + 1;
    });
  }

  skip(): QueueItem | undefined {
    const skipped = this.current?.track;
    this.player.stop(true);
    this.notify();
    return skipped;
  }

  removeQueued(index: number): QueueItem | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) return undefined;
    const [removed] = this.queue.splice(index, 1);
    this.notify();
    return removed;
  }

  pause(): boolean {
    const paused = this.player.pause(true);
    if (paused) this.notify();
    return paused;
  }

  resume(): boolean {
    const resumed = this.player.unpause();
    if (resumed) this.notify();
    return resumed;
  }

  setVolume(percent: number): void {
    this.volume = Math.min(150, Math.max(0, percent)) / 100;
    const resource =
      this.player.state.status === AudioPlayerStatus.Playing ||
      this.player.state.status === AudioPlayerStatus.Paused ||
      this.player.state.status === AudioPlayerStatus.Buffering
        ? this.player.state.resource
        : undefined;
    resource?.volume?.setVolume(this.volume);
    this.notify();
  }

  stop(): void {
    this.resetPlayback();
    this.notify();
  }

  async takeSession(): Promise<{ tracks: QueueItem[]; volume: number }> {
    return this.withLock(async () => {
      const volume = this.volumePercent;
      const tracks = this.resetPlayback();
      this.notify();
      return { tracks, volume };
    });
  }

  copySession(): { tracks: QueueItem[]; volume: number } {
    return {
      volume: this.volumePercent,
      tracks: [...(this.current ? [this.current.track] : []), ...this.queue],
    };
  }

  leave(): void {
    this.resetPlayback();
    this.notify();
  }

  async moveTo(channel: VoiceBasedChannel): Promise<void> {
    return this.withLock(async () => {
      await this.ensureConnected(channel);
      this.notify();
    });
  }

  private rememberCurrent(): void {
    const track = this.current?.track;
    if (!track) return;
    this.played.splice(0, this.played.length, ...rememberPlayedTrack(this.played, { ...track }));
  }

  private resetPlayback(): QueueItem[] {
    this.rememberCurrent();
    const tracks = [...(this.current ? [this.current.track] : []), ...this.queue];
    this.stopped = true;
    this.queue.length = 0;
    this.current = undefined;
    this.player.stop(true);
    this.transcode?.stop();
    this.transcode = undefined;
    this.destroyConnection(this.connection);
    this.connection = undefined;
    this.stopped = false;
    return tracks;
  }

  private notify(): void {
    for (const listener of this.statusListeners) listener();
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const waitFor = this.opLock;
    let release!: () => void;
    this.opLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await waitFor;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private destroyConnection(connection: VoiceConnection | undefined): void {
    if (!connection) return;
    if (this.connection === connection) this.connection = undefined;
    if (connection.state.status === VoiceConnectionStatus.Destroyed) return;
    try {
      connection.destroy();
    } catch (error) {
      console.warn("[crate] voice destroy failed:", error);
    }
  }

  private attachConnection(connection: VoiceConnection): void {
    connection.on("error", (error) => {
      console.error(`[crate] voice connection error in guild ${this.guildId}:`, error);
    });
    connection.on("stateChange", (oldState, newState) => {
      if (oldState.status !== newState.status) {
        console.log(`[crate] voice ${oldState.status} -> ${newState.status}`);
        this.notify();
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (this.connection === connection) {
        this.connection = undefined;
        this.notify();
      }
    });
  }

  private async ensureConnected(channel: VoiceBasedChannel): Promise<void> {
    return withVoiceJoinLock(() => this.connectVoice(channel));
  }

  private async connectVoice(channel: VoiceBasedChannel): Promise<void> {
    const existing = this.connection;
    if (existing?.joinConfig.channelId === channel.id) {
      const status = existing.state.status;
      if (status === VoiceConnectionStatus.Ready) {
        existing.subscribe(this.player);
        return;
      }
      if (status === VoiceConnectionStatus.Signalling || status === VoiceConnectionStatus.Connecting) {
        try {
          await entersState(existing, VoiceConnectionStatus.Ready, 30_000);
          if (this.connection !== existing) {
            throw new Error("Discord voice connection was replaced before it became ready.");
          }
          existing.subscribe(this.player);
          console.log("[crate] voice ready");
          this.notify();
          return;
        } catch (error) {
          this.destroyConnection(existing);
          throw new Error(
            "Discord voice never became ready. Need DAVE encryption (@discordjs/voice 0.19) and outbound UDP (network_mode: host).",
            { cause: error },
          );
        }
      }
    }

    this.destroyConnection(existing);

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      group: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      daveEncryption: true,
    });
    this.connection = connection;
    this.attachConnection(connection);
    console.log(`[crate] joining voice channel ${channel.id}`);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
      this.destroyConnection(connection);
      this.notify();
      throw new Error(
        "Discord voice never became ready. Need DAVE encryption (@discordjs/voice 0.19) and outbound UDP (network_mode: host).",
        { cause: error },
      );
    }
    if (this.connection !== connection || connection.state.status !== VoiceConnectionStatus.Ready) {
      throw new Error("Discord voice connection was replaced before it became ready.");
    }
    connection.subscribe(this.player);
    console.log("[crate] voice ready");
    this.notify();
  }

  private async advance(): Promise<boolean> {
    this.rememberCurrent();
    const next = this.queue.shift();
    if (!next) {
      this.current = undefined;
      this.notify();
      return false;
    }
    try {
      await this.playTrack(next);
      return true;
    } catch (error) {
      console.error(`[crate] failed to start ${next.title}:`, error);
      return this.advance();
    }
  }

  private async playTrack(track: QueueItem): Promise<void> {
    const url = track.streamUrl ?? this.needle.streamUrl(track.fileId);
    console.log(`[crate] fetching stream for ${track.title} (${url})`);
    this.transcode?.stop();
    this.transcode = undefined;
    const webStream = await this.needle.openStream(track);
    const input = Readable.fromWeb(webStream, { highWaterMark: 1_048_576 });
    const transcode = await transcodeToPcm(input);
    this.transcode = transcode;
    const resource = createAudioResource(transcode.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track,
    });
    resource.volume?.setVolume(this.volume);
    this.starting = true;
    this.current = { track, startedAt: Date.now() };
    this.notify();
    try {
      this.player.play(resource);
      await entersState(this.player, AudioPlayerStatus.Playing, 20_000);
      console.log(`[crate] playing ${track.title}`);
    } catch (error) {
      transcode.stop();
      if (this.transcode === transcode) this.transcode = undefined;
      throw error;
    } finally {
      this.starting = false;
    }
  }
}

export class PlayerManager {
  private readonly players = new Map<string, GuildPlayer>();
  private readonly listeners = new Set<StatusListener>();

  constructor(private readonly needle: DroppedNeedleClient) {}

  get(guildId: string): GuildPlayer {
    const existing = this.players.get(guildId);
    if (existing) return existing;
    const created = new GuildPlayer(guildId, this.needle);
    created.onStatus(() => this.emit());
    this.players.set(guildId, created);
    return created;
  }

  leaveOthers(exceptGuildId: string): void {
    for (const [guildId, player] of this.players) {
      if (guildId !== exceptGuildId) player.leave();
    }
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
