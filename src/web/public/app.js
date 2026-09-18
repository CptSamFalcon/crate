const loginEl = document.querySelector("#login");
const appEl = document.querySelector("#app");
const loginError = document.querySelector("#login-error");
const resultsEl = document.querySelector("#results");
const queueEl = document.querySelector("#queue");
const requestsEl = document.querySelector("#requests");
const searchStatus = document.querySelector("#search-status");
const volumeInput = document.querySelector("#volume");
const volumeLabel = document.querySelector("#volume-label");
const coverEl = document.querySelector("#cover");
const coverWrap = document.querySelector("#cover-wrap");
const ambientEl = document.querySelector("#ambient");
const stageEl = document.querySelector("#stage");
const browseEl = document.querySelector("#browse");
const albumView = document.querySelector("#album-view");
const artistView = document.querySelector("#artist-view");
const albumTracksEl = document.querySelector("#album-tracks");
const artistAlbumsEl = document.querySelector("#artist-albums");
const libraryEmpty = document.querySelector("#library-empty");
const searchSkeleton = document.querySelector("#search-skeleton");
const playPauseBtn = document.querySelector("#play-pause");

coverEl.addEventListener("error", () => {
  const current = status?.nowPlaying;
  if (current?.albumMbid && coverEl.dataset.fallback !== "caa") {
    coverEl.dataset.fallback = "caa";
    coverEl.src = `https://coverartarchive.org/release-group/${current.albumMbid}/front-500`;
    return;
  }
  coverEl.removeAttribute("src");
  coverWrap.classList.remove("has-art", "is-swap");
  stageEl.classList.remove("has-art");
  ambientEl.removeAttribute("src");
});
coverEl.addEventListener("load", () => {
  if (!coverEl.getAttribute("src")) return;
  coverWrap.classList.add("has-art");
  stageEl.classList.add("has-art");
  coverWrap.classList.remove("is-swap");
  if (ambientEl.getAttribute("src") !== coverEl.src) ambientEl.src = coverEl.src;
});

const LOGIN_ERRORS = {
  oauth: "Discord login failed. Try again.",
  not_in_guild: "That Discord account is not in a server with Crate.",
};

let status = null;
let elapsedTimer = null;
let openAlbum = null;
let openArtist = null;
let albumReturn = "browse";
let requestPoll = 0;
let pendingGuildId = null;
let joining = false;
let hasSearched = false;

function formatClock(seconds) {
  const whole = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "?:??";
  return formatClock(seconds);
}

function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  return `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`;
}

function showLogin(message) {
  appEl.classList.add("hidden");
  loginEl.classList.remove("hidden");
  if (message) {
    loginError.textContent = message;
    loginError.classList.remove("hidden");
  }
}

function showApp() {
  loginEl.classList.add("hidden");
  appEl.classList.remove("hidden");
}

async function api(path, options) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (response.status === 401) {
    showLogin();
    throw new Error("Unauthorized");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setBusy(message) {
  searchStatus.textContent = message;
}

function setVolumeFill(value) {
  volumeInput.style.setProperty("--fill", `${(Number(value) / 150) * 100}%`);
}

function syncLibraryClass() {
  const open =
    hasSearched ||
    !albumView.classList.contains("hidden") ||
    !artistView.classList.contains("hidden");
  document.body.classList.toggle("has-library", open);
}

function closeMenus(except) {
  for (const menu of document.querySelectorAll(".menu")) {
    if (menu === except) continue;
    menu.hidden = true;
  }
  for (const button of document.querySelectorAll("[aria-expanded='true']")) {
    if (except && button.nextElementSibling === except) continue;
    if (except && button.parentElement?.contains(except)) continue;
    button.setAttribute("aria-expanded", "false");
  }
}

function bindMenu(button, menu) {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    closeMenus(open ? menu : null);
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
}

bindMenu(document.querySelector("#user-button"), document.querySelector("#user-menu"));
bindMenu(document.querySelector("#server-button"), document.querySelector("#server-menu"));
bindMenu(document.querySelector("#channel-button"), document.querySelector("#channel-menu"));

document.addEventListener("click", () => closeMenus());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
    if (document.body.classList.contains("is-party")) exitParty();
  }
});

