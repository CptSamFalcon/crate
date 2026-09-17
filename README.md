# Rou

Self-hosted Discord music bot that plays from [DroppedNeedle](https://droppedneedle.com).

Slash commands: `/play`, `/album`, `/search`, `/skip`, `/pause`, `/resume`, `/stop`, `/queue`, `/nowplaying`, `/volume`, `/leave`.

## Dockge

The image is `ghcr.io/cptsamfalcon/rou:latest`. Dockge only needs this compose file plus a host `.env` — not the git checkout.

1. In Dockge, **+ Compose**, name the stack `rou`, paste:

```yaml
services:
  rou:
    image: ghcr.io/cptsamfalcon/rou:latest
    container_name: rou
    restart: unless-stopped
    env_file: .env
    environment:
      TZ: UTC
```

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

## Local run

```bash
cp .env.example .env
npm install
npm start
```
