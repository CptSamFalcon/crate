# Rou

Self-hosted Discord music bot that plays from [DroppedNeedle](https://droppedneedle.com).

Slash commands: `/play`, `/album`, `/search`, `/skip`, `/pause`, `/resume`, `/stop`, `/queue`, `/nowplaying`, `/volume`, `/leave`.

Optional web dashboard: search and control the same Discord queue. Audio still only plays in Discord.

## Dockge

The image is `ghcr.io/cptsamfalcon/rou-bot:latest`. Dockge only needs this compose file plus a host `.env` — not the git checkout.

1. In Dockge, **+ Compose**, name the stack `rou-bot`, paste:

```yaml
services:
  rou:
    image: ghcr.io/cptsamfalcon/rou-bot:latest
    container_name: rou-bot
    restart: unless-stopped
    network_mode: host
    env_file: .env
    environment:
      TZ: UTC
      NODE_OPTIONS: --dns-result-order=ipv4first
```

`network_mode: host` is required so Discord voice UDP can leave the machine. A Docker bridge network will join the channel, then stall (`signalling` ↔ `connecting`) with no audio. Host networking also exposes the dashboard on `WEB_PORT` (default `8787`).

2. In the env editor:

```env
TOKEN=
GUILD_ID=
DROPPEDNEEDLE_URL=https://your-droppedneedle.example
DROPPEDNEEDLE_USERNAME=
DROPPEDNEEDLE_PASSWORD=
```

`TOKEN` is your Discord bot token. Client id is read after login. Use a dedicated DroppedNeedle **Trusted** user for Rou. `DROPPEDNEEDLE_URL` is your DroppedNeedle base URL (no trailing slash).

3. Deploy. Later updates: Dockge **Update** (pulls a new `:latest`) then start.

If the GHCR package is private, log the Dockge host into GitHub Container Registry once (`docker login ghcr.io`). You can also set the package to Public under the repo’s Packages settings so pulls need no login.

If another bot is still using the same Discord token, stop it first.

## Web dashboard

The dashboard is off until these are set:

```env
WEB_PUBLIC_URL=https://rou.yourdomain
WEB_PORT=8787
CLIENT_SECRET=
GUILD_ID=
```

Discord OAuth only allows HTTP on localhost. For a real hostname, `WEB_PUBLIC_URL` must be HTTPS (same reverse proxy you use for DroppedNeedle, forwarding to the Dockge host on port `8787`).

In the Discord Developer Portal, add this exact redirect:

`https://rou.yourdomain/auth/callback`

`CLIENT_SECRET` is the OAuth2 client secret for the same Discord application as the bot. Only members of `GUILD_ID` can sign in. Playback from the browser stays in the current voice channel, or joins a populated one, then the first joinable channel.

## Local run

```bash
cp .env.example .env
npm install
npm start
```
