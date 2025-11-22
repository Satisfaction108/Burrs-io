import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// MongoDB connection
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;
let usersCollection;

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db('burrs-io');
    usersCollection = db.collection('users');
    console.log('✅ Game routes connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error in game routes:', error);
  }
}

connectDB();

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Add premium orbs to user's balance (called when user dies)
router.post('/add-orbs', authenticateToken, async (req, res) => {
  try {
    const { orbs } = req.body;

    if (typeof orbs !== 'number' || orbs < 0) {
      return res.status(400).json({ error: 'Invalid orbs amount' });
    }

    // Update user's premium orbs balance
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(req.user.userId) },
      { $inc: { premiumOrbs: orbs } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get updated balance
    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });

    res.json({
      message: 'Premium orbs added successfully',
      orbsAdded: orbs,
      totalOrbs: user.premiumOrbs || 0
    });
  } catch (error) {
    console.error('Error adding orbs:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get server status (player count, etc.) - no auth required
router.get('/status', (req, res) => {
  try {
    // Import the players Map from gameServer.js
    // Since we can't directly import from gameServer.js, we'll use a workaround
    // by storing the player count in a global variable or using a shared module

    // For now, we'll return a mock response
    // This will be updated when we integrate with the actual game server
    const playerCount = global.playerCount || 0;

    res.json({
      status: 'online',
      playerCount: playerCount,
      maxPlayers: 50,
      serverName: process.env.SERVER_NAME || 'Game Server',
      serverRegion: process.env.SERVER_REGION || 'unknown'
    });
  } catch (error) {
    console.error('Error getting server status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

