import express from "express";
import http from "http";
import { Server } from "socket.io";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// 📂 File uploads setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath);
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

// 📝 Store last 5 messages per room
const roomMessages = {}; // { roomId: [msg1, msg2, ...] }

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 🔌 Socket.io
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Joining a room
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);

    // ✅ Send last 5 messages if exist
    if (roomMessages[roomId]) {
      socket.emit("room-messages", roomMessages[roomId]);
    }
  });

  // Receiving a new message
  socket.on("room-message", (data) => {
    const { roomId } = data;

    if (!roomMessages[roomId]) {
      roomMessages[roomId] = [];
    }

    // Push new message
    roomMessages[roomId].push(data);

    // Keep only last 5
    if (roomMessages[roomId].length > 5) {
      roomMessages[roomId].shift();
    }

    // Broadcast new message to everyone
    io.to(roomId).emit("room-message", data);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// 📤 REST API for uploads
app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const fileUrl = `http://localhost:5000/uploads/${file.filename}`;
  res.json({
    success: true,
    fileName: file.originalname,
    fileType: file.mimetype,
    fileUrl,
  });
});

// 🚀 Start server
const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
