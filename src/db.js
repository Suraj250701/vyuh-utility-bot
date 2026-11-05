const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const databasePath = process.env.DATABASE_PATH || "./data/tickets.sqlite";
const resolvedPath = path.resolve(databasePath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const db = new Database(resolvedPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL UNIQUE,
    control_channel_id TEXT,
    owner_id TEXT NOT NULL,
    category_key TEXT NOT NULL,
    category_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    claimed_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,
    closed_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_owner_status
  ON tickets(guild_id, owner_id, status);

  CREATE TABLE IF NOT EXISTS ticket_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(ticket_id) REFERENCES tickets(id)
  );
`);

// Safe migration for databases created by earlier bot versions.
const ticketColumns = db.prepare("PRAGMA table_info(tickets)").all().map(column => column.name);
if (!ticketColumns.includes("control_channel_id")) {
  db.exec("ALTER TABLE tickets ADD COLUMN control_channel_id TEXT");
}

module.exports = db;