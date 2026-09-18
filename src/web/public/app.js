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
const browseEl = document.querySelector("#browse");
const albumView = document.querySelector("#album-view");
const artistView = document.querySelector("#artist-view");
const albumTracksEl = document.querySelector("#album-tracks");
const artistAlbumsEl = document.querySelector("#artist-albums");

coverEl.addEventListener("error", () => {
  const current = status?.nowPlaying;
  if (current?.albumMbid && coverEl.dataset.fallback !== "caa") {
    coverEl.dataset.fallback = "caa";
    coverEl.src = `https://coverartarchive.org/release-group/${current.albumMbid}/front-500`;
    return;
  }
  coverEl.removeAttribute("src");
  coverWrap.classList.remove("has-art");
});
coverEl.addEventListener("load", () => {
  if (coverEl.getAttribute("src")) coverWrap.classList.add("has-art");
});

const LOGIN_ERRORS = {
  oauth: "Discord login failed. Try again.",
  not_in_guild: "That Discord account is not in a server with Rou.",
};

let status = null;
let elapsedTimer = null;
let openAlbum = null;
let openArtist = null;
let albumReturn = "browse";
let requestPoll = 0;
let pendingGuildId = null;

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "?:??";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
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

function renderStatus(next) {
  status = next;
  const current = next.nowPlaying;
  document.querySelector("#title").textContent = current ? current.title : "Nothing playing";
  document.querySelector("#artist").textContent = current ? current.artist : "Search the crate";
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
  const place = next.channelName
    ? `${next.paused ? "Paused in" : "Live in"} ${next.channelName}`
    : "Not in a voice channel";
  const suffix = next.guildName && (next.guilds?.length ?? 0) < 2 ? ` · ${next.guildName}` : "";
  document.querySelector("#channel").textContent = `${place}${suffix}`;

  const nextSrc = current?.coverUrl || "";
  if (!nextSrc) {
    coverEl.removeAttribute("src");
    delete coverEl.dataset.fallback;
    coverWrap.classList.remove("has-art");
  } else if (coverEl.getAttribute("src") !== nextSrc) {
    delete coverEl.dataset.fallback;
    coverEl.src = nextSrc;
    coverWrap.classList.add("has-art");
  }

  volumeInput.value = String(next.volume);
  volumeLabel.textContent = `${next.volume}%`;

  queueEl.innerHTML = "";
  if (!current && next.queue.length === 0) {
    queueEl.innerHTML = `<li class="muted">Queue is empty.</li>`;
  } else {
    next.queue.forEach((track, index) => {
      const item = document.createElement("li");
      const who = track.requestedBy ? `<small class="muted">Added by ${escapeHtml(track.requestedBy)}</small>` : "";
      item.innerHTML = `<span>${escapeHtml(track.title)}${who}</span><span class="muted">${formatDuration(track.durationSeconds)}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => void removeQueued(index, remove));
      item.append(remove);
      queueEl.append(item);
    });
  }
  tickElapsed();
}

function renderGuildPicker(next) {
  const picker = document.querySelector("#server-picker");
  const select = document.querySelector("#guild");
  const guilds = next.guilds ?? [];
  if (guilds.length < 2) {
    picker.classList.add("hidden");
    return;
  }
  picker.classList.remove("hidden");
  const signature = guilds.map((guild) => guild.id).join(",");
  if (select.dataset.signature !== signature) {
    select.innerHTML = guilds
      .map((guild) => `<option value="${escapeHtml(guild.id)}">${escapeHtml(guild.name)}</option>`)
      .join("");
    select.dataset.signature = signature;
  }
  if (document.activeElement !== select && !pendingGuildId) {
    select.value = next.guildId;
  }
}

function channelLabel(channel) {
  const bits = [];
  if (channel.current) bits.push("Rou");
  if (channel.you) bits.push("you");
  if (channel.memberCount) bits.push(`${channel.memberCount}`);
  return bits.length ? `${channel.name} (${bits.join(", ")})` : channel.name;
}

function renderChannelPicker(channels, selectedId) {
  const picker = document.querySelector("#channel-picker");
  const select = document.querySelector("#voice-channel");
  picker.classList.remove("hidden");
  if (!channels.length && !pendingGuildId) {
    if (select.options.length <= 1) {
      select.innerHTML = `<option value="">Choose a voice channel</option>`;
      select.dataset.signature = "empty";
    }
    return;
  }
  const signature = `${pendingGuildId || ""}:${channels.map((channel) => channel.id).join(",")}`;
  if (select.dataset.signature !== signature) {
    const placeholder = pendingGuildId ? "Pick a voice channel…" : "Choose a voice channel";
    select.innerHTML = `<option value="">${placeholder}</option>${channels
      .map(
        (channel) =>
          `<option value="${escapeHtml(channel.id)}">${escapeHtml(channelLabel(channel))}</option>`,
      )
      .join("")}`;
    select.dataset.signature = signature;
  }
  if (document.activeElement !== select) {
    const current = selectedId || "";
    select.value = current && channels.some((channel) => channel.id === current) ? current : "";
  }
}

function requestStatusClass(item) {
  if (item.ready) return "ready";
  if (item.statusLabel === "Failed" || item.statusLabel === "Cancelled") return "error";
  return "muted";
}

function renderRequests(items) {
  requestsEl.innerHTML = "";
  if (!items?.length) {
    requestsEl.innerHTML = `<li class="muted">Nothing requested.</li>`;
    return;
  }
  for (const item of items) {
    const row = document.createElement("li");
    row.className = item.ready ? "ready" : "";
    if (item.albumId) row.dataset.albumId = item.albumId;
    const who = item.requestedBy ? `<small class="muted">Requested by ${escapeHtml(item.requestedBy)}</small>` : "";
    row.innerHTML = `<span>${escapeHtml(item.title)}<small class="muted"> ${escapeHtml(item.artist)}</small>${who}</span><span class="${requestStatusClass(item)}">${escapeHtml(item.statusLabel)}</span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn";
    remove.textContent = "Remove";
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
    searchStatus.textContent = "Removed from the queue.";
  } catch (error) {
    if (button) button.disabled = false;
    searchStatus.textContent = error.message;
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
    searchStatus.textContent = "Removed from Requests.";
  } catch (error) {
    if (button) button.disabled = false;
    searchStatus.textContent = error.message;
  }
}

function tickElapsed() {
  clearInterval(elapsedTimer);
  const elapsed = document.querySelector("#elapsed");
  const current = status?.nowPlaying;
  if (!current) {
    elapsed.textContent = "";
    return;
  }
  const update = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000));
    elapsed.textContent = `${formatDuration(seconds)} / ${formatDuration(current.durationSeconds)}`;
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
}

