-- Cooling D1 Database Schema
-- Minimal schema for two-person pairing and chomp functionality

-- Pairs table: stores paired connections
-- pair_code_hash: SHA-256 hash of the pairing code
-- last_chomp_at: timestamp of most recent chomp by either member (for relative display)
CREATE TABLE IF NOT EXISTS pairs (
  id TEXT PRIMARY KEY,
  pair_code_hash TEXT UNIQUE NOT NULL,
  last_chomp_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Members table: stores the two members of each pair
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
  device_id TEXT UNIQUE NOT NULL,
  push_endpoint TEXT,
  push_p256dh TEXT,
  push_auth TEXT,
  push_user_agent TEXT,
  push_updated_at INTEGER,
  last_chomp_at INTEGER,
  last_received_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Index for fast lookup by pair_id
CREATE INDEX IF NOT EXISTS idx_members_pair_id ON members(pair_id);

-- Index for fast lookup by device_id
CREATE INDEX IF NOT EXISTS idx_members_device_id ON members(device_id);

-- Index for pair code hash lookup
CREATE INDEX IF NOT EXISTS idx_pairs_code_hash ON pairs(pair_code_hash);
