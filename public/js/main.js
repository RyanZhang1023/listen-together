
const API_BASE = "https://qqmusic-api.onrender.com";
const socket = io();
const audio = new Audio();
let playlist = [];
let currentIndex = 0;
let isPlaying = false;
let hasUserGestured = false;

audio.onended = () => {
  isPlaying = false;
  updatePlayPauseUI();

  // Auto-advance to next song
  if (playlist.length > 0) {
    let nextIdx = currentIndex + 1;
    if (nextIdx >= playlist.length) nextIdx = 0;
    socket.emit("next", nextIdx);
  }
};

// DOM elements
const playlistUl = document.getElementById("playlist");
const usersUl = document.getElementById("usersList");
const searchResults = document.getElementById("searchResults");
const currentSongEl = document.getElementById("currentSong");
const currentArtistEl = document.getElementById("currentArtist");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const progressBar = document.getElementById("progressBar");
const playPauseBtn = document.getElementById("playPauseBtn");
const playPauseIcon = document.getElementById("playPauseIcon");
const usernameInputOverlay = document.getElementById("usernameInputOverlay");
const joinBtn = document.getElementById("joinBtn");

// ── Socket events ───────────────────────────────────────

socket.on("syncState", (state) => {
  playlist = state.playlist || [];
  currentIndex = state.currentIndex ?? 0;
  isPlaying = state.isPlaying || false;

  renderPlaylist();
  renderUsers(state.users || []);
  loadCurrentSong();
  updatePlayPauseUI();
});

socket.on("usersList", (users) => {
  renderUsers(users);
});

socket.on("updatePlaylist", (updated) => {
  playlist = updated;
  renderPlaylist();
  loadCurrentSong();
});

socket.on("play", (time) => {
  audio.currentTime = time;
  audio.play().catch(() => {});
  isPlaying = true;
  updatePlayPauseUI();
});

socket.on("pause", (time) => {
  audio.currentTime = time;
  audio.pause();
  isPlaying = false;
  updatePlayPauseUI();
});

socket.on("next", (index) => {
  currentIndex = index;
  loadCurrentSong();
  if (isPlaying) audio.play().catch(() => {});
});

// ── Render functions ────────────────────────────────────

function renderPlaylist() {
  playlistUl.innerHTML = "";
  playlist.forEach((song, i) => {
    const li = document.createElement("li");
    li.dataset.index = i;
    li.innerHTML = `
      <i class="fas fa-grip-vertical drag-handle"></i>
      <div class="info">
        <div class="title">${song.trackName || "Unknown"}</div>
        <div class="artist">${song.artistName || ""}</div>
      </div>
      <span class="duration">${formatTime(song.duration || 0)}</span>
      <button onclick="deleteSong(${i})"><i class="fas fa-trash"></i></button>
    `;
    if (i === currentIndex) li.classList.add("playing");
    playlistUl.appendChild(li);
  });

  new Sortable(playlistUl, {
    animation: 150,
    handle: ".drag-handle",
    ghostClass: "dragging",
    onEnd: (evt) => {
      const { oldIndex, newIndex } = evt;
      if (oldIndex === newIndex) return;
      socket.emit("moveSong", { from: oldIndex, to: newIndex });
    }
  });
}

function renderUsers(users) {
  usersUl.innerHTML = "";
  if (users.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No one here yet...";
    li.style.color = "#777";
    usersUl.appendChild(li);
    return;
  }

  users.forEach(u => {
    const li = document.createElement("li");
    const isYou = u.id === socket.id;
    li.textContent = u.username + (isYou ? " (you)" : "");
    if (isYou) li.style.fontWeight = "600";
    usersUl.appendChild(li);
  });
}

function updatePlayPauseUI() {
  if (!playPauseIcon) return;

  if (isPlaying) {
    playPauseIcon.className = "fas fa-pause";
    playPauseBtn.title = "Pause";
  } else {
    playPauseIcon.className = "fas fa-play";
    playPauseBtn.title = "Play";
  }
}

