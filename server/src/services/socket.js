import { Server } from "socket.io";
import { socketRateLimit } from "../middleware/rateLimiter.js";

let io;

export const initSocket = (httpServer, allowedOrigins) => {
  io = new Server(httpServer, {
    cors: {
      // Erlaube Frontend-Zugriff
      origin: allowedOrigins || process.env.FRONTEND_URL || "*", 
      methods: ["GET", "POST"]
    }
  });
  
  // 🛡️ SECURITY: Rate Limit für Verbindungsaufbau
  io.use(socketRateLimit);

  console.log("✅ Socket.io Initialized");
  
  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);
    socket.on("disconnect", () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized! Call initSocket in index.js first.");
  }
  return io;
};