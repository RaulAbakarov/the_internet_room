/**
 * Supabase-based data store for The Internet Room
 * Stores room content and lock state in PostgreSQL
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// Room ID (single room concept)
const ROOM_ID = 'the-room';

// Default room state
const DEFAULT_STATE = {
  current_text: '',
  current_drawing: null,
  is_occupied: false,
  session_id: null,
  occupied_since: null,
  last_heartbeat_at: null
};

/**
 * Load room state from Supabase
 */
async function loadState() {
  try {
    const { data, error } = await supabase
      .from('room_state')
      .select('*')
      .eq('room_id', ROOM_ID)
      .single();
    
    if (error && error.code !== 'PGRST116') {
      console.error('Error loading state:', error.message);
      return { ...DEFAULT_STATE };
    }
    
    if (!data) {
      // Create initial row if doesn't exist
      await saveState(DEFAULT_STATE);
      return { ...DEFAULT_STATE };
    }
    
    return {
      current_text: data.current_text || '',
      current_drawing: data.current_drawing || null,
      is_occupied: data.is_occupied || false,
      session_id: data.session_id || null,
      occupied_since: data.occupied_since ? new Date(data.occupied_since).getTime() : null,
      last_heartbeat_at: data.last_heartbeat_at ? new Date(data.last_heartbeat_at).getTime() : null
    };
  } catch (err) {
    console.error('Error loading state:', err.message);
    return { ...DEFAULT_STATE };
  }
}

/**
 * Save room state to Supabase
 */
async function saveState(state) {
  try {
    const { error } = await supabase
      .from('room_state')
      .upsert({
        room_id: ROOM_ID,
        current_text: state.current_text,
        current_drawing: state.current_drawing,
        is_occupied: state.is_occupied,
        session_id: state.session_id,
        occupied_since: state.occupied_since ? new Date(state.occupied_since).toISOString() : null,
        last_heartbeat_at: state.last_heartbeat_at ? new Date(state.last_heartbeat_at).toISOString() : null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'room_id' });
    
    if (error) {
      console.error('Error saving state:', error.message);
    }
  } catch (err) {
    console.error('Error saving state:', err.message);
  }
}

/**
 * Get current room state
 */
export async function getState() {
  return await loadState();
}

/**
 * Update room state
 */
export async function updateState(updates) {
  const current = await loadState();
  const newState = { ...current, ...updates };
  await saveState(newState);
  return newState;
}

/**
 * Acquire the room lock
 */
export async function acquireLock(sessionId) {
  const state = await loadState();
  
  if (state.is_occupied) {
    return { success: false, reason: 'occupied' };
  }
  
  const now = Date.now();
  const newState = await updateState({
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
export async function releaseLock(sessionId, content = null) {
  const state = await loadState();
  
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
  
  const newState = await updateState(updates);
  return { success: true, state: newState };
}

/**
 * Update heartbeat timestamp
 */
export async function updateHeartbeat(sessionId) {
  const state = await loadState();
  
  if (state.session_id !== sessionId) {
    return { success: false, reason: 'not_owner' };
  }
  
  await updateState({ last_heartbeat_at: Date.now() });
  return { success: true };
}

/**
 * Check and release stale locks
 */
export async function checkStaleLocks(heartbeatTimeout, hardTimeout) {
  const state = await loadState();
  
  if (!state.is_occupied) {
    return { released: false };
  }
  
  const now = Date.now();
  const heartbeatAge = now - state.last_heartbeat_at;
  const sessionAge = now - state.occupied_since;
  
  // Check heartbeat timeout (30 seconds)
  if (heartbeatAge > heartbeatTimeout) {
    console.log(`[LOCK] Releasing stale lock: heartbeat timeout (${Math.round(heartbeatAge/1000)}s)`);
    await releaseLock('FORCE');
    return { released: true, reason: 'heartbeat_timeout' };
  }
  
  // Check hard session timeout (3-5 minutes)
  if (sessionAge > hardTimeout) {
    console.log(`[LOCK] Releasing lock: hard timeout (${Math.round(sessionAge/1000)}s)`);
    await releaseLock('FORCE');
    return { released: true, reason: 'hard_timeout' };
  }
  
  return { released: false };
}

/**
 * Get room content only (for display)
 */
export async function getRoomContent() {
  const state = await loadState();
  return {
    text: state.current_text,
    drawing: state.current_drawing
  };
}

/**
 * Force clear the room (admin only)
 */
export async function forceClear() {
  await updateState({
    is_occupied: false,
    session_id: null,
    occupied_since: null,
    last_heartbeat_at: null,
    current_text: '',
    current_drawing: null
  });
  return { success: true };
}
