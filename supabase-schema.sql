-- The Internet Room - Supabase Schema
-- Run this in your Supabase SQL Editor to create the required table

CREATE TABLE IF NOT EXISTS room_state (
  room_id TEXT PRIMARY KEY DEFAULT 'the-room',
  current_text TEXT DEFAULT '',
  current_drawing TEXT, -- Base64 encoded drawing data
  is_occupied BOOLEAN DEFAULT false,
  session_id TEXT,
  occupied_since TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the default room row
INSERT INTO room_state (room_id, current_text, is_occupied)
VALUES ('the-room', '', false)
ON CONFLICT (room_id) DO NOTHING;

-- Enable Row Level Security (optional but recommended)
ALTER TABLE room_state ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for the app (using anon key)
CREATE POLICY "Allow anonymous access" ON room_state
  FOR ALL
  USING (true)
  WITH CHECK (true);
