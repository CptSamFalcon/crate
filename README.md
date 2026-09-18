# Crate

Self-hosted Discord listening room that plays from [DroppedNeedle](https://droppedneedle.com).

Slash commands: `/play`, `/album`, `/search`, `/skip`, `/pause`, `/resume`, `/stop`, `/queue`, `/nowplaying`, `/volume`, `/leave`.

Optional web dashboard: search and control the same Discord queue. Audio still only plays in Discord.

## Dockge

The image is `ghcr.io/cptsamfalcon/crate:latest`. Dockge only needs this compose file plus a host `.env` — not the git checkout.

1. In Dockge, **+ Compose**, name the stack `crate`, paste:

```yaml
services:
  crate:
    image: ghcr.io/cptsamfalcon/crate:latest
    container_name: crate
    restart: unless-stopped
    network_mode: host
    env_file: .env
    environment:
      TZ: UTC
      NODE_OPTIONS: --dns-result-order=ipv4first
  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: crate-tunnel
    restart: unless-stopped
    network_mode: host
    depends_on:
      - crate
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    command: tunnel --no-autoupdate run
```

`network_mode: host` is required so Discord voice UDP can leave the machine. A Docker bridge network will join the channel, then stall (`signalling` ↔ `connecting`) with no audio. The dashboard listens on `127.0.0.1:WEB_PORT` (default `8787`) so only the tunnel can reach it. Set `WEB_BIND=0.0.0.0` only if you need the LAN to hit it directly.

2. In the env editor:

```env
TOKEN=
GUILD_ID=
DROPPEDNEEDLE_URL=https://your-droppedneedle.example
DROPPEDNEEDLE_USERNAME=
DROPPEDNEEDLE_PASSWORD=
```

`TOKEN` is your Discord bot token. Client id is read after login. Use a dedicated DroppedNeedle **Trusted** user for Crate. `DROPPEDNEEDLE_URL` is your DroppedNeedle base URL (no trailing slash).

3. Deploy. Later updates: Dockge **Update** (pulls a new `:latest`) then start.

If the GHCR package is private, log the Dockge host into GitHub Container Registry once (`docker login ghcr.io`). You can also set the package to Public under the repo’s Packages settings so pulls need no login.

If another bot is still using the same Discord token, stop it first.

## Web dashboard

The dashboard is off until these are set:

```env
WEB_PUBLIC_URL=https://crate.yourdomain
WEB_PORT=8787
CLIENT_SECRET=
GUILD_ID=
CLOUDFLARE_TUNNEL_TOKEN=
SESSION_SECRET=
```

Discord OAuth only allows HTTP on localhost, so the public URL must be HTTPS. The `tunnel` service in the compose file is [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Do not put Cloudflare Access in front of this hostname; Discord OAuth is the lock, and Access would intercept `/auth/callback`.

If this machine already has a tunnel (for example DroppedNeedle), you can skip the `tunnel` service and add a public hostname there instead. Otherwise:

1. Cloudflare Zero Trust → **Networks** → **Tunnels** → **Create a tunnel** → Cloudflared.
2. Copy the token into `CLOUDFLARE_TUNNEL_TOKEN`.
3. **Public hostname**: `crate.yourdomain` → type HTTP → URL `http://127.0.0.1:8787`.
4. Save. Cloudflare will create the DNS record.
5. In the Discord Developer Portal, add this exact redirect:

`https://crate.yourdomain/auth/callback`

Then **Deploy** (or **Update**) the Dockge stack. Crate logs `web UI on http://127.0.0.1:8787` when the dashboard is enabled. The tunnel logs `Registered tunnel connection` when Cloudflare is up.

`CLIENT_SECRET` is the OAuth2 client secret for the same Discord application as the bot. Sign-in is limited to members of a server Crate is in, and playback controls only work for the server you're in. Set `SESSION_SECRET` to a long random string so dashboard sessions survive a token rotation. `GUILD_ID` is the default crate server; if Crate is in more than one, pick the server on the dashboard. Slash commands register in every server Crate joins. Playback stays in the voice channel you pick, or the one you're in.

## Local run

```bash
cp .env.example .env
npm install
npm start
```
