const loginEl = document.querySelector("#login");
const appEl = document.querySelector("#app");
const loginError = document.querySelector("#login-error");
const resultsEl = document.querySelector("#results");
const queueEl = document.querySelector("#queue");
const searchStatus = document.querySelector("#search-status");
const volumeInput = document.querySelector("#volume");
const volumeLabel = document.querySelector("#volume-label");
const coverEl = document.querySelector("#cover");
const coverWrap = document.querySelector("#cover-wrap");
const browseEl = document.querySelector("#browse");
const albumView = document.querySelector("#album-view");
const albumTracksEl = document.querySelector("#album-tracks");

coverEl.addEventListener("error", () => {
  const current = status?.nowPlaying;
  if (current?.albumMbid && coverEl.dataset.fallback !== "caa") {
    coverEl.dataset.fallback = "caa";
    coverEl.src = `https://coverartarchive.org/release-group/${current.albumMbid}/front-500`;
    return;
  }
  coverWrap.classList.remove("has-art");
});
coverEl.addEventListener("load", () => {
  if (coverEl.getAttribute("src")) coverWrap.classList.add("has-art");
});

const LOGIN_ERRORS = {
  oauth: "Discord login failed. Try again.",
  not_in_guild: "That Discord account is not in this server.",
};

let status = null;
let elapsedTimer = null;
let openAlbum = null;

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
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
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
  const albumBtn = document.querySelector("#album");
  albumBtn.textContent = current?.album ?? "";
  albumBtn.dataset.albumId = current?.albumMbid ?? "";
  document.querySelector("#channel").textContent = next.channelName
    ? `${next.paused ? "Paused in" : "Live in"} ${next.channelName}`
    : "Not in a voice channel";

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
    for (const track of next.queue) {
      const item = document.createElement("li");
      item.innerHTML = `<span>${escapeHtml(track.title)}</span><span class="muted">${formatDuration(track.durationSeconds)}</span>`;
      queueEl.append(item);
    }
  }
  tickElapsed();
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
    elapsed.textContent = `${formatDuration(seconds)} / ${formatDuration(current.durationSeconds)}${
      current.requestedBy ? ` · ${current.requestedBy}` : ""
    }`;
  };
  update();
  elapsedTimer = setInterval(update, 1000);
}

function showBrowse() {
  albumView.classList.add("hidden");
  browseEl.classList.remove("hidden");
  openAlbum = null;
}

function albumBadge(album) {
  if (album.inLibrary) return "";
  return `<span class="badge">${album.requested ? "Requested" : "Request"}</span>`;
}

function renderAlbums(payload) {
  showBrowse();
  resultsEl.innerHTML = "";
  if (payload.albums?.length) {
    const onCrate = payload.albums.filter((album) => album.inLibrary).length;
    const toRequest = payload.albums.length - onCrate;
    const parts = [];
    if (onCrate) parts.push(`${onCrate} on the crate`);
    if (toRequest) parts.push(`${toRequest} to request`);
    searchStatus.textContent = parts.join(" · ");
    for (const album of payload.albums) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = album.inLibrary ? "album-card" : "album-card requestable";
      const art = album.coverUrl
        ? `<img src="${escapeHtml(album.coverUrl)}" alt="">`
        : `<img src="/rou.png" alt="">`;
      card.innerHTML = `<div class="art-wrap">${art}${albumBadge(album)}</div><b>${escapeHtml(album.title)}</b><span>${escapeHtml(album.artist)}${
        album.matchedTrack ? ` · has ${escapeHtml(album.matchedTrack)}` : album.year ? ` · ${album.year}` : ""
      }</span>`;
      const artImg = card.querySelector("img");
      artImg?.addEventListener("error", () => {
        artImg.src = "/rou.png";
      });
      card.addEventListener("click", () => void openAlbumView(album.id));
      resultsEl.append(card);
    }
    return;
  }
  searchStatus.textContent = payload.message || "Nothing matched.";
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

async function openAlbumView(albumId) {
  searchStatus.textContent = "Opening album…";
  try {
    const detail = await api(`/api/albums/${encodeURIComponent(albumId)}`);
    openAlbum = detail;
    browseEl.classList.add("hidden");
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
    cover.src = detail.album.coverUrl || "/rou.png";
    cover.onerror = () => {
      cover.src = "/rou.png";
    };
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
    renderAlbums(await api(`/api/search?q=${encodeURIComponent(query)}`));
  } catch (error) {
    searchStatus.textContent = error.message;
  }
});

document.querySelector("#back-btn").addEventListener("click", showBrowse);
document.querySelector("#queue-album-btn").addEventListener("click", () => void queueOpenAlbum());
document.querySelector("#album").addEventListener("click", () => {
  const id = document.querySelector("#album").dataset.albumId;
  if (id) void openAlbumView(id);
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