function loadCurrentSong() {
  if (!playlist[currentIndex]?.previewUrl) {
    audio.src = "";
    currentSongEl.textContent = "No song selected";
    currentArtistEl.textContent = "";
    updatePlayPauseUI();
    return;
  }

  const song = playlist[currentIndex];
  audio.src = song.previewUrl;
  audio.load();

  currentSongEl.textContent = song.trackName || "Unknown";
  currentArtistEl.textContent = song.artistName || "";

  audio.onloadedmetadata = () => {
    durationEl.textContent = formatTime(audio.duration || 0);
    progressBar.max = audio.duration || 100;
  };

  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progressBar.value = audio.currentTime;
    currentTimeEl.textContent = formatTime(audio.currentTime);
  };

  if (isPlaying) audio.play().catch(() => {});
}

// ── Controls ────────────────────────────────────────────

function searchSong() {
  const query = document.getElementById("searchInput").value.trim();
  if (!query) return;

  fetch(`/api/search?keyword=${encodeURIComponent(query)}`)
    .then(res => res.json())
    .then(data => {
      console.log("=== RAW SEARCH RESPONSE FROM SERVER ===");
      console.log(data);                                 // ← print the whole thing
      console.log("JSON string version:", JSON.stringify(data, null, 2));
      searchResults.innerHTML = "";
      const songs = data?.data?.song?.list || data || [];
      if (songs.length === 0) {
        searchResults.innerHTML = "<p>No results</p>";
      }

      songs.forEach(s => {
        const name = s.songname || "Unknown";
        const mid = s.mid;
        const artists = s.singer?.map(a => a.name).join(", ") || "";

        const li = document.createElement("li");
        li.innerHTML = `
          <span>${name} – ${artists}</span>
          <button onclick="addSongFromSearch('${mid}', '${name.replace(/'/g,"\\'")}', '${artists.replace(/'/g,"\\'")}')">Add</button>
        `;
        searchResults.appendChild(li);
      });

      searchResults.classList.add("show");
    })
    .catch(err => console.error(err));
}

function addSongFromSearch(mid, name, artists) {
  fetch(`${API_BASE}/getMusicPlay?songmid=${mid}`)
    .then(r => r.json())
    .then(json => {
      const url = json.data || "";
      if (url) {
        socket.emit("addSong", {
          songmid: mid,
          trackName: name,
          artistName: artists,
          previewUrl: url,
          duration: 0
        });
      }
    })
    .catch(err => console.error("Add failed", err));

  searchResults.classList.remove("show");
  document.getElementById("searchInput").value = "";
}

function deleteSong(index) {
  socket.emit("deleteSong", index);
}

function togglePlayPause() {
  if (playlist.length === 0) return;

  if (isPlaying) {
    // Currently playing → pause
    socket.emit("pause", audio.currentTime || 0);
  } else {
    // Paused or stopped → play
    socket.emit("play", audio.currentTime || 0);
  }
}

function nextSong() {
  if (playlist.length === 0) return;
  let nextIdx = currentIndex + 1;
  if (nextIdx >= playlist.length) nextIdx = 0;
  socket.emit("next", nextIdx);
}

function prevSong() {
  if (playlist.length === 0) return;
  let prevIdx = currentIndex - 1;
  if (prevIdx < 0) prevIdx = playlist.length - 1;
  socket.emit("next", prevIdx);
}

// ── Utils ───────────────────────────────────────────────

function formatTime(seconds) {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function handleJoinFromOverlay() {
  const name = usernameInputOverlay.value.trim();

  if (!name) {
    alert("Please enter a username");
    return;
  }

  // Send username to server
  socket.emit("setUsername", name);

  // Mark gesture as done → hide overlay
  hasUserGestured = true;
  document.getElementById("activation-overlay").classList.remove("show");

  // Optional: focus search input after join
  document.getElementById("searchInput")?.focus();
}

// ── Gesture unlock ──────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("activation-overlay").classList.add("show");
});