function renderStatus(next) {
  status = next;
  const current = next.nowPlaying;
  const locked = next.canControl === false;
  document.querySelector("#title").textContent = current ? current.title : "Nothing playing";
  document.querySelector("#artist").textContent = current
    ? current.artist
    : "Search the crate to find music.";
  document.querySelector("#now-eyebrow").textContent = current
    ? next.paused
      ? "Paused"
      : "Now playing"
    : "Ready";
  document.body.classList.toggle("is-idle", !current);
  document.body.classList.toggle("is-playing", Boolean(current) && !next.paused);
  document.body.classList.toggle("is-paused", Boolean(current) && next.paused);
  const addedBy = document.querySelector("#added-by");
  if (current?.requestedBy) {
    addedBy.textContent = `Added by ${current.requestedBy}`;
    addedBy.classList.remove("hidden");
  } else {
    addedBy.textContent = "";
    addedBy.classList.add("hidden");
  }
  const albumBtn = document.querySelector("#album");
  albumBtn.textContent = current?.album ?? "";
  albumBtn.dataset.albumId = current?.albumMbid ?? "";
  renderGuildPicker(next);
  if (!pendingGuildId) renderChannelPicker(next.channels ?? [], next.channelId);
  renderVoiceState(next);

  const nextSrc = current?.coverUrl || "";
  if (!nextSrc) {
    coverEl.removeAttribute("src");
    ambientEl.removeAttribute("src");
    delete coverEl.dataset.fallback;
    coverWrap.classList.remove("has-art", "is-swap");
    stageEl.classList.remove("has-art");
  } else if (coverEl.getAttribute("src") !== nextSrc) {
    coverWrap.classList.add("is-swap");
    delete coverEl.dataset.fallback;
    coverEl.src = nextSrc;
  }

  volumeInput.value = String(next.volume);
  volumeLabel.textContent = `${next.volume}%`;
  volumeInput.disabled = locked;
  setVolumeFill(next.volume);
  renderQueue(current, next.queue ?? []);
  renderTransport(next);
  tickElapsed();
}

function renderVoiceState(next) {
  const connected = Boolean(next.channelId);
  const label = document.querySelector("#channel-label");
  const state = document.querySelector("#voice-state");
  const dot = document.querySelector("#voice-dot");
  const members = document.querySelector("#member-count");
  const channel = (next.channels ?? []).find((item) => item.id === next.channelId);
  if (joining) {
    state.textContent = "Joining";
    label.textContent = pendingGuildId ? "Pick a voice channel" : next.channelName || "Voice channel";
    dot.dataset.state = "busy";
  } else if (connected) {
    state.textContent = next.paused ? "Paused" : "Connected";
    label.textContent = next.channelName || "Voice";
    dot.dataset.state = next.paused ? "paused" : "on";
  } else {
    state.textContent = "Disconnected";
    label.textContent = "Choose a voice channel";
    dot.dataset.state = "off";
  }
  if (connected && channel?.memberCount) {
    members.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-people"></use></svg>${channel.memberCount}`;
    members.classList.remove("hidden");
  } else {
    members.textContent = "";
    members.classList.add("hidden");
  }
}

function renderTransport(next) {
  const locked = next.canControl === false;
  const playing = Boolean(next.nowPlaying);
  playPauseBtn.disabled = locked || !playing;
  playPauseBtn.classList.toggle("is-playing", playing && !next.paused);
  playPauseBtn.dataset.action = next.paused || !playing ? "resume" : "pause";
  playPauseBtn.setAttribute("aria-label", playing && !next.paused ? "Pause" : "Play");
  for (const button of document.querySelectorAll(".transport [data-action='skip'], .transport [data-action='stop']")) {
    button.disabled = locked || !playing;
  }
}

function queueRow(track, { now = false, index = 0 } = {}) {
  const item = document.createElement("li");
  if (now) item.className = "is-now";
  const art = `<span class="queue-thumb">${track.coverUrl ? `<img src="${escapeHtml(track.coverUrl)}" alt="">` : ""}</span>`;
  const who = track.requestedBy ? ` · ${escapeHtml(track.requestedBy)}` : "";
  const marker = now ? "Now" : String(index + 1).padStart(2, "0");
  item.innerHTML = `<span class="queue-index">${marker}</span>${art}<span class="queue-copy"><b>${escapeHtml(track.title)}</b><small>${escapeHtml(track.artist)}${who}</small></span><span class="muted">${formatDuration(track.durationSeconds)}</span>`;
  bindCover(item.querySelector("img"));
  return item;
}

