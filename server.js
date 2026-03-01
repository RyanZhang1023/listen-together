const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let playlist = [];
let currentIndex = 0;
let isPlaying = false;
let currentTime = 0;
let mode = "ordered"; // or "random"

function getCurrentSong() {
    if (playlist.length === 0) return null;

    if (mode === "random") {
        currentIndex = Math.floor(Math.random() * playlist.length);
    }

    return playlist[currentIndex];
}

io.on("connection", (socket) => {
    console.log("User connected");

    // Send current state to new user
    socket.emit("syncState", {
        playlist,
        currentIndex,
        isPlaying,
        currentTime,
        mode
    });

    socket.on("addSong", (song) => {
        playlist.push(song);
        io.emit("updatePlaylist", playlist);
    });

    socket.on("deleteSong", (index) => {
        playlist.splice(index, 1);
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

    socket.on("next", () => {
        if (playlist.length === 0) return;

        if (mode === "ordered") {
            currentIndex = (currentIndex + 1) % playlist.length;
        } else {
            currentIndex = Math.floor(Math.random() * playlist.length);
        }

        io.emit("next", currentIndex);
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