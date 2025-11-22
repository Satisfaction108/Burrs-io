import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to bugs.json file
const BUGS_FILE = path.join(__dirname, '..', 'bugs.json');

// Helper function to read bugs from file
async function readBugs() {
  try {
    const data = await fs.readFile(BUGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, return empty array
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

// Helper function to write bugs to file
async function writeBugs(bugs) {
  await fs.writeFile(BUGS_FILE, JSON.stringify(bugs, null, 2), 'utf-8');
}

// POST /api/bugs - Submit a bug report
router.post('/', async (req, res) => {
  try {
    const { description, steps, expected, username, userAgent, url } = req.body;

    // Validate required fields
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ 
        error: 'Bug description is required and must be at least 10 characters' 
      });
    }

    // Create bug report object
    const bugReport = {
      id: `bug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      description: description.trim(),
      steps: steps?.trim() || '',
      expected: expected?.trim() || '',
      username: username || 'Guest',
      userAgent: userAgent || 'Unknown',
      url: url || 'Unknown',
    };

    // Read existing bugs
    const bugs = await readBugs();

    // Add new bug report
    bugs.push(bugReport);

    // Write back to file
    await writeBugs(bugs);

    console.log(`🐛 Bug report submitted by ${bugReport.username}: ${bugReport.id}`);

    res.status(201).json({ 
      success: true, 
      message: 'Bug report submitted successfully',
      bugId: bugReport.id
    });
  } catch (error) {
    console.error('❌ Error saving bug report:', error);
    res.status(500).json({ 
      error: 'Failed to save bug report. Please try again.' 
    });
  }
});

// GET /api/bugs - Get all bug reports (optional, for admin use)
router.get('/', async (req, res) => {
  try {
    const bugs = await readBugs();
    res.json({ bugs, count: bugs.length });
  } catch (error) {
    console.error('❌ Error reading bug reports:', error);
    res.status(500).json({ 
      error: 'Failed to read bug reports' 
    });
  }
});

export default router;