function renderQueue(current, queue) {
  queueEl.innerHTML = "";
  document.querySelector("#queue-count").textContent = queue.length ? String(queue.length) : "";
  if (!current && queue.length === 0) {
    queueEl.innerHTML = `<li class="empty-row">Nothing queued yet.</li>`;
    return;
  }
  if (current) queueEl.append(queueRow(current, { now: true }));
  queue.forEach((track, index) => {
    const item = queueRow(track, { index });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost-btn";
    remove.setAttribute("aria-label", `Remove ${track.title}`);
    remove.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg>`;
    remove.addEventListener("click", () => void removeQueued(index, remove));
    item.append(remove);
    queueEl.append(item);
  });
}

function renderGuildPicker(next) {
  const picker = document.querySelector("#server-picker");
  const menu = document.querySelector("#server-menu");
  const button = document.querySelector("#server-button");
  const label = document.querySelector("#server-label");
  const icon = document.querySelector("#server-icon");
  const guilds = next.guilds ?? [];
  const active = guilds.find((guild) => guild.id === next.guildId) ?? guilds.find((guild) => guild.active);
  label.textContent = active?.name || next.guildName || (next.canControl === false ? "Bring Crate here…" : "Choose a server");
  if (active?.iconUrl) {
    icon.src = active.iconUrl;
    icon.classList.remove("hidden");
  } else {
    icon.removeAttribute("src");
    icon.classList.add("hidden");
  }
  const canSwitch = guilds.length >= 2 || next.canControl === false;
  button.disabled = !canSwitch;
  picker.classList.toggle("is-static", !canSwitch);
  const signature = `${next.canControl === false ? "take:" : ""}${guilds.map((guild) => guild.id).join(",")}`;
  if (menu.dataset.signature === signature) return;
  menu.dataset.signature = signature;
  menu.innerHTML = "";
  for (const guild of guilds) {
    const item = document.createElement("li");
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "option");
    option.dataset.guildId = guild.id;
    option.setAttribute("aria-selected", String(guild.id === next.guildId));
    const avatar = guild.iconUrl
      ? `<img class="picker-avatar" src="${escapeHtml(guild.iconUrl)}" alt="">`
      : `<span class="picker-avatar"></span>`;
    option.innerHTML = `${avatar}<span>${escapeHtml(guild.name)}</span>`;
    option.addEventListener("click", () => {
      closeMenus();
      void moveGuild(guild.id);
    });
    item.append(option);
    menu.append(item);
  }
}

function channelLabel(channel) {
  if (channel.you && channel.current) return `${channel.name} · you + Crate`;
  if (channel.you) return `${channel.name} · you`;
  if (channel.current) return `${channel.name} · Crate`;
  return channel.name;
}

function renderChannelPicker(channels, selectedId) {
  const menu = document.querySelector("#channel-menu");
  if (!channels.length && !pendingGuildId) {
    if (menu.dataset.signature === "empty") return;
    menu.dataset.signature = "empty";
    menu.innerHTML = `<li class="empty-row">No voice channels available.</li>`;
    return;
  }
  const signature = `${pendingGuildId || ""}:${channels.map((channel) => channel.id).join(",")}`;
  if (menu.dataset.signature === signature) {
    for (const option of menu.querySelectorAll("[data-channel-id]")) {
      option.setAttribute("aria-selected", String(option.dataset.channelId === selectedId));
    }
    return;
  }
  menu.dataset.signature = signature;
  menu.innerHTML = "";
  for (const channel of channels) {
    const item = document.createElement("li");
    const option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "option");
    option.dataset.channelId = channel.id;
    option.setAttribute("aria-selected", String(channel.id === selectedId));
    const count = channel.memberCount ? `<span class="meta">${channel.memberCount}</span>` : "";
    option.innerHTML = `<span>${escapeHtml(channelLabel(channel))}</span>${count}`;
    option.addEventListener("click", () => {
      closeMenus();
      void joinChannel(channel.id);
    });
    item.append(option);
    menu.append(item);
  }
}

function requestStatusClass(item) {
  if (item.ready) return "ready";
  if (item.statusLabel === "Failed" || item.statusLabel === "Cancelled") return "error";
  return "";
}

function renderRequests(items) {
  requestsEl.innerHTML = "";
  document.querySelector("#request-count").textContent = items?.length ? String(items.length) : "";
  if (!items?.length) {
    requestsEl.innerHTML = `<li class="empty-row">No requests right now.</li>`;
    return;
  }
  for (const item of items) {
    const row = document.createElement("li");
    if (item.albumId) row.dataset.albumId = item.albumId;
    row.innerHTML = `<span class="request-copy"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.artist)}${item.requestedBy ? ` · ${escapeHtml(item.requestedBy)}` : ""}</small></span><span class="status ${requestStatusClass(item)}">${escapeHtml(item.statusLabel)}</span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost-btn";
    remove.setAttribute("aria-label", `Remove request ${item.title}`);
    remove.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg>`;
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void removeRequest(item, remove);
    });
    row.append(remove);
    if (item.albumId) {
      row.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        void openAlbumView(item.albumId);
      });
    }
    requestsEl.append(row);
  }
}

async function loadRequests() {
  try {
    const payload = await api("/api/requests");
    renderRequests(payload.items ?? []);
  } catch {
    // Keep the last list if DroppedNeedle is briefly unreachable.
  }
}

async function removeQueued(index, button) {
  if (button) button.disabled = true;
  try {
    const result = await api("/api/queue/remove", {
      method: "POST",
      body: JSON.stringify({ index }),
    });
    if (result.status) renderStatus(result.status);
    setBusy("Removed from the queue.");
  } catch (error) {
    if (button) button.disabled = false;
    setBusy(error.message);
  }
}

async function removeRequest(item, button) {
  if (button) button.disabled = true;
  try {
    const result = await api("/api/requests/remove", {
      method: "POST",
      body: JSON.stringify({ id: item.id, kind: item.kind }),
    });
    renderRequests(result.items ?? []);
    setBusy("Removed from Requests.");
  } catch (error) {
    if (button) button.disabled = false;
    setBusy(error.message);
  }
}

function tickElapsed() {
  clearInterval(elapsedTimer);
  const elapsed = document.querySelector("#elapsed");
  const duration = document.querySelector("#duration");
  const progress = document.querySelector("#progress");
  const current = status?.nowPlaying;
  if (!current) {
    elapsed.textContent = "0:00";
    duration.textContent = "0:00";
    progress.value = 0;
    return;
  }
  const update = () => {
    const total = current.durationSeconds || 0;
    const raw = Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000));
    const seconds = total > 0 ? Math.min(raw, total) : raw;
    elapsed.textContent = formatClock(seconds);
    duration.textContent = total ? formatClock(total) : "?:??";
    progress.value = total > 0 ? Math.min(1000, Math.round((seconds / total) * 1000)) : 0;
  };
  update();
  elapsedTimer = setInterval(update, 1000);
}

function showBrowse() {
  albumView.classList.add("hidden");
  artistView.classList.add("hidden");
  browseEl.classList.remove("hidden");
  openAlbum = null;
  albumReturn = "browse";
  libraryEmpty.classList.toggle("hidden", hasSearched);
  syncLibraryClass();
}

function showArtist() {
  albumView.classList.add("hidden");
  browseEl.classList.add("hidden");
  artistView.classList.remove("hidden");
  albumReturn = "artist";
  syncLibraryClass();
}

function albumBadge(album) {
  if (album.inLibrary) return "";
  return `<span class="badge">${album.requested ? "Requested" : "Request"}</span>`;
}

function bindCover(img) {
  img?.addEventListener("error", () => {
    img.remove();
  });
}

function setHeroImage(cover, url) {
  cover.removeAttribute("src");
  if (!url) return;
  const probe = new Image();
  probe.onload = () => {
    cover.src = url;
  };
  probe.src = url;
}

function appendAlbumCard(container, album, from) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = album.inLibrary ? "album-card" : "album-card requestable";
  if (album.matchedTrack) card.title = `Matched “${album.matchedTrack}”`;
  const art = album.coverUrl ? `<img src="${escapeHtml(album.coverUrl)}" alt="">` : "";
  const year = album.year ? ` · ${album.year}` : "";
  card.innerHTML = `<div class="art-wrap">${art}${albumBadge(album)}</div><b>${escapeHtml(album.title)}</b><span>${escapeHtml(album.artist)}${year}</span>`;
  bindCover(card.querySelector("img"));
  card.addEventListener("click", () => void openAlbumView(album.id, from));
  container.append(card);
}

function appendSection(title) {
  const section = document.createElement("section");
  section.className = "search-section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading);
  resultsEl.append(section);
  return section;
}

function setSearching(on) {
  searchSkeleton.classList.toggle("hidden", !on);
  libraryEmpty.classList.add("hidden");
  if (on) {
    resultsEl.innerHTML = "";
    document.body.classList.add("has-library");
  }
}

function renderSearch(payload) {
  hasSearched = true;
  showBrowse();
  libraryEmpty.classList.add("hidden");
  resultsEl.innerHTML = "";
  const artists = payload.artists ?? [];
  const albums = payload.albums ?? [];
  const tracks = payload.tracks ?? [];
  if (!artists.length && !albums.length && !tracks.length) {
    setBusy(payload.message || "Nothing matched.");
    libraryEmpty.classList.remove("hidden");
    libraryEmpty.querySelector("h2").textContent = "Nothing in this crate";
    libraryEmpty.querySelector("p").textContent = payload.message || "Try another artist, album, or track.";
    return;
  }
    libraryEmpty.querySelector("h2").textContent = "Find something to play";
    libraryEmpty.querySelector("p").textContent = "Search artists, albums, or tracks.";
  const parts = [];
  if (artists.length) parts.push(`${artists.length} artist${artists.length === 1 ? "" : "s"}`);
  if (albums.length) {
    const onCrate = albums.filter((album) => album.inLibrary).length;
    const toRequest = albums.length - onCrate;
    if (onCrate) parts.push(`${onCrate} album${onCrate === 1 ? "" : "s"} on the crate`);
    if (toRequest) parts.push(`${toRequest} to request`);
  }
  if (tracks.length) parts.push(`${tracks.length} track${tracks.length === 1 ? "" : "s"}`);
  setBusy(parts.join(" · "));

  if (artists.length) {
    const section = appendSection("Artists");
    const row = document.createElement("div");
    row.className = "artist-row";
    for (const artist of artists) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "artist-card";
      card.title = artist.disambiguation ? `${artist.name} (${artist.disambiguation})` : artist.name;
      const art = artist.coverUrl ? `<img src="${escapeHtml(artist.coverUrl)}" alt="">` : "";
      card.innerHTML = `<div class="art-wrap">${art}</div><b>${escapeHtml(artist.name)}</b><span class="muted">Artist</span>`;
      bindCover(card.querySelector("img"));
      card.addEventListener("click", () => void openArtistView(artist.id));
      row.append(card);
    }
    section.append(row);
  }

  if (albums.length) {
    const section = appendSection("Albums");
    const grid = document.createElement("div");
    grid.className = "album-grid";
    for (const album of albums) appendAlbumCard(grid, album, "browse");
    section.append(grid);
  }

  if (tracks.length) {
    const section = appendSection("Tracks");
    const list = document.createElement("ol");
    list.className = "tracklist search-tracks";
    for (const track of tracks) {
      const item = document.createElement("li");
      const art = `<span class="result-thumb">${track.coverUrl ? `<img src="${escapeHtml(track.coverUrl)}" alt="">` : ""}</span>`;
      const albumLink = track.albumMbid
        ? `<button type="button" class="album-link" data-album-id="${escapeHtml(track.albumMbid)}">${escapeHtml(track.album)}</button>`
        : escapeHtml(track.album || "");
      const subtitle = [escapeHtml(track.artist), albumLink].filter(Boolean).join(" · ");
      item.innerHTML = `${art}<span class="track-copy"><b>${escapeHtml(track.title)}</b><small>${subtitle}</small></span><span class="muted">${formatDuration(track.durationSeconds)}</span>`;
      const action = document.createElement("button");
      action.className = "action-btn";
      if (track.fileId) {
        action.textContent = "Play";
        action.addEventListener("click", () => void play({ fileId: track.fileId }));
      } else if (track.recordingMbid) {
        action.textContent = "Request";
        action.addEventListener("click", () =>
          void requestMedia(
            {
              albumId: track.albumMbid,
              recordingMbid: track.recordingMbid,
              title: track.title,
              durationSeconds: track.durationSeconds,
            },
            action,
          ),
        );
      } else {
        action.textContent = "Play";
        action.disabled = true;
      }
      item.append(action);
      item.querySelector("[data-album-id]")?.addEventListener("click", (event) => {
        event.preventDefault();
        void openAlbumView(event.currentTarget.dataset.albumId, "browse");
      });
      bindCover(item.querySelector("img"));
      list.append(item);
    }
    section.append(list);
  }
}

function paintAlbumAction() {
  const btn = document.querySelector("#queue-album-btn");
  const note = document.querySelector("#album-note");
  if (!openAlbum?.album) return;
  const album = openAlbum.album;
  btn.disabled = false;
  if (album.inLibrary) {
    btn.textContent = "Queue album";
    note.classList.add("hidden");
    note.textContent = "";
    return;
  }
  note.classList.remove("hidden");
  if (!album.id || (!/^[0-9a-f-]{36}$/i.test(album.id) && !openAlbum.tracks.some((track) => track.recordingMbid))) {
    btn.textContent = "Can't request";
    btn.disabled = true;
    note.textContent = "No MusicBrainz id, so Crate can't request this one.";
    return;
  }
  if (album.requested) {
    btn.textContent = "Requested";
    btn.disabled = true;
    note.textContent = "Waiting on DroppedNeedle. It'll land on the crate after it imports.";
    return;
  }
  btn.textContent = "Request album";
  note.textContent = "Not on the media server yet. Request it through Crate.";
}

async function openAlbumView(albumId, from = "browse") {
  albumReturn = from;
  setBusy("Opening album…");
  try {
    const detail = await api(`/api/albums/${encodeURIComponent(albumId)}`);
    openAlbum = detail;
    browseEl.classList.add("hidden");
    artistView.classList.add("hidden");
    albumView.classList.remove("hidden");
    syncLibraryClass();
    document.querySelector("#album-title").textContent = detail.album.title;
    document.querySelector("#album-artist").textContent = detail.album.artist;
    document.querySelector("#album-year").textContent = detail.album.year ? String(detail.album.year) : "Album";
    const matched = document.querySelector("#album-matched");
    if (detail.album.matchedTrack) {
      matched.textContent = `Matched “${detail.album.matchedTrack}”`;
      matched.classList.remove("hidden");
    } else {
      matched.classList.add("hidden");
    }
    paintAlbumAction();
    setHeroImage(document.querySelector("#album-cover"), detail.album.coverUrl);
    albumTracksEl.innerHTML = "";
    for (const [index, track] of detail.tracks.entries()) {
      const item = document.createElement("li");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(track.trackNumber || index + 1);
      const name = document.createElement("span");
      name.className = "track-copy";
      name.innerHTML = `<b>${escapeHtml(track.title)}</b>`;
      const time = document.createElement("span");
      time.className = "muted";
      time.textContent = formatDuration(track.durationSeconds);
      const action = document.createElement("button");
      action.className = "action-btn";
      if (track.fileId) {
        action.textContent = "Play";
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          void play({ fileId: track.fileId });
        });
      } else if (track.recordingMbid) {
        action.textContent = "Request";
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          void requestMedia(
            {
              albumId: detail.album.id,
              recordingMbid: track.recordingMbid,
              title: track.title,
              durationSeconds: track.durationSeconds,
            },
            action,
          );
        });
      } else {
        action.textContent = "Request";
        action.disabled = true;
      }
      item.append(num, name, time, action);
      albumTracksEl.append(item);
    }
    setBusy(
      detail.album.inLibrary
        ? `${detail.tracks.length} tracks`
        : `${detail.tracks.length} tracks · request to add`,
    );
  } catch (error) {
    setBusy(error.message);
  }
}

async function openArtistView(artistId) {
  setBusy("Opening artist…");
  try {
    const detail = await api(`/api/artists/${encodeURIComponent(artistId)}`);
    openArtist = detail;
    showArtist();
    document.querySelector("#artist-name").textContent = detail.artist.name;
    const meta = [detail.artist.disambiguation, detail.artist.inLibrary ? "On the crate" : null]
      .filter(Boolean)
      .join(" · ");
    document.querySelector("#artist-meta").textContent = meta;
    setHeroImage(document.querySelector("#artist-cover"), detail.artist.coverUrl);
    artistAlbumsEl.innerHTML = "";
    for (const album of detail.albums ?? []) appendAlbumCard(artistAlbumsEl, album, "artist");
    setBusy(`${detail.albums?.length ?? 0} releases`);
  } catch (error) {
    setBusy(error.message);
  }
}

async function play(body) {
  setBusy("Sending to Crate…");
  try {
    const result = await api("/api/play", { method: "POST", body: JSON.stringify(body) });
    setBusy(result.position === 0 ? "Playing now." : `Queued #${result.position}.`);
    if (result.status) renderStatus(result.status);
  } catch (error) {
    setBusy(error.message);
  }
}

