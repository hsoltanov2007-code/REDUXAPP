import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "data.sqlite");

fs.mkdirSync(path.join(__dirname, "..", "uploads"), { recursive: true });

export const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mods (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  full_description TEXT NOT NULL,
  version TEXT NOT NULL,
  size_mb INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'url',
  download_url TEXT NOT NULL,
  preview_url TEXT,
  checksum TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mod_id TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL,
  mod_id TEXT NOT NULL,
  PRIMARY KEY (user_id, mod_id)
);
`);

const existing = db.prepare("SELECT COUNT(*) as count FROM categories").get();
if (existing.count === 0) {
  const insertCategory = db.prepare(`
    INSERT INTO categories (id, name, icon, position, is_visible)
    VALUES (@id, @name, @icon, @position, @is_visible)
  `);

  const insertMod = db.prepare(`
    INSERT INTO mods (
      id, category_id, title, short_description, full_description, version,
      size_mb, source_type, download_url, preview_url, checksum, is_visible
    ) VALUES (
      @id, @category_id, @title, @short_description, @full_description, @version,
      @size_mb, @source_type, @download_url, @preview_url, @checksum, @is_visible
    )
  `);

  insertCategory.run({ id: "redux", name: "Redux", icon: "✨", position: 1, is_visible: 1 });
  insertCategory.run({ id: "gunpack", name: "Gunpack", icon: "🎯", position: 2, is_visible: 1 });
  insertCategory.run({ id: "sounds", name: "Sounds", icon: "🔊", position: 3, is_visible: 1 });

  insertMod.run({
    id: "redux-neon",
    category_id: "redux",
    title: "Neon Redux",
    short_description: "Яркий редукс для Majestic RP",
    full_description: "Сборка с переработанными цветами и эффектами.",
    version: "1.0.0",
    size_mb: 1260,
    source_type: "url",
    download_url: "https://github.com/example/example/releases/download/v1.0.0/redux.zip",
    preview_url: "",
    checksum: "",
    is_visible: 1
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(text = "") {
  return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9а-яё_-]/gi, "");
}
