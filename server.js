const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const readline = require("readline");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, "public")));

let messageHistory = []; // store messages in memory

// Helper to get current time as ISO string
function getCurrentTimestamp() {
  return new Date().toISOString();
}

io.on("connection", (socket) => {
  socket.on("get history", () => {
    socket.emit("message history", messageHistory);
  });

  socket.on("chat message", ({ username, text }) => {
    const timestamp = getCurrentTimestamp();
    const msg = {
      username,
      text,
      timestamp,
      avatar: `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}`
    };
    messageHistory.push(msg);
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
        console.log(`[${i}] [${msg.timestamp}] ${msg.username}: ${msg.text}`);
      });
      break;

    case "delete":
      const index = parseInt(args[1]);
      if (isNaN(index) || index < 0 || index >= messageHistory.length) {
        console.log("Invalid message index.");
      } else {
        const removed = messageHistory.splice(index, 1)[0];
        console.log(`Deleted: [${removed.timestamp}] ${removed.username}: ${removed.text}`);
        io.emit("message history", messageHistory);
      }
      break;

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
