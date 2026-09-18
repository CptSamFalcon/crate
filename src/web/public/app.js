const loginEl = document.querySelector("#login");
const appEl = document.querySelector("#app");
const loginError = document.querySelector("#login-error");
const resultsEl = document.querySelector("#results");
const queueEl = document.querySelector("#queue");
const searchStatus = document.querySelector("#search-status");
const volumeInput = document.querySelector("#volume");
const volumeLabel = document.querySelector("#volume-label");

const LOGIN_ERRORS = {
  oauth: "Discord login failed. Try again.",
  not_in_guild: "That Discord account is not in this server.",
};

let status = null;
let elapsedTimer = null;

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

function trackLine(track) {
  return `${track.title} — ${track.artist}`;
}

function renderStatus(next) {
  status = next;
  const current = next.nowPlaying;
  document.querySelector("#title").textContent = current ? current.title : "Nothing playing";
  document.querySelector("#artist").textContent = current
    ? current.artist
    : "Search your library to start";
  document.querySelector("#album").textContent = current ? current.album : "";
  document.querySelector("#channel").textContent = next.channelName
    ? `In ${next.channelName}${next.paused ? " · paused" : ""}`
    : "Not in a voice channel";

  const cover = document.querySelector("#cover");
  const wrap = document.querySelector("#cover-wrap");
  if (current?.coverUrl) {
    cover.src = current.coverUrl;
    wrap.classList.add("has-art");
  } else {
    cover.removeAttribute("src");
    wrap.classList.remove("has-art");
  }

  volumeInput.value = String(next.volume);
  volumeLabel.textContent = `${next.volume}%`;

  queueEl.innerHTML = "";
  if (!current && next.queue.length === 0) {
    queueEl.innerHTML = `<li class="muted">Queue is empty.</li>`;
  } else {
    for (const [index, track] of next.queue.entries()) {
      const item = document.createElement("li");
      item.innerHTML = `<span>${index + 1}. ${escapeHtml(trackLine(track))} <span class="muted">${formatDuration(track.durationSeconds)}</span></span>`;
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
      current.requestedBy ? ` · queued by ${current.requestedBy}` : ""
    }`;
  };
  update();
  elapsedTimer = setInterval(update, 1000);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderResults(payload) {
  resultsEl.innerHTML = "";
  if (payload.tracks?.length) {
    searchStatus.textContent = `${payload.tracks.length} match${payload.tracks.length === 1 ? "" : "es"}`;
    for (const track of payload.tracks) {
      const item = document.createElement("li");
      const meta = document.createElement("span");
      meta.innerHTML = `${escapeHtml(trackLine(track))} <span class="muted">${escapeHtml(track.album)} · ${formatDuration(track.durationSeconds)}</span>`;
      const button = document.createElement("button");
      button.className = "btn";
      button.textContent = "Play";
      button.addEventListener("click", () => play({ fileId: track.fileId }));
      item.append(meta, button);
      resultsEl.append(item);
    }
    return;
  }
  searchStatus.textContent = payload.message || "No matches.";
  for (const album of payload.catalog ?? []) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = `${album.title}${album.artist ? ` — ${album.artist}` : ""} (${album.inLibrary ? "in library" : "not downloaded"})`;
    resultsEl.append(item);
  }
}

async function play(body) {
  searchStatus.textContent = "Joining voice…";
  const result = await api("/api/play", { method: "POST", body: JSON.stringify(body) });
  searchStatus.textContent = result.position === 0 ? "Playing now." : `Queued #${result.position}.`;
  if (result.status) renderStatus(result.status);
}

async function playAlbum(query) {
  searchStatus.textContent = "Queueing album…";
  const result = await api("/api/album", { method: "POST", body: JSON.stringify({ query }) });
  searchStatus.textContent = `Queued ${result.count} tracks.`;
  if (result.status) renderStatus(result.status);
}

document.querySelector("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#query").value.trim();
  if (!query) return;
  searchStatus.textContent = "Searching…";
  try {
    renderResults(await api(`/api/search?q=${encodeURIComponent(query)}`));
  } catch (error) {
    searchStatus.textContent = error.message;
  }
});

document.querySelector("#album-btn").addEventListener("click", async () => {
  const query = document.querySelector("#query").value.trim();
  if (!query) return;
  try {
    await playAlbum(query);
  } catch (error) {
    searchStatus.textContent = error.message;
  }
});

document.querySelector("#play-btn").addEventListener("click", async () => {
  const query = document.querySelector("#query").value.trim();
  if (!query) return;
  try {
    await play({ query });
  } catch (error) {
    searchStatus.textContent = error.message;
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

async function boot() {
  const params = new URLSearchParams(location.search);
  const loginErrorKey = params.get("error");
  if (loginErrorKey) {
    history.replaceState({}, "", "/");
  }
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
    events.onerror = () => {
      events.close();
    };
  } catch {
    showLogin(LOGIN_ERRORS[loginErrorKey] || (loginErrorKey ? LOGIN_ERRORS.oauth : ""));
  }
}

void boot();
