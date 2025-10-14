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
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Increase limits
app.use(express.json({ limit: "5gb" }));
app.use(express.urlencoded({ extended: true, limit: "5gb" }));
server.timeout = 0;

// Upload folder
const uploadPath = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);


// Multer setup
function autoCleanUploads(maxAgeHours = 24, minFreeGB = 1) {
  try {
    const stats = fs.statSync(uploadPath);
    const files = fs.readdirSync(uploadPath);
    const freeGB = os.freemem() / 1024 ** 3;

    files.forEach((file) => {
      const filePath = path.join(uploadPath, file);
      const fileStats = fs.statSync(filePath);
      const ageHours = (Date.now() - fileStats.mtimeMs) / 1000 / 3600;

      // delete if older than 24h or free space < 1GB
      if (ageHours > maxAgeHours || freeGB < minFreeGB) {
        fs.unlinkSync(filePath);
        console.log(`🧹 Deleted old file: ${file}`);
      }
    });
  } catch (err) {
    console.error("⚠️ Auto-clean error:", err.message);
  }
}
// Clean every hour
setInterval(autoCleanUploads, 60 * 60 * 1000);

// 📦 Multer for normal uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4 GB limit
});
// Serve files
app.use("/uploads", express.static(uploadPath));

// Room messages storage
const roomMessages = {};

// Socket.io
io.on("connection", (socket) => {
  console.log("✅ New client connected:", socket.id);

  // Join room
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`📌 User ${socket.id} joined room ${roomId}`);

    if (!roomMessages[roomId]) roomMessages[roomId] = { messages: [], contentType: "text" };

    socket.emit("room-messages", roomMessages[roomId].messages);
    socket.emit("room-contentType", roomMessages[roomId].contentType);
  });

  // Change content type
  socket.on("room-contentType", ({ roomId, type }) => {
    if (!roomMessages[roomId]) roomMessages[roomId] = { messages: [], contentType: type };
    roomMessages[roomId].contentType = type;
    io.to(roomId).emit("room-contentType", type);
    console.log(`🔄 Room ${roomId} contentType changed to: ${type}`);
  });

  // Text messages
  socket.on("room-message", (data) => {
    const { roomId } = data;
    if (!roomMessages[roomId]) roomMessages[roomId] = { messages: [], contentType: "text" };
    roomMessages[roomId].messages.push(data);
    if (roomMessages[roomId].messages.length > 5) roomMessages[roomId].messages.shift();
    io.to(roomId).emit("room-message", data);
  });

  // -------- Chunked Upload --------

  socket.on("upload-start", ({ roomId, fileName, totalChunks, fileType }) => {
    const tempPath = path.join(uploadPath, `${Date.now()}-${fileName}`);
    socket.uploadFile = { path: tempPath, fileName, fileType, totalChunks, chunksReceived: 0, roomId };
    console.log(`🚀 Upload started: ${fileName}`);
  });

  socket.on("upload-chunk", async ({ chunkData }) => {
    if (!socket.uploadFile) return;

    // Append chunk asynchronously
    await fs.promises.appendFile(socket.uploadFile.path, Buffer.from(chunkData));
    socket.uploadFile.chunksReceived++;

    const percent = Math.round((socket.uploadFile.chunksReceived / socket.uploadFile.totalChunks) * 100);
    socket.emit("upload-progress", { fileName: socket.uploadFile.fileName, percent });

    // console.log(`📦 Chunk ${socket.uploadFile.chunksReceived}/${socket.uploadFile.totalChunks} (${percent}%)`);

    // Complete upload automatically
    if (socket.uploadFile.chunksReceived === socket.uploadFile.totalChunks) {
      const { fileName, fileType, path: filePath, roomId } = socket.uploadFile;
      const fileUrl = `${process.env.BASE_URL || "http://localhost:5000"}/uploads/${path.basename(filePath)}`;

      const fileMessage = { roomId, type: "file", fileName, fileType, data: fileUrl };
      if (!roomMessages[roomId]) roomMessages[roomId] = { messages: [], contentType: "text" };
      roomMessages[roomId].messages.push(fileMessage);
      if (roomMessages[roomId].messages.length > 5) roomMessages[roomId].messages.shift();

      io.to(roomId).emit("room-message", fileMessage);
      socket.emit("upload-progress", { fileName, percent: 100 });

      delete socket.uploadFile;
      console.log(`✅ File upload complete & broadcasted: ${fileName}`);
    }
  });

  // Cleanup incomplete uploads on disconnect
  socket.on("disconnect", () => {
    if (socket.uploadFile && fs.existsSync(socket.uploadFile.path)) {
      fs.unlinkSync(socket.uploadFile.path);
      console.log(`🗑️ Removed incomplete upload: ${socket.uploadFile.fileName}`);
    }
    console.log("❌ Client disconnected:", socket.id);
  });
});

// REST API upload (alternative)
app.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).send("No file uploaded");

  const fileUrl = `${process.env.BASE_URL || "http://localhost:5000"}/uploads/${file.filename}`;
  res.json({ success: true, fileName: file.originalname, fileType: file.mimetype, fileUrl });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
