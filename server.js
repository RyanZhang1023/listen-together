import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

import {
  searchWithKeyword,
  getMusicURL
} from "./qq-music-api.js";

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server);
// Store connected users: { socket.id → username }
const connectedUsers = new Map();

app.use(express.static("public"));

let playlist = [];
let currentIndex = 0;
let isPlaying = false;
let currentTime = 0;
let mode = "ordered"; // "ordered" or "random"

// Get current song based on mode
function getCurrentSong() {
    if (playlist.length === 0) return null;
    if (mode === "random") {
        currentIndex = Math.floor(Math.random() * playlist.length);
    }
    return playlist[currentIndex];
}

app.get("/api/search", async (req, res) => {
  const keyword = req.query.keyword;
  if (!keyword) return res.json([]);

  try {
    console.log(`Searching QQ Music for: "${keyword}"`);
    const songs = await searchWithKeyword(keyword, 0, 10, 1);
    res.json(songs);
    console.log("QQ returned items count:", songs?.length ?? "no .length");
    console.log("First item (if any):", songs?.[0] ?? "empty");
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/songurl", async (req, res) => {
  const songmid = req.query.songmid;
  console.log(songmid);
  //if (!songmid) return res.json({});

  try {
    const url = await getMusicURL(songmid, "320");
    console.log(url);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get URL" });
  }
});


io.on("connection", (socket) => {
    console.log("User connected");

    // Send current user list to the newly connected client
    function broadcastUserList() {
        const users = Array.from(connectedUsers.entries()).map(([id, username]) => ({
            id,
            username
        }));
        io.emit("usersList", users);
    }

    // Send current state to new user
    socket.emit("syncState", {
        playlist,
        currentIndex,
        isPlaying,
        currentTime,
        mode
    });

    // Also send the list immediately on connection (before username is set)
    broadcastUserList();  // optional — shows empty or partial list

    socket.on("resync", () => {
        console.log(`Client ${socket.id} requested resync`);

        socket.emit("syncState", {
            playlist,
            currentIndex,
            isPlaying,
            currentTime,
            mode
        });
    });

    socket.on("addSong", (song) => {
        playlist.push(song);
        io.emit("updatePlaylist", playlist);
    });

    socket.on("deleteSong", (index) => {
        playlist.splice(index, 1);
        // Ensure currentIndex is within bounds
        if (currentIndex >= playlist.length) currentIndex = Math.max(playlist.length - 1, 0);
        io.emit("updatePlaylist", playlist);
    });

    socket.on("moveSong", ({ from, to }) => {
        const song = playlist.splice(from, 1)[0];
        playlist.splice(to, 0, song);
        io.emit("updatePlaylist", playlist);
    });

    socket.on("toggleMode", () => {
        mode = mode === "ordered" ? "random" : "ordered";
        io.emit("updateMode", mode);
    });

    socket.on("play", (time) => {
        isPlaying = true;
        currentTime = time;
        io.emit("play", time);
    });

    socket.on("pause", (time) => {
        isPlaying = false;
        currentTime = time;
        io.emit("pause", time);
    });

    socket.on("next", (nextIndex) => {
        if (playlist.length === 0) return;

        if (typeof nextIndex === "number" && playlist[nextIndex]) {
            currentIndex = nextIndex;
        } else {
            // fallback in case client doesn't send index
            currentIndex = mode === "ordered"
                ? (currentIndex + 1) % playlist.length
                : Math.floor(Math.random() * playlist.length);
        }

        io.emit("next", currentIndex);
    });

    // When client sends their username
    socket.on("setUsername", (name) => {
        // Optional: sanitize / limit length
        const safeName = name.trim().substring(0, 20) || "Anonymous";

        connectedUsers.set(socket.id, safeName);

        // Tell everyone someone joined
        io.emit("userJoined", { id: socket.id, username: safeName });

        // Send updated list to all
        broadcastUserList();

        console.log(`${safeName} (${socket.id}) joined`);
    });

    // Clean up when user disconnects
    socket.on("disconnect", () => {
        if (connectedUsers.has(socket.id)) {
            const name = connectedUsers.get(socket.id);
            connectedUsers.delete(socket.id);

            io.emit("userLeft", { id: socket.id, username: name });
            broadcastUserList();

            console.log(`${name} (${socket.id}) left`);
        }
        console.log("User disconnected");
    });

    socket.on("updateTime", (time) => {
        currentTime = time;
    });

    socket.on("disconnect", () => {
        console.log("User disconnected");
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});