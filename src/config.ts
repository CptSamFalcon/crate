import { z } from "zod";
import { createHash } from "node:crypto";

const schema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, "TOKEN or DISCORD_TOKEN is required"),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_GUILD_ID: z.string().optional(),
    DISCORD_CLIENT_SECRET: z.string().optional(),
    DROPPEDNEEDLE_URL: z.string().url().default("https://music.samflixplusprime.org"),
    DROPPEDNEEDLE_TOKEN: z.string().optional(),
    DROPPEDNEEDLE_USERNAME: z.string().optional(),
    DROPPEDNEEDLE_PASSWORD: z.string().optional(),
    WEB_PUBLIC_URL: z.string().optional(),
    WEB_PORT: z.string().optional(),
    SESSION_SECRET: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.DROPPEDNEEDLE_TOKEN && (!value.DROPPEDNEEDLE_USERNAME || !value.DROPPEDNEEDLE_PASSWORD)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Set DROPPEDNEEDLE_TOKEN, or both DROPPEDNEEDLE_USERNAME and DROPPEDNEEDLE_PASSWORD",
      });
    }
  });

export type WebConfig = {
  publicUrl: string;
  port: number;
  clientSecret: string;
  sessionSecret: string;
  guildId: string;
};

export type AppConfig = z.infer<typeof schema> & {
  droppedNeedleUrl: string;
  web: WebConfig | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse({
    DISCORD_TOKEN: first(env.DISCORD_TOKEN, env.TOKEN),
    DISCORD_CLIENT_ID: first(env.DISCORD_CLIENT_ID, env.CLIENT_ID),
    DISCORD_GUILD_ID: first(env.DISCORD_GUILD_ID, env.GUILD_ID),
    DISCORD_CLIENT_SECRET: first(env.DISCORD_CLIENT_SECRET, env.CLIENT_SECRET),
    DROPPEDNEEDLE_URL: first(env.DROPPEDNEEDLE_URL),
    DROPPEDNEEDLE_TOKEN: first(env.DROPPEDNEEDLE_TOKEN),
    DROPPEDNEEDLE_USERNAME: first(env.DROPPEDNEEDLE_USERNAME),
    DROPPEDNEEDLE_PASSWORD: first(env.DROPPEDNEEDLE_PASSWORD),
    WEB_PUBLIC_URL: first(env.WEB_PUBLIC_URL),
    WEB_PORT: first(env.WEB_PORT),
    SESSION_SECRET: first(env.SESSION_SECRET),
  });

  const publicUrl = parsed.WEB_PUBLIC_URL?.replace(/\/+$/, "");
  const clientSecret = parsed.DISCORD_CLIENT_SECRET;
  const guildId = parsed.DISCORD_GUILD_ID;
  let web: WebConfig | undefined;
  if (publicUrl && clientSecret && guildId) {
    web = {
      publicUrl,
      port: Number(parsed.WEB_PORT) || 8787,
      clientSecret,
      sessionSecret:
        parsed.SESSION_SECRET ?? createHash("sha256").update(parsed.DISCORD_TOKEN).digest("hex"),
      guildId,
    };
  }

  return {
    ...parsed,
    droppedNeedleUrl: parsed.DROPPEDNEEDLE_URL.replace(/\/+$/, ""),
    web,
  };
}

function first(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = strip(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function strip(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/^['"]|['"]$/g, "");
  return trimmed ? trimmed : undefined;
}
