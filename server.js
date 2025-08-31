require("dotenv").config();
const { MONGODB_URI } = process.env;

// Agregar estas líneas
process.env.TZ = "America/Argentina/Buenos_Aires";
console.log("Zona horaria configurada:", process.env.TZ);
console.log("Hora actual del servidor:", new Date().toLocaleString());

const express = require("express");
const cors = require("cors");
const {
  sequelize,
  testConnection,
  connectMongoDB,
  connectRedis,
  DatabaseManager
} = require("./database");
const externalApiRoutes = require("./routes/externalApiRoutes");
const bcrypt = require("bcrypt");
const db = require("./models");
const mongoose = require("mongoose");
// Removed Socket.IO dependencies for pure API architecture
const Conversation = require("./models/Conversation"); // Still needed for database index management
// Removed cron dependency - no scheduled tasks needed
// Removed mailing service - pure API chatbot

const PORT = process.env.PORT || 5001;

// Removed Botmaker cron functionality

const app = express();

// Pure API server - no WebSocket/Socket.IO support

// Configure CORS for pure API access
app.use(cors({
  origin: true, // Allow all origins for API access
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false // No credentials needed for API-only usage
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Use the webhook routes
const webhookRoutes = require("./routes/webhookRoutes");

// Core chatbot routes
app.use("/api/webhook", webhookRoutes);
app.use("/api/external", externalApiRoutes);

app.get("/", (req, res) => {
  res.send("Generic Multi-Channel Chatbot Engine API");
});

// Removed admin user creation - no dashboard users in pure API chatbot

async function removeOldIndexes() {
  try {
    await Conversation.collection.dropIndex("messages.content_text");
    console.log("Old index removed successfully");
  } catch (error) {
    if (error.code === 27) {
      console.log("Old index does not exist, skipping");
    } else {
      console.error("Error removing old index:", error);
    }
  }
}

async function removeProblematicIndexes() {
  try {
    await Conversation.collection.dropIndex("messages.content_1");
    console.log("Problematic index removed successfully");
  } catch (error) {
    if (error.code === 27) {
      console.log("Index does not exist, skipping removal");
    } else {
      console.error("Error removing index:", error);
    }
  }
}

const startServer = async () => {
  try {
    console.log("Starting server...");
    // 🏗️ PROFESSIONAL APPROACH: Use centralized database manager
    const connectionResults = await DatabaseManager.initializeAll();
    
    if (!connectionResults.postgresql || !connectionResults.mongodb || !connectionResults.redis) {
      console.error('❌ Critical database connections failed');
      process.exit(1);
    }
    
    await sequelize.sync({ alter: true });
    console.log("✅ Database schema synchronized");

    // No admin user needed for pure API chatbot

    // Start the pure API server
    app.listen(PORT, () => {
      console.log(`Generic Chatbot API Server running on port ${PORT}`);
    });

    await removeOldIndexes();
    await removeProblematicIndexes();
  } catch (error) {
    console.error("Unable to start the server:", error);
    process.exit(1);
  }
};

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Application specific logging, throwing an error, or other logic here
});

startServer();

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

// Removed WebSocket connection handling - pure API server

// Removed Botmaker cron job and email processing - pure API chatbot
