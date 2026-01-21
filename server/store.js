/**
 * Simple file-based data store for The Internet Room
 * Stores room content and lock state
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/room.json');

// Ensure data directory exists
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Default room state
const DEFAULT_STATE = {
  // Room content (left by previous visitor)
  current_text: '',
  current_drawing: null, // Base64 encoded drawing data
  
  // Lock state
  is_occupied: false,
  session_id: null,
  occupied_since: null,
  last_heartbeat_at: null
};

/**
 * Load room state from disk
 */
function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return { ...DEFAULT_STATE, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Error loading state:', err.message);
  }
  return { ...DEFAULT_STATE };
}

/**
 * Save room state to disk
 */
function saveState(state) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Error saving state:', err.message);
  }
}

/**
 * Get current room state
 */
export function getState() {
  return loadState();
}

/**
 * Update room state
 */
export function updateState(updates) {
  const current = loadState();
  const newState = { ...current, ...updates };
  saveState(newState);
  return newState;
}

/**
 * Acquire the room lock
 */
export function acquireLock(sessionId) {
  const state = loadState();
  
  if (state.is_occupied) {
    return { success: false, reason: 'occupied' };
  }
  
  const now = Date.now();
  const newState = updateState({
    is_occupied: true,
    session_id: sessionId,
    occupied_since: now,
    last_heartbeat_at: now
  });
  
  return { success: true, state: newState };
}

/**
 * Release the room lock
 */
export function releaseLock(sessionId, content = null) {
  const state = loadState();
  
  // Only the lock holder can release, or force release
  if (state.session_id !== sessionId && sessionId !== 'FORCE') {
    return { success: false, reason: 'not_owner' };
  }
  
  const updates = {
    is_occupied: false,
    session_id: null,
    occupied_since: null,
    last_heartbeat_at: null
  };
  
  // Save content if provided
  if (content !== null) {
    if (content.text !== undefined) {
      updates.current_text = content.text;
    }
    if (content.drawing !== undefined) {
      updates.current_drawing = content.drawing;
    }
  }
  
  const newState = updateState(updates);
  return { success: true, state: newState };
}

/**
 * Update heartbeat timestamp
 */
export function updateHeartbeat(sessionId) {
  const state = loadState();
  
  if (state.session_id !== sessionId) {
    return { success: false, reason: 'not_owner' };
  }
  
  updateState({ last_heartbeat_at: Date.now() });
  return { success: true };
}

/**
 * Check and release stale locks
 * Called periodically by the server
 */
export function checkStaleLocks(heartbeatTimeout, hardTimeout) {
  const state = loadState();
  
  if (!state.is_occupied) {
    return { released: false };
  }
  
  const now = Date.now();
  const heartbeatAge = now - state.last_heartbeat_at;
  const sessionAge = now - state.occupied_since;
  
  // Check heartbeat timeout (30 seconds)
  if (heartbeatAge > heartbeatTimeout) {
    console.log(`[LOCK] Releasing stale lock: heartbeat timeout (${Math.round(heartbeatAge/1000)}s)`);
    releaseLock('FORCE');
    return { released: true, reason: 'heartbeat_timeout' };
  }
  
  // Check hard session timeout (3-5 minutes)
  if (sessionAge > hardTimeout) {
    console.log(`[LOCK] Releasing lock: hard timeout (${Math.round(sessionAge/1000)}s)`);
    releaseLock('FORCE');
    return { released: true, reason: 'hard_timeout' };
  }
  
  return { released: false };
}

/**
 * Get room content only (for display)
 */
export function getRoomContent() {
  const state = loadState();
  return {
    text: state.current_text,
    drawing: state.current_drawing
  };
}

/**
 * Force clear the room (admin only)
 */
export function forceClear() {
  const newState = updateState({
    is_occupied: false,
    session_id: null,
    occupied_since: null,
    last_heartbeat_at: null,
    current_text: '',
    current_drawing: null
  });
  return { success: true, state: newState };
}
