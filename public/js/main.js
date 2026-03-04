const API_BASE = "https://qqmusic-api.onrender.com"; // Replace with your Render Koa API URL
const socket = io();
const audio = document.getElementById("audio");
let playlist = [];
let isPlaying = false;
let currentIndex = 0;
let mode = "ordered"; // synced with server
let hasUserGestured = false;
let username = null;

// Called when user clicks "Join"
function setUsername() {
    const input = document.getElementById("usernameInput");
    const name = input.value.trim();

    if (!name) {
        alert("Please enter a name");
        return;
    }

    username = name;
    socket.emit("setUsername", name);

    // Hide setup UI
    document.getElementById("username-setup").style.display = "none";

    // Optional: show overlay only after name is set
    // (you can move the overlay logic here if you want)
}

// Render connected users list
function renderUsers(users) {
    const ul = document.getElementById("usersList");
    ul.innerHTML = "";
    users.forEach(user => {
        const li = document.createElement("li");
        li.textContent = user.username;
        // Optional: highlight yourself
        if (user.id === socket.id) {
            li.style.fontWeight = "bold";
            li.textContent += " (you)";
        }
        ul.appendChild(li);
    });
}

socket.on("syncState", (state) => {
    console.log("Received syncState →", state);
    playlist = state.playlist;
    currentIndex = state.currentIndex;
    mode = state.mode;
    renderPlaylist();
    loadCurrentSong();
    const overlay = document.getElementById('activation-overlay');

    if (!hasUserGestured){
        overlay.classList.add('show');
    } else {
        overlay.classList.remove('show');
    }

    if (state.isPlaying) {
        setTimeout(() => {
            audio.currentTime = state.currentTime;
            socket.emit("pause", state.currentTime);
        }, 300);
    }
});

// --- Render playlist ---
function renderPlaylist() {
    const ul = document.getElementById("playlist");
    ul.innerHTML = "";
    playlist.forEach((song, index) => {
        const li = document.createElement("li");
        li.innerHTML = `
            ${song.trackName} - ${song.artistName}
            <button onclick="deleteSong(${index})">❌</button>
            <button onclick="moveUp(${index})">⬆</button>
            <button onclick="moveDown(${index})">⬇</button>
        `;
        ul.appendChild(li);
    });
}

// --- Playlist controls ---
function deleteSong(index) { socket.emit("deleteSong", index); }
function moveUp(index) { if (index > 0) socket.emit("moveSong", { from: index, to: index - 1 }); }
function moveDown(index) { if (index < playlist.length - 1) socket.emit("moveSong", { from: index, to: index + 1 }); }
function toggleMode() { socket.emit("toggleMode"); }

// --- Search songs ---
function searchSong() {
    const query = document.getElementById("searchInput").value;

    fetch(`/api/search?keyword=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => {
            console.log("=== RAW SEARCH RESPONSE FROM SERVER ===");
            console.log(data);                                 // ← print the whole thing
            console.log("JSON string version:", JSON.stringify(data, null, 2));

            const results = document.getElementById("searchResults");
            results.innerHTML = "";
            const songs = data?.data?.song?.list || data || [];
            songs.forEach(song => {

                const songName = song.songname || song.name || "Unknown Title";
                const songMid = song.mid;
                console.log(song.mid);
                const artists = song.singer
                    ? song.singer.map(s => s.name).join(", ")
                    : "Unknown Artist";

                const li = document.createElement("li");
                li.textContent = `${songName} - ${artists}`;

                const btn = document.createElement("button");
                btn.textContent = "Add";

                btn.addEventListener("click", () => {
                    fetch(`${API_BASE}/getMusicPlay?songmid=${songMid}`)
                        .then(response => {
                            if (!response.ok) throw new Error(`HTTP ${response.status}`);
                            return response.json();
                        })
                        .then(json => {
                            // Adjust this line to match your actual JSON structure
                            const playUrl = json.data;
                            socket.emit("addSong", {
                                songmid: songMid,
                                trackName: songName,
                                artistName: artists,
                                previewUrl: playUrl
                            });
                        })
                        .catch(err => {
                            console.error("Fetch failed for", songMid, err);
                            if (typeof callback === 'function') {
                                callback(null);
                            }
                        });
                });

                li.appendChild(btn);
                results.appendChild(li);
            });
        });
}

function addSong(song) { if (song.previewUrl) { socket.emit("addSong", song); } }

// --- Load current song into audio ---
function loadCurrentSong() {
    if (!playlist[currentIndex]?.previewUrl) {
        audio.src = "";
        return;
    }
    audio.src = playlist[currentIndex].previewUrl;
    audio.load();
}

// --- Play/pause ---
function playSong() { if (playlist.length === 0) return; socket.emit("play", audio.currentTime); }
function pauseSong() { socket.emit("pause", audio.currentTime); }

// --- Handle audio end ---
audio.onended = () => {
    if (playlist.length === 0) return;
    const nextIndex = mode === "ordered"
        ? (currentIndex + 1) % playlist.length
        : Math.floor(Math.random() * playlist.length);
    socket.emit("next", nextIndex);
};

// On first real user interaction (click anywhere or play button)
document.addEventListener('click', function firstGesture() {
    hasUserGestured = true;
    document.getElementById('activation-overlay').classList.remove('show');
    document.removeEventListener('click', firstGesture);
    socket.emit("resync");
}, {once: true});

document.addEventListener('touchstart', function firstGesture() {
    hasUserGestured = true;
    document.getElementById('activation-overlay').classList.remove('show');
    document.removeEventListener('click', firstGesture);
    socket.emit("resync");
}, {once: true});

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("usernameInput").focus();
});

// --- Socket events ---
socket.on("updatePlaylist", (updated) => {
    const currentSongId = playlist[currentIndex]?.trackId;
    playlist = updated;
    renderPlaylist();

    const newIndex = playlist.findIndex(s => s.trackId === currentSongId);
    currentIndex = newIndex !== -1 ? newIndex : 0;

    loadCurrentSong();
    if (!audio.paused) audio.play().catch(() => {});
});

socket.on("play", (time) => {
    audio.currentTime = time;
    audio.play().catch(() => {});
});

socket.on("pause", (time) => {
    audio.currentTime = time;
    audio.pause();
});

socket.on("next", (index) => {
    if (playlist.length === 0) return;
    currentIndex = index;
    loadCurrentSong();
    audio.play().catch(() => {});
});

socket.on("updateMode", (newMode) => {
    mode = newMode;
});

// Receive the full list of users
socket.on("usersList", (users) => {
    renderUsers(users);
});

// When a new user joins
socket.on("userJoined", (user) => {
    console.log(`${user.username} joined`);
    // The full list will come via usersList anyway
});

// When someone leaves
socket.on("userLeft", (user) => {
    console.log(`${user.username} left`);
});