function showArtist() {
  albumView.classList.add("hidden");
  browseEl.classList.add("hidden");
  artistView.classList.remove("hidden");
  albumReturn = "artist";
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

function appendAlbumCard(container, album, from) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = album.inLibrary ? "album-card" : "album-card requestable";
  if (album.matchedTrack) card.title = `Matched “${album.matchedTrack}”`;
  const art = album.coverUrl ? `<img src="${escapeHtml(album.coverUrl)}" alt="">` : "";
  card.innerHTML = `<div class="art-wrap">${art}${albumBadge(album)}</div><b>${escapeHtml(album.title)}</b><span>${escapeHtml(album.artist)}</span>`;
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

function renderSearch(payload) {
  showBrowse();
  resultsEl.innerHTML = "";
  const artists = payload.artists ?? [];
  const albums = payload.albums ?? [];
  const tracks = payload.tracks ?? [];
  if (!artists.length && !albums.length && !tracks.length) {
    searchStatus.textContent = payload.message || "Nothing matched.";
    return;
  }
  const parts = [];
  if (artists.length) parts.push(`${artists.length} artist${artists.length === 1 ? "" : "s"}`);
  if (albums.length) {
    const onCrate = albums.filter((album) => album.inLibrary).length;
    const toRequest = albums.length - onCrate;
    if (onCrate) parts.push(`${onCrate} album${onCrate === 1 ? "" : "s"} on the crate`);
    if (toRequest) parts.push(`${toRequest} to request`);
  }
  if (tracks.length) parts.push(`${tracks.length} track${tracks.length === 1 ? "" : "s"}`);
  searchStatus.textContent = parts.join(" · ");

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
      card.innerHTML = `<div class="art-wrap">${art}</div><b>${escapeHtml(artist.name)}</b>`;
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
      const meta = [track.artist, track.album].filter(Boolean).join(" · ");
      const albumLink = track.albumMbid
        ? `<button type="button" class="album-link" data-album-id="${escapeHtml(track.albumMbid)}">${escapeHtml(track.album)}</button>`
        : "";
      const subtitle = track.albumMbid && track.album
        ? `${escapeHtml(track.artist)}${track.artist && track.album ? " · " : ""}${albumLink}`
        : escapeHtml(meta);
      item.innerHTML = `<span><b>${escapeHtml(track.title)}</b><small class="muted">${subtitle}</small></span><span class="muted">${formatDuration(track.durationSeconds)}</span>`;
      const action = document.createElement("button");
      action.className = "btn";
      if (track.fileId) {
        action.textContent = "Add";
        action.addEventListener("click", () => void play({ fileId: track.fileId }));
      } else if (track.recordingMbid) {
        action.textContent = "Request";
        action.addEventListener("click", () =>
          void requestMedia({
            albumId: track.albumMbid,
            recordingMbid: track.recordingMbid,
            title: track.title,
            durationSeconds: track.durationSeconds,
          }, action),
        );
      } else {
        action.textContent = "Add";
        action.disabled = true;
      }
      item.append(action);
      item.querySelector("[data-album-id]")?.addEventListener("click", (event) => {
        event.preventDefault();
        void openAlbumView(event.currentTarget.dataset.albumId, "browse");
      });
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
    note.textContent = "No MusicBrainz id, so Rou can't request this one.";
    return;
  }
  if (album.requested) {
    btn.textContent = "Requested";
    btn.disabled = true;
    note.textContent = "Waiting on DroppedNeedle. It'll land on the crate after it imports.";
    return;
  }
  btn.textContent = "Request album";
  note.textContent = "Not on the media server yet. Request it through Rou.";
}

