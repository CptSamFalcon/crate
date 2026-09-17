import { z } from "zod";

const schema = z
  .object({
    DISCORD_TOKEN: z.string().min(1, "TOKEN or DISCORD_TOKEN is required"),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_GUILD_ID: z.string().optional(),
    DROPPEDNEEDLE_URL: z
      .string()
      .url()
      .default("https://music.samflixplusprime.org"),
    DROPPEDNEEDLE_TOKEN: z.string().optional(),
    DROPPEDNEEDLE_USERNAME: z.string().optional(),
    DROPPEDNEEDLE_PASSWORD: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.DROPPEDNEEDLE_TOKEN && (!value.DROPPEDNEEDLE_USERNAME || !value.DROPPEDNEEDLE_PASSWORD)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Set DROPPEDNEEDLE_TOKEN, or both DROPPEDNEEDLE_USERNAME and DROPPEDNEEDLE_PASSWORD",
      });
    }
  });

export type AppConfig = z.infer<typeof schema> & {
  droppedNeedleUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.parse({
    DISCORD_TOKEN: first(env.DISCORD_TOKEN, env.TOKEN),
    DISCORD_CLIENT_ID: first(env.DISCORD_CLIENT_ID, env.CLIENT_ID),
    DISCORD_GUILD_ID: first(env.DISCORD_GUILD_ID, env.GUILD_ID),
    DROPPEDNEEDLE_URL: first(env.DROPPEDNEEDLE_URL),
    DROPPEDNEEDLE_TOKEN: first(env.DROPPEDNEEDLE_TOKEN),
    DROPPEDNEEDLE_USERNAME: first(env.DROPPEDNEEDLE_USERNAME),
    DROPPEDNEEDLE_PASSWORD: first(env.DROPPEDNEEDLE_PASSWORD),
  });

  return {
    ...parsed,
    droppedNeedleUrl: parsed.DROPPEDNEEDLE_URL.replace(/\/+$/, ""),
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
