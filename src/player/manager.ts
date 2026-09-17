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

export class GuildPlayer {
  readonly player: AudioPlayer;
  private connection: VoiceConnection | undefined;
  private readonly queue: QueueItem[] = [];
  private current: NowPlaying | undefined;
  private stopped = false;
  private starting = false;
  private volume = 0.8;
  private transcode: TranscodeSession | undefined;

  constructor(
    readonly guildId: string,
    private readonly needle: DroppedNeedleClient,
  ) {
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    this.player.on("error", (error) => {
      console.error(`[rou] audio error in guild ${guildId}:`, error);
      if (!this.starting) void this.advance();
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.stopped || this.starting) return;
      void this.advance();
    });
  }

  get nowPlaying(): NowPlaying | undefined {
    return this.current;
  }

  get upcoming(): QueueItem[] {
    return [...this.queue];
  }

  get size(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  isIdle(): boolean {
    return !this.current && this.queue.length === 0;
  }

  async enqueue(channel: VoiceBasedChannel, tracks: QueueItem[]): Promise<number> {
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
    }
    return startNow ? 0 : this.queue.length - tracks.length + 1;
  }

  skip(): QueueItem | undefined {
    const skipped = this.current?.track;
    this.player.stop(true);
    return skipped;
  }

  pause(): boolean {
    return this.player.pause(true);
  }

  resume(): boolean {
    return this.player.unpause();
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
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.current = undefined;
    this.player.stop(true);
    this.transcode?.stop();
    this.transcode = undefined;
    this.connection?.destroy();
    this.connection = undefined;
    this.stopped = false;
  }

  private async ensureConnected(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection?.state.status === VoiceConnectionStatus.Ready && this.connection.joinConfig.channelId === channel.id) {
      return;
    }
    if (this.connection) {
      this.connection.destroy();
    }
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      daveEncryption: true,
    });
    this.connection.on("error", (error) => {
      console.error(`[rou] voice connection error in guild ${this.guildId}:`, error);
    });
    this.connection.on("stateChange", (oldState, newState) => {
      if (oldState.status !== newState.status) {
        console.log(`[rou] voice ${oldState.status} -> ${newState.status}`);
      }
    });
    console.log(`[rou] joining voice channel ${channel.id}`);
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      this.connection.destroy();
      this.connection = undefined;
      throw new Error(
        "Discord voice never became ready. Need DAVE encryption (@discordjs/voice 0.19) and outbound UDP (network_mode: host).",
        { cause: error },
      );
    }
    this.connection.subscribe(this.player);
    console.log("[rou] voice ready");
  }

  private async advance(): Promise<boolean> {
    const next = this.queue.shift();
    if (!next) {
      this.current = undefined;
      return false;
    }
    try {
      await this.playTrack(next);
      return true;
    } catch (error) {
      console.error(`[rou] failed to start ${next.title}:`, error);
      return this.advance();
    }
  }

  private async playTrack(track: QueueItem): Promise<void> {
    const url = track.streamUrl ?? this.needle.streamUrl(track.fileId);
    console.log(`[rou] fetching stream for ${track.title} (${url})`);
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
    try {
      this.player.play(resource);
      await entersState(this.player, AudioPlayerStatus.Playing, 20_000);
      console.log(`[rou] playing ${track.title}`);
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

  constructor(private readonly needle: DroppedNeedleClient) {}

  get(guildId: string): GuildPlayer {
    const existing = this.players.get(guildId);
    if (existing) return existing;
    const created = new GuildPlayer(guildId, this.needle);
    this.players.set(guildId, created);
    return created;
  }
}
