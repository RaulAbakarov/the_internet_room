/**
 * The Internet Room - Server
 * 
 * A minimalist shared digital room where only one user
 * can be present at any given time globally.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import {
  getState,
  acquireLock,
  releaseLock,
  updateHeartbeat,
  checkStaleLocks,
  getRoomContent,
  forceClear
} from './store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const CONFIG = {
  HEARTBEAT_INTERVAL: 12000,      // Client heartbeat every 12 seconds
  HEARTBEAT_TIMEOUT: 30000,       // 30 seconds without heartbeat = dead
  HARD_SESSION_TIMEOUT: 180000,   // 3 minutes hard limit (180 seconds)
  STALE_CHECK_INTERVAL: 5000,     // Check for stale locks every 5 seconds
  MAX_TEXT_LENGTH: 500,           // Maximum characters for text
  ADMIN_SECRET: process.env.ADMIN_SECRET || 'the-void-awaits'
};

// Rate limiting state
const rateLimits = new Map();
const RATE_LIMIT = {
  ENTRY_WINDOW: 60000,    // 1 minute window
  ENTRY_MAX: 5,           // Max 5 entry attempts per minute
  HEARTBEAT_MAX: 10       // Max 10 heartbeats per minute
};

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

/**
 * Simple rate limiter
 */
function rateLimit(ip, action) {
  const key = `${ip}:${action}`;
  const now = Date.now();
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, []);
  }
  
  const timestamps = rateLimits.get(key).filter(t => now - t < RATE_LIMIT.ENTRY_WINDOW);
  const maxAllowed = action === 'entry' ? RATE_LIMIT.ENTRY_MAX : RATE_LIMIT.HEARTBEAT_MAX;
  
  if (timestamps.length >= maxAllowed) {
    return false;
  }
  
  timestamps.push(now);
  rateLimits.set(key, timestamps);
  return true;
}

/**
 * Clean up old rate limit entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimits.entries()) {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT.ENTRY_WINDOW);
    if (valid.length === 0) {
      rateLimits.delete(key);
    } else {
      rateLimits.set(key, valid);
    }
  }
}, 60000);

/**
 * Check for stale locks periodically
 */
setInterval(async () => {
  const result = await checkStaleLocks(CONFIG.HEARTBEAT_TIMEOUT, CONFIG.HARD_SESSION_TIMEOUT);
  if (result.released) {
    console.log(`[SERVER] Lock released due to: ${result.reason}`);
  }
}, CONFIG.STALE_CHECK_INTERVAL);

// ============================================================
// API ENDPOINTS
// ============================================================

/**
 * GET /api/status
 * Check room occupancy status
 */
app.get('/api/status', async (req, res) => {
  try {
    const state = await getState();
    
    const response = {
      occupied: state.is_occupied
    };
    
    // If occupied, include how long (rounded to minutes)
    if (state.is_occupied && state.occupied_since) {
      const elapsed = Date.now() - state.occupied_since;
      response.occupiedMinutes = Math.floor(elapsed / 60000);
    }
    
    res.json(response);
  } catch (err) {
    console.error('Error in /api/status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/enter
 * Attempt to enter the room
 */
app.post('/api/enter', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  
  // Rate limiting
  if (!rateLimit(ip, 'entry')) {
    return res.status(429).json({ 
      success: false, 
      error: 'Too many attempts. Please wait.' 
    });
  }
  
  try {
    // Generate session ID
    const sessionId = uuidv4();
    
    // Attempt to acquire lock
    const result = await acquireLock(sessionId);
    
    if (!result.success) {
      return res.json({ 
        success: false, 
        error: 'Room is occupied' 
      });
    }
    
    // Get previous content to show the new visitor
    const content = await getRoomContent();
    
    console.log(`[ENTRY] New session: ${sessionId.slice(0, 8)}... from ${ip}`);
    
    res.json({
      success: true,
      sessionId,
      content,
      config: {
        heartbeatInterval: CONFIG.HEARTBEAT_INTERVAL,
        maxTextLength: CONFIG.MAX_TEXT_LENGTH
      }
    });
  } catch (err) {
    console.error('Error in /api/enter:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/heartbeat
 * Keep the session alive
 */
app.post('/api/heartbeat', async (req, res) => {
  const { sessionId, content } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing session ID' });
  }
  
  // Rate limiting
  if (!rateLimit(ip, 'heartbeat')) {
    return res.status(429).json({ success: false, error: 'Too many heartbeats' });
  }
  
  try {
    // Update heartbeat
    const result = await updateHeartbeat(sessionId);
    
    if (!result.success) {
      return res.json({ 
        success: false, 
        error: 'Session expired or invalid',
        terminated: true
      });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/heartbeat:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/leave
 * Leave the room and save content
 */
app.post('/api/leave', async (req, res) => {
  const { sessionId, content } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing session ID' });
  }
  
  try {
    // Validate and sanitize content
    let sanitizedContent = null;
    if (content) {
      sanitizedContent = {
        text: typeof content.text === 'string' 
          ? content.text.slice(0, CONFIG.MAX_TEXT_LENGTH) 
          : '',
        drawing: content.drawing || null
      };
    }
    
    // Release lock and save content
    const result = await releaseLock(sessionId, sanitizedContent);
    
    if (!result.success) {
      console.log(`[LEAVE] Failed for session ${sessionId.slice(0, 8)}...: ${result.reason}`);
      return res.json({ success: false, error: result.reason });
    }
    
    console.log(`[LEAVE] Session ended: ${sessionId.slice(0, 8)}...`);
    res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/leave:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/clear
 * Emergency room clearing (admin only)
 */
app.post('/api/admin/clear', async (req, res) => {
  const { secret } = req.body;
  
  if (secret !== CONFIG.ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  
  try {
    await forceClear();
    console.log('[ADMIN] Room forcibly cleared');
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/admin/clear:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/status
 * Full room status (admin only)
 */
app.get('/api/admin/status', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  
  if (secret !== CONFIG.ADMIN_SECRET) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  
  try {
    const state = await getState();
    res.json({ 
      success: true, 
      state,
      config: CONFIG
    });
  } catch (err) {
    console.error('Error in /api/admin/status:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Serve the main page for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║         THE INTERNET ROOM                 ║
║                                           ║
║  Server running on port ${PORT}              ║
║                                           ║
║  Hard timeout: ${CONFIG.HARD_SESSION_TIMEOUT / 1000}s                       ║
║  Heartbeat timeout: ${CONFIG.HEARTBEAT_TIMEOUT / 1000}s                   ║
╚═══════════════════════════════════════════╝
  `);
});