async function requestMedia(body, button) {
  if (button) button.disabled = true;
  setBusy("Requesting through Crate…");
  try {
    const result = await api("/api/request", { method: "POST", body: JSON.stringify(body) });
    setBusy(result.message || "Requested.");
    if (openAlbum && result.album) {
      openAlbum.album = result.album;
      paintAlbumAction();
    }
    if (button && !body.recordingMbid) paintAlbumAction();
    if (button && body.recordingMbid) {
      button.textContent = result.status === "already_in_library" ? "On crate" : "Requested";
    }
    await loadRequests();
  } catch (error) {
    if (button) button.disabled = false;
    setBusy(error.message);
  }
}

async function queueOpenAlbum() {
  if (!openAlbum?.album.id) return;
  try {
    if (!openAlbum.album.inLibrary) {
      await requestMedia({ albumId: openAlbum.album.id }, document.querySelector("#queue-album-btn"));
      return;
    }
    setBusy("Queueing album…");
    const result = await api("/api/album", {
      method: "POST",
      body: JSON.stringify({ albumId: openAlbum.album.id }),
    });
    setBusy(`Queued ${result.count} tracks.`);
    if (result.status) renderStatus(result.status);
  } catch (error) {
    setBusy(error.message);
  }
}

async function moveGuild(guildId) {
  if (!guildId) return;
  if (pendingGuildId && guildId === status?.guildId) {
    pendingGuildId = null;
    renderChannelPicker(status.channels ?? [], status.channelId);
    setBusy("Staying put.");
    return;
  }
  if (!pendingGuildId && guildId === status?.guildId) return;
  joining = true;
  renderVoiceState(status ?? {});
  setBusy("Moving Crate…");
  try {
    const dest = await api(`/api/channels?guildId=${encodeURIComponent(guildId)}`);
    const yours = dest.channels?.find((channel) => channel.you);
    const result = await api("/api/guild", {
      method: "POST",
      body: JSON.stringify({ guildId, channelId: yours?.id }),
    });
    pendingGuildId = null;
    if (result.status) renderStatus(result.status);
    await refreshChannels();
    setBusy(result.status?.guildName ? `Crate is in ${result.status.guildName}.` : "Moved.");
  } catch (error) {
    if (error.status === 409 && error.payload?.channels) {
      pendingGuildId = error.payload.guildId || guildId;
      renderChannelPicker(error.payload.channels, "");
      setBusy(error.message);
    } else {
      pendingGuildId = null;
      setBusy(error.message);
    }
  } finally {
    joining = false;
    if (status) renderVoiceState(status);
  }
}

async function joinChannel(channelId) {
  if (!channelId) return;
  if (!pendingGuildId && channelId === status?.channelId) return;
  joining = true;
  renderVoiceState(status ?? {});
  setBusy(pendingGuildId ? "Moving Crate…" : "Joining voice…");
  try {
    const result = pendingGuildId
      ? await api("/api/guild", {
          method: "POST",
          body: JSON.stringify({ guildId: pendingGuildId, channelId }),
        })
      : await api("/api/channel", {
          method: "POST",
          body: JSON.stringify({ channelId }),
        });
    pendingGuildId = null;
    if (result.status) renderStatus(result.status);
    await refreshChannels();
    setBusy(result.status?.channelName ? `Crate is in ${result.status.channelName}.` : "Joined.");
  } catch (error) {
    setBusy(error.message);
  } finally {
    joining = false;
    if (status) renderVoiceState(status);
  }
}

document.querySelector("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#query").value.trim();
  if (!query) return;
  hasSearched = true;
  setSearching(true);
  setBusy("Searching…");
  try {
    renderSearch(await api(`/api/search?q=${encodeURIComponent(query)}`));
  } catch (error) {
    setBusy(error.message);
    libraryEmpty.classList.remove("hidden");
  } finally {
    setSearching(false);
    if (hasSearched && resultsEl.children.length) libraryEmpty.classList.add("hidden");
    syncLibraryClass();
  }
});

document.querySelector("#back-btn").addEventListener("click", () => {
  if (albumReturn === "artist" && openArtist) {
    showArtist();
    setBusy(`${openArtist.albums?.length ?? 0} releases`);
    return;
  }
  showBrowse();
});
document.querySelector("#artist-back-btn").addEventListener("click", showBrowse);
document.querySelector("#queue-album-btn").addEventListener("click", () => void queueOpenAlbum());
document.querySelector("#album").addEventListener("click", () => {
  const id = document.querySelector("#album").dataset.albumId;
  if (id) void openAlbumView(id, "browse");
});

document.querySelector(".transport").addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  try {
    await api(`/api/${action}`, { method: "POST", body: "{}" });
  } catch (error) {
    setBusy(error.message);
  }
});

let volumeTimer = 0;
volumeInput.addEventListener("input", () => {
  volumeLabel.textContent = `${volumeInput.value}%`;
  setVolumeFill(volumeInput.value);
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    void api("/api/volume", {
      method: "POST",
      body: JSON.stringify({ percent: Number(volumeInput.value) }),
    }).catch((error) => {
      setBusy(error.message);
    });
  }, 150);
});

function partyButton() {
  return document.querySelector("#party-btn");
}

async function enterParty() {
  document.body.classList.add("is-party");
  partyButton().setAttribute("aria-pressed", "true");
  partyButton().setAttribute("aria-label", "Exit party mode");
  try {
    await stageEl.requestFullscreen?.();
  } catch {
    // App-level full view is enough if the Fullscreen API is blocked.
  }
}

async function exitParty() {
  document.body.classList.remove("is-party");
  partyButton().setAttribute("aria-pressed", "false");
  partyButton().setAttribute("aria-label", "Enter party mode");
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // ignore
    }
  }
}

partyButton().addEventListener("click", () => {
  if (document.body.classList.contains("is-party")) void exitParty();
  else void enterParty();
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && document.body.classList.contains("is-party")) {
    document.body.classList.remove("is-party");
    partyButton().setAttribute("aria-pressed", "false");
    partyButton().setAttribute("aria-label", "Enter party mode");
  }
});

async function refreshChannels() {
  if (pendingGuildId) return;
  try {
    const guildId = status?.guildId;
    const payload = await api(`/api/channels${guildId ? `?guildId=${encodeURIComponent(guildId)}` : ""}`);
    renderChannelPicker(payload.channels ?? [], status?.channelId);
    if (status) renderVoiceState({ ...status, channels: payload.channels ?? status.channels });
  } catch {
    // Keep whatever the last status payload had.
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const loginErrorKey = params.get("error");
  if (loginErrorKey) history.replaceState({}, "", "/");
  try {
    const me = await api("/api/me");
    document.querySelector("#username").textContent = me.globalName || me.username;
    document.querySelector("#avatar").src = avatarUrl(me);
    showApp();
    renderStatus(await api("/api/status"));
    await refreshChannels();
    renderRequests([]);
    await loadRequests();
    requestPoll = window.setInterval(() => void loadRequests(), 10_000);
    const events = new EventSource("/api/events");
    events.addEventListener("message", (event) => {
      if (!event.data) return;
      renderStatus(JSON.parse(event.data));
    });
    events.onerror = () => events.close();
  } catch {
    showLogin(LOGIN_ERRORS[loginErrorKey] || (loginErrorKey ? LOGIN_ERRORS.oauth : ""));
  }
}

void boot();