async function openAlbumView(albumId, from = "browse") {
  albumReturn = from;
  searchStatus.textContent = "Opening album…";
  try {
    const detail = await api(`/api/albums/${encodeURIComponent(albumId)}`);
    openAlbum = detail;
    browseEl.classList.add("hidden");
    artistView.classList.add("hidden");
    albumView.classList.remove("hidden");
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
    const cover = document.querySelector("#album-cover");
    cover.onerror = () => {
      cover.removeAttribute("src");
    };
    if (detail.album.coverUrl) cover.src = detail.album.coverUrl;
    else cover.removeAttribute("src");
    albumTracksEl.innerHTML = "";
    for (const [index, track] of detail.tracks.entries()) {
      const item = document.createElement("li");
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(track.trackNumber || index + 1);
      const name = document.createElement("span");
      name.textContent = track.title;
      const time = document.createElement("span");
      time.className = "muted";
      time.textContent = formatDuration(track.durationSeconds);
      const action = document.createElement("button");
      action.className = "btn";
      if (track.fileId) {
        action.textContent = "Add";
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          void play({ fileId: track.fileId });
        });
      } else if (track.recordingMbid) {
        action.textContent = "Request";
        action.addEventListener("click", (event) => {
          event.stopPropagation();
          void requestMedia({
            albumId: detail.album.id,
            recordingMbid: track.recordingMbid,
            title: track.title,
            durationSeconds: track.durationSeconds,
          }, action);
        });
      } else {
        action.textContent = "Request";
        action.disabled = true;
      }
      item.append(num, name, time, action);
      albumTracksEl.append(item);
    }
    searchStatus.textContent = detail.album.inLibrary
      ? `${detail.tracks.length} tracks`
      : `${detail.tracks.length} tracks · request to add`;
  } catch (error) {
    searchStatus.textContent = error.message;
  }
}

async function openArtistView(artistId) {
  searchStatus.textContent = "Opening artist…";
  try {
    const detail = await api(`/api/artists/${encodeURIComponent(artistId)}`);
    openArtist = detail;
    showArtist();
    document.querySelector("#artist-name").textContent = detail.artist.name;
    const meta = [detail.artist.disambiguation, detail.artist.inLibrary ? "On the crate" : null]
      .filter(Boolean)
      .join(" · ");
    document.querySelector("#artist-meta").textContent = meta;
    const cover = document.querySelector("#artist-cover");
    cover.onerror = () => {
      cover.removeAttribute("src");
    };
    if (detail.artist.coverUrl) cover.src = detail.artist.coverUrl;
    else cover.removeAttribute("src");
    artistAlbumsEl.innerHTML = "";
    for (const album of detail.albums ?? []) appendAlbumCard(artistAlbumsEl, album, "artist");
    searchStatus.textContent = `${detail.albums?.length ?? 0} releases`;
  } catch (error) {
    searchStatus.textContent = error.message;
  }
}

