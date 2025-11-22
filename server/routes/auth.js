import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
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
    console.log('✅ Auth routes connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error in auth routes:', error);
  }
}

connectDB();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, password, confirmPassword } = req.body;
    
    // Validation
    if (!username || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }
    
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords don\'t match!' });
    }
    
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    
    // Check alphanumeric
    if (!/^[a-zA-Z0-9]+$/.test(username)) {
      return res.status(400).json({ error: 'Username must be alphanumeric only' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check if user exists
    const existingUser = await usersCollection.findOne({ username });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists!' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Create user
    const newUser = {
      username,
      password: hashedPassword,
      createdAt: new Date(),
      lastLogin: new Date()
    };
    
    const result = await usersCollection.insertOne(newUser);
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: result.insertedId.toString(), username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      message: 'Success! Account created.',
      token,
      user: {
        id: result.insertedId.toString(),
        username
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }
    
    // Find user
    const user = await usersCollection.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password!' });
    }
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password!' });
    }
    
    // Update last login
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id.toString(), username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id.toString(),
        username: user.username
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Verify token
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await usersCollection.findOne({ _id: decoded.userId });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    res.json({
      user: {
        id: user._id.toString(),
        username: user.username
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;

