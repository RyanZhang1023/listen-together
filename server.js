import express from "express";
import { createServer } from "http";           // ← prefer this style
import { Server } from "socket.io";
import cors from "cors";

import {
  searchWithKeyword,
  getMusicURL
} from "./qq-music-api.js";

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// State
let playlist = [];
let currentIndex = 0;
let isPlaying = false;
let currentTime = 0;

// { socket.id → username }
const connectedUsers = new Map();

function broadcastUserList() {
  const users = Array.from(connectedUsers.entries()).map(([id, username]) => ({
    id,
    username
  }));
  io.emit("usersList", users);
}

app.get("/api/search", async (req, res) => {
  const keyword = req.query.keyword?.trim();
  if (!keyword) return res.json({ data: { song: { list: [] } } });

  try {
    const songs = await searchWithKeyword(keyword, 0, 10, 1);
    res.json(songs);
  } catch (err) {
    console.error("Search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/songurl", async (req, res) => {
  const songmid = req.query.songmid;
  if (!songmid) return res.status(400).json({ error: "Missing songmid" });

  try {
    const url = await getMusicURL(songmid, "320");
    res.json({ url });
  } catch (err) {
    console.error("Get URL failed:", err);
    res.status(500).json({ error: "Failed to get URL" });
  }
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Send current state (no mode anymore)
  socket.emit("syncState", {
    playlist,
    currentIndex,
    isPlaying,
    currentTime: Math.max(0, currentTime || 0),
    users: Array.from(connectedUsers.entries()).map(([id, username]) => ({ id, username }))
  });

  // Username
  socket.on("setUsername", (name) => {
    const safeName = String(name || "Anonymous").trim().slice(0, 20);
    connectedUsers.set(socket.id, safeName);
    io.emit("userJoined", { id: socket.id, username: safeName });
    broadcastUserList();
    console.log(`${safeName} joined (${socket.id})`);
  });

  // Playlist actions
  socket.on("addSong", (song) => {
    if (!song?.previewUrl) return;
    playlist.push(song);
    io.emit("updatePlaylist", playlist);
  });

  socket.on("deleteSong", (index) => {
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= playlist.length) return;

    playlist.splice(idx, 1);
    if (currentIndex >= playlist.length) {
      currentIndex = Math.max(0, playlist.length - 1);
    }
    io.emit("updatePlaylist", playlist);
  });

  socket.on("moveSong", ({ from, to }) => {
    const f = Number(from);
    const t = Number(to);
    if (
      !Number.isInteger(f) || !Number.isInteger(t) ||
      f < 0 || f >= playlist.length ||
      t < 0 || t >= playlist.length
    ) return;

    const [moved] = playlist.splice(f, 1);
    playlist.splice(t, 0, moved);
    io.emit("updatePlaylist", playlist);
  });

  // Playback
  socket.on("play", (time) => {
    const t = Number(time) || 0;
    currentTime = Math.max(0, t);
    isPlaying = true;
    io.emit("play", currentTime);
  });

  socket.on("pause", (time) => {
    const t = Number(time) || 0;
    currentTime = Math.max(0, t);
    isPlaying = false;
    io.emit("pause", currentTime);
  });

  socket.on("next", (nextIndex) => {
    if (playlist.length === 0) return;

    const idx = Number(nextIndex);
    if (Number.isInteger(idx) && idx >= 0 && idx < playlist.length) {
      currentIndex = idx;
    } else {
      // Fallback: next in sequence (loop)
      currentIndex = (currentIndex + 1) % playlist.length;
    }

    currentTime = 0;
    io.emit("next", currentIndex);
  });

  // Optional: clients can report time while playing
  socket.on("updateTime", (time) => {
    if (isPlaying) {
      currentTime = Math.max(0, Number(time) || 0);
    }
  });

  // Cleanup
  socket.on("disconnect", () => {
    if (connectedUsers.has(socket.id)) {
      const name = connectedUsers.get(socket.id);
      connectedUsers.delete(socket.id);
      io.emit("userLeft", { id: socket.id, username: name });
      broadcastUserList();
      console.log(`${name} left (${socket.id})`);
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
});