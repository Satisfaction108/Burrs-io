import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { NAMETAG_CUSTOMIZATIONS, SPIKE_CUSTOMIZATIONS, getCustomizationById } from '../customizations.js';

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
    console.log('✅ Customizations routes connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error in customizations routes:', error);
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

// Get all available customizations
router.get('/available', (req, res) => {
  res.json({
    nametags: NAMETAG_CUSTOMIZATIONS,
    spikes: SPIKE_CUSTOMIZATIONS
  });
});

// Get user's owned customizations and active selections
router.get('/owned', authenticateToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      premiumOrbs: user.premiumOrbs || 0,
      ownedCustomizations: user.ownedCustomizations || [],
      activeNametag: user.activeNametag || null,
      activeSpike: user.activeSpike || null
    });
  } catch (error) {
    console.error('Error fetching owned customizations:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Purchase a customization
router.post('/purchase', authenticateToken, async (req, res) => {
  try {
    const { customizationId } = req.body;

    if (!customizationId) {
      return res.status(400).json({ error: 'Customization ID required' });
    }

    const customization = getCustomizationById(customizationId);
    
    if (!customization) {
      return res.status(404).json({ error: 'Customization not found' });
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already owned
    if (user.ownedCustomizations && user.ownedCustomizations.includes(customizationId)) {
      return res.status(400).json({ error: 'Already owned' });
    }

    // Check if user has enough orbs
    const userOrbs = user.premiumOrbs || 0;
    if (userOrbs < customization.price) {
      return res.status(400).json({ error: 'Insufficient premium orbs' });
    }

    // Deduct orbs and add to owned customizations
    await usersCollection.updateOne(
      { _id: new ObjectId(req.user.userId) },
      {
        $inc: { premiumOrbs: -customization.price },
        $push: { ownedCustomizations: customizationId }
      }
    );

    res.json({
      message: 'Customization purchased successfully',
      premiumOrbs: userOrbs - customization.price,
      customizationId
    });
  } catch (error) {
    console.error('Error purchasing customization:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Equip a customization
router.post('/equip', authenticateToken, async (req, res) => {
  try {
    const { customizationId } = req.body;

    if (!customizationId) {
      return res.status(400).json({ error: 'Customization ID required' });
    }

    const customization = getCustomizationById(customizationId);
    
    if (!customization) {
      return res.status(404).json({ error: 'Customization not found' });
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user owns this customization (or if it's the default)
    if (customization.price > 0 && (!user.ownedCustomizations || !user.ownedCustomizations.includes(customizationId))) {
      return res.status(403).json({ error: 'Customization not owned' });
    }

    // Equip the customization
    const updateField = customization.type === 'nametag' ? 'activeNametag' : 'activeSpike';
    await usersCollection.updateOne(
      { _id: new ObjectId(req.user.userId) },
      { $set: { [updateField]: customizationId } }
    );

    res.json({
      message: 'Customization equipped successfully',
      customizationId,
      type: customization.type
    });
  } catch (error) {
    console.error('Error equipping customization:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