async function play(body) {
  searchStatus.textContent = "Sending to Rou…";
  try {
    const result = await api("/api/play", { method: "POST", body: JSON.stringify(body) });
    searchStatus.textContent = result.position === 0 ? "Playing now." : `Queued #${result.position}.`;
    if (result.status) renderStatus(result.status);
  } catch (error) {
    searchStatus.textContent = error.message;
  }
}

async function requestMedia(body, button) {
  if (button) button.disabled = true;
  searchStatus.textContent = "Requesting through Rou…";
  try {
    const result = await api("/api/request", { method: "POST", body: JSON.stringify(body) });
    searchStatus.textContent = result.message || "Requested.";
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
    searchStatus.textContent = error.message;
  }
}

async function queueOpenAlbum() {
  if (!openAlbum?.album.id) return;
  try {
    if (!openAlbum.album.inLibrary) {
      await requestMedia({ albumId: openAlbum.album.id }, document.querySelector("#queue-album-btn"));
      return;
    }
    searchStatus.textContent = "Queueing album…";
    const result = await api("/api/album", {
      method: "POST",
      body: JSON.stringify({ albumId: openAlbum.album.id }),
    });
    searchStatus.textContent = `Queued ${result.count} tracks.`;
    if (result.status) renderStatus(result.status);
  } catch (error) {
    searchStatus.textContent = error.message;
  }
}

document.querySelector("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#query").value.trim();
  if (!query) return;
  searchStatus.textContent = "Searching…";
  try {
    renderSearch(await api(`/api/search?q=${encodeURIComponent(query)}`));
  } catch (error) {
    searchStatus.textContent = error.message;
  }
});

document.querySelector("#back-btn").addEventListener("click", () => {
  if (albumReturn === "artist" && openArtist) {
    showArtist();
    searchStatus.textContent = `${openArtist.albums?.length ?? 0} releases`;
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
document.querySelector("#guild").addEventListener("change", async (event) => {
  const select = event.target;
  const guildId = select.value;
  if (!guildId || select.dataset.moving === "1") return;
  if (pendingGuildId && guildId === status?.guildId) {
    pendingGuildId = null;
    renderChannelPicker(status.channels ?? [], status.channelId);
    searchStatus.textContent = "Staying put.";
    return;
  }
  if (!pendingGuildId && guildId === status?.guildId) return;
  select.dataset.moving = "1";
  select.disabled = true;
  searchStatus.textContent = "Moving Rou…";
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
    searchStatus.textContent = result.status?.guildName
      ? `Rou is in ${result.status.guildName}.`
      : "Moved.";
  } catch (error) {
    if (error.status === 409 && error.payload?.channels) {
      pendingGuildId = error.payload.guildId || guildId;
      renderChannelPicker(error.payload.channels, "");
      searchStatus.textContent = error.message;
    } else {
      pendingGuildId = null;
      if (status?.guildId) select.value = status.guildId;
      searchStatus.textContent = error.message;
    }
  } finally {
    select.dataset.moving = "0";
    select.disabled = false;
  }
});

document.querySelector("#voice-channel").addEventListener("change", async (event) => {
  const select = event.target;
  const channelId = select.value;
  if (!channelId || select.dataset.moving === "1") return;
  if (!pendingGuildId && channelId === status?.channelId) return;
  select.dataset.moving = "1";
  select.disabled = true;
  searchStatus.textContent = pendingGuildId ? "Moving Rou…" : "Joining voice…";
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
    searchStatus.textContent = result.status?.channelName
      ? `Rou is in ${result.status.channelName}.`
      : "Joined.";
  } catch (error) {
    if (status?.channelId) select.value = status.channelId;
    else select.value = "";
    searchStatus.textContent = error.message;
  } finally {
    select.dataset.moving = "0";
    select.disabled = false;
  }
});

document.querySelector(".transport").addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  try {
    await api(`/api/${action}`, { method: "POST", body: "{}" });
  } catch (error) {
    searchStatus.textContent = error.message;
  }
});

let volumeTimer = 0;
volumeInput.addEventListener("input", () => {
  volumeLabel.textContent = `${volumeInput.value}%`;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    void api("/api/volume", {
      method: "POST",
      body: JSON.stringify({ percent: Number(volumeInput.value) }),
    }).catch((error) => {
      searchStatus.textContent = error.message;
    });
  }, 150);
});

async function refreshChannels() {
  if (pendingGuildId) return;
  try {
    const guildId = status?.guildId;
    const payload = await api(`/api/channels${guildId ? `?guildId=${encodeURIComponent(guildId)}` : ""}`);
    renderChannelPicker(payload.channels ?? [], status?.channelId);
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
