const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const readline = require("readline");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  maxHttpBufferSize: 2 * 1024 * 1024 // 2MB payload cap
});

app.use(express.static(path.join(__dirname, "public")));

const MAX_HISTORY = 500;
const MAX_USERNAME = 32;
const MAX_TEXT = 2000;
const MAX_IMAGE_DATA_URL = 1_400_000; // rough cap (~1MB binary)
const RATE_WINDOW_MS = 4000;
const RATE_LIMIT_COUNT = 10;
const AVATAR_DB_PATH = path.join(__dirname, "avatars.json");

let messageHistory = [];
let avatarByUser = {};

if (fs.existsSync(AVATAR_DB_PATH)) {
  try {
    avatarByUser = JSON.parse(fs.readFileSync(AVATAR_DB_PATH, "utf8"));
  } catch {
    avatarByUser = {};
  }
}

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function clampString(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function isAllowedDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return false;
  if (!dataUrl.startsWith("data:image/")) return false;
  if (!dataUrl.includes(";base64,")) return false;
  if (dataUrl.length > MAX_IMAGE_DATA_URL) return false;
  return true;
}

function saveAvatars() {
  fs.writeFileSync(AVATAR_DB_PATH, JSON.stringify(avatarByUser, null, 2), "utf8");
}

function normalizeAvatar(avatar, username) {
  if (isAllowedDataUrl(avatar)) return avatar;
  if (isAllowedDataUrl(avatarByUser[username])) return avatarByUser[username];
  return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}&size=64`;
}

function pushHistory(msg) {
  messageHistory.push(msg);
  if (messageHistory.length > MAX_HISTORY) {
    messageHistory = messageHistory.slice(messageHistory.length - MAX_HISTORY);
  }
}

io.on("connection", (socket) => {
  socket.data.messageTimestamps = [];
  socket.data.avatar = null;

  socket.on("get history", () => {
    socket.emit("message history", messageHistory);
  });

  socket.on("set avatar", ({ username, avatar }) => {
    const safeUsername = clampString(username, MAX_USERNAME);
    if (!safeUsername) return;

    if (!avatar) {
      delete avatarByUser[safeUsername];
      socket.data.avatar = null;
      saveAvatars();
      return;
    }

    if (!isAllowedDataUrl(avatar)) return;
    socket.data.avatar = avatar;
    avatarByUser[safeUsername] = avatar;
    saveAvatars();
  });

  socket.on("chat message", (payload = {}) => {
    const now = Date.now();
    socket.data.messageTimestamps = socket.data.messageTimestamps.filter(
      (ts) => now - ts < RATE_WINDOW_MS
    );

    if (socket.data.messageTimestamps.length >= RATE_LIMIT_COUNT) {
      socket.emit("announcement", "메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.");
      return;
    }

    const username = clampString(payload.username, MAX_USERNAME) || "Anonymous";
    const text = clampString(payload.text, MAX_TEXT);
    const image = isAllowedDataUrl(payload.image) ? payload.image : null;
    const incomingAvatar = isAllowedDataUrl(payload.avatar) ? payload.avatar : socket.data.avatar;
    if (isAllowedDataUrl(incomingAvatar)) {
      avatarByUser[username] = incomingAvatar;
      saveAvatars();
    }

    const avatar = normalizeAvatar(incomingAvatar, username);

    if (!text && !image) return;

    socket.data.messageTimestamps.push(now);

    const msg = {
      username,
      text,
      image,
      timestamp: getCurrentTimestamp(),
      avatar
    };

    pushHistory(msg);
    io.emit("chat message", msg);
  });
});

server.listen(80, "0.0.0.0", () => {
  console.log("Chat server running on port 80");
  console.log("Type 'help' for server commands.\n");
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> "
});

rl.prompt();

rl.on("line", (line) => {
  const args = line.trim().split(" ");
  const cmd = args[0];
  const content = args.slice(1).join(" ");

  switch (cmd) {
    case "help":
      console.log(`
Commands:
  list                Show message history
  delete <index>      Delete a message by number
  clear               Clear all messages
  announce <message>  Send popup to all users
  exit                Quit server
`);
      break;

    case "list":
      messageHistory.forEach((msg, i) => {
        const imageText = msg.image ? " [image]" : "";
        console.log(`[${i}] [${msg.timestamp}] ${msg.username}: ${msg.text || ""}${imageText}`);
      });
      break;

    case "delete": {
      const index = Number.parseInt(args[1], 10);
      if (Number.isNaN(index) || index < 0 || index >= messageHistory.length) {
        console.log("Invalid message index.");
      } else {
        const removed = messageHistory.splice(index, 1)[0];
        console.log(`Deleted: [${removed.timestamp}] ${removed.username}: ${removed.text || "[image]"}`);
        io.emit("message history", messageHistory);
      }
      break;
    }

    case "clear":
      messageHistory = [];
      console.log("Message history cleared.");
      io.emit("message history", messageHistory);
      break;

    case "announce":
      if (!content) {
        console.log("Usage: announce <message>");
      } else {
        console.log("Announcement sent.");
        io.emit("announcement", content);
      }
      break;

    case "exit":
      console.log("Shutting down server...");
      process.exit(0);

    default:
      console.log(`Unknown command: '${cmd}'. Type 'help' for commands.`);
  }

  rl.prompt();
});
