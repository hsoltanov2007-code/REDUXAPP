import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import cors from "cors";
import multer from "multer";
import { db, nowIso, slugify } from "./db.js";
import { signToken, authMiddleware, adminOnly } from "./auth.js";
import { uploadAssetToLatestRelease } from "./github.js";

const env = {
  PORT: process.env.PORT || 8787,
  JWT_SECRET: process.env.JWT_SECRET || "change_me",
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || "",
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || "",
  DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || "http://localhost:8787/auth/discord/callback",
  DISCORD_ADMIN_IDS: (process.env.DISCORD_ADMIN_IDS || "").split(",").map(v => v.trim()).filter(Boolean),
  CLIENT_DEEP_LINK: process.env.CLIENT_DEEP_LINK || "hardy://auth-success",
  GITHUB_OWNER: process.env.GITHUB_OWNER || "",
  GITHUB_REPO: process.env.GITHUB_REPO || "",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || ""
};

const app = express();
const uploadDir = path.resolve("apps/server/uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(uploadDir));

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    role: row.role
  };
}

function authUrl() {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: "code",
    redirect_uri: env.DISCORD_REDIRECT_URI,
    scope: "identify"
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: nowIso() });
});

app.get("/auth/discord/start", (_req, res) => {
  res.redirect(authUrl());
});

app.get("/auth/discord/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  try {
    const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: env.DISCORD_REDIRECT_URI
      })
    });

    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      return res.status(400).send(`Discord token error: ${JSON.stringify(tokenData)}`);
    }

    const meResp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const me = await meResp.json();

    const isAdmin = env.DISCORD_ADMIN_IDS.includes(me.id);
    db.prepare(`
      INSERT INTO users (id, username, avatar, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username=excluded.username,
        avatar=excluded.avatar,
        role=excluded.role
    `).run(me.id, me.username, me.avatar || "", isAdmin ? "admin" : "user");

    const token = signToken(
      { id: me.id, username: me.username, avatar: me.avatar || "", role: isAdmin ? "admin" : "user" },
      env.JWT_SECRET
    );

    const deepLink = `${env.CLIENT_DEEP_LINK}?token=${encodeURIComponent(token)}`;

    res.send(`
      <!doctype html>
      <html lang="ru">
        <body style="font-family:Inter,system-ui;background:#0a0a12;color:#fff;display:grid;place-items:center;height:100vh;">
          <div style="max-width:560px;padding:24px;border-radius:24px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(24px)">
            <h2>Авторизация успешна</h2>
            <p>Если приложение не открылось автоматически, нажми кнопку ниже.</p>
            <a href="${deepLink}" style="display:inline-block;padding:12px 16px;border-radius:14px;background:linear-gradient(135deg,#a855f7,#3b82f6);color:#fff;text-decoration:none;">Вернуться в HARDY</a>
          </div>
          <script>window.location.href = ${JSON.stringify(deepLink)};</script>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`Auth failed: ${String(error)}`);
  }
});

app.get("/me", authMiddleware(env.JWT_SECRET), (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: row ? publicUser(row) : req.user });
});

app.get("/categories", (req, res) => {
  const includeHidden = req.query.includeHidden === "1";
  const rows = db.prepare(`
    SELECT * FROM categories
    ${includeHidden ? "" : "WHERE is_visible = 1"}
    ORDER BY position ASC, created_at ASC
  `).all();
  res.json({ items: rows });
});

app.get("/mods", (req, res) => {
  const categoryId = req.query.categoryId;
  const includeHidden = req.query.includeHidden === "1";

  const rows = db.prepare(`
    SELECT * FROM mods
    WHERE (? IS NULL OR category_id = ?)
      AND (${includeHidden ? "1=1" : "is_visible = 1"})
    ORDER BY updated_at DESC
  `).all(categoryId || null, categoryId || null);

  res.json({ items: rows });
});

app.get("/mods/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM mods WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ item: row });
});

app.post("/favorites/:modId", authMiddleware(env.JWT_SECRET), (req, res) => {
  db.prepare("INSERT OR IGNORE INTO favorites (user_id, mod_id) VALUES (?, ?)").run(req.user.id, req.params.modId);
  res.json({ ok: true });
});

app.delete("/favorites/:modId", authMiddleware(env.JWT_SECRET), (req, res) => {
  db.prepare("DELETE FROM favorites WHERE user_id = ? AND mod_id = ?").run(req.user.id, req.params.modId);
  res.json({ ok: true });
});

app.get("/favorites", authMiddleware(env.JWT_SECRET), (req, res) => {
  const rows = db.prepare(`
    SELECT m.* FROM favorites f
    JOIN mods m ON m.id = f.mod_id
    WHERE f.user_id = ?
    ORDER BY m.updated_at DESC
  `).all(req.user.id);
  res.json({ items: rows });
});

app.post("/admin/categories", authMiddleware(env.JWT_SECRET), adminOnly, (req, res) => {
  const id = slugify(req.body.name);
  const row = {
    id,
    name: req.body.name,
    icon: req.body.icon || "📦",
    position: Number(req.body.position || 0),
    is_visible: req.body.is_visible === false ? 0 : 1
  };
  db.prepare(`
    INSERT INTO categories (id, name, icon, position, is_visible)
    VALUES (@id, @name, @icon, @position, @is_visible)
  `).run(row);
  res.json({ item: row });
});

app.put("/admin/categories/:id", authMiddleware(env.JWT_SECRET), adminOnly, (req, res) => {
  db.prepare(`
    UPDATE categories SET
      name = @name,
      icon = @icon,
      position = @position,
      is_visible = @is_visible
    WHERE id = @id
  `).run({
    id: req.params.id,
    name: req.body.name,
    icon: req.body.icon || "📦",
    position: Number(req.body.position || 0),
    is_visible: req.body.is_visible === false ? 0 : 1
  });
  res.json({ ok: true });
});

app.delete("/admin/categories/:id", authMiddleware(env.JWT_SECRET), adminOnly, (req, res) => {
  db.prepare("DELETE FROM categories WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM mods WHERE category_id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/admin/mods", authMiddleware(env.JWT_SECRET), adminOnly, (req, res) => {
  const item = {
    id: slugify(req.body.title + "-" + Math.random().toString(16).slice(2, 6)),
    category_id: req.body.category_id,
    title: req.body.title,
    short_description: req.body.short_description || "",
    full_description: req.body.full_description || "",
    version: req.body.version || "1.0.0",
    size_mb: Number(req.body.size_mb || 0),
    source_type: req.body.source_type || "url",
    download_url: req.body.download_url || "",
    preview_url: req.body.preview_url || "",
    checksum: req.body.checksum || "",
    is_visible: req.body.is_visible === false ? 0 : 1
  };

  db.prepare(`
    INSERT INTO mods (
      id, category_id, title, short_description, full_description, version,
      size_mb, source_type, download_url, preview_url, checksum, is_visible
    ) VALUES (
      @id, @category_id, @title, @short_description, @full_description, @version,
      @size_mb, @source_type, @download_url, @preview_url, @checksum, @is_visible
    )
  `).run(item);

  res.json({ item });
});

app.put("/admin/mods/:id", authMiddleware(env.JWT_SECRET), adminOnly, (req, res) => {
  db.prepare(`
    UPDATE mods SET
      category_id = @category_id,
      title = @title,
      short_description = @short_description,
      full_description = @full_description,
      version = @version,
      size_mb = @size_mb,
      source_type = @source_type,
      download_url = @download_url,
      preview_url = @preview_url,
      checksum = @checksum,
      is_visible = @is_visible,
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: req.params.id,
    category_id: req.body.category_id,
    title: req.body.title,
    short_description: req.body.short_description || "",
    full_description: req.body.full_description || "",
    version: req.body.version || "1.0.0",
    size_mb: Number(req.body.size_mb || 0),
    source_type: req.body.source_type || "url",
    download_url: req.body.download_url || "",
    preview_url: req.body.preview_url || "",
    checksum: req.body.checksum || "",
    is_visible: req.body.is_visible === false ? 0 : 1,
    updated_at: nowIso()
  });
  res.json({ ok: true });
});

app.delete("/admin/mods/:id", authMiddleware(env.JWT_SECRET), adminOnly, (req, res) => {
  db.prepare("DELETE FROM mods WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/admin/mods/upload-zip", authMiddleware(env.JWT_SECRET), adminOnly, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    let downloadUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    let sourceType = "upload";

    if (env.GITHUB_TOKEN) {
      downloadUrl = await uploadAssetToLatestRelease({ env, filePath: req.file.path });
      sourceType = "github-release";
    }

    const checksum = crypto.createHash("sha256").update(fs.readFileSync(req.file.path)).digest("hex");
    const sizeMb = Math.ceil(req.file.size / 1024 / 1024);

    res.json({
      ok: true,
      asset: {
        download_url: downloadUrl,
        source_type: sourceType,
        size_mb: sizeMb,
        checksum
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/installs", authMiddleware(env.JWT_SECRET), (req, res) => {
  db.prepare(`
    INSERT INTO installs (id, user_id, mod_id, status, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    req.user.id,
    req.body.mod_id,
    req.body.status || "done",
    JSON.stringify(req.body.details || {})
  );
  res.json({ ok: true });
});

app.get("/installs", authMiddleware(env.JWT_SECRET), (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, m.title as mod_title
    FROM installs i
    LEFT JOIN mods m ON m.id = i.mod_id
    WHERE i.user_id = ?
    ORDER BY i.created_at DESC
    LIMIT 50
  `).all(req.user.id);
  res.json({ items: rows });
});

app.listen(env.PORT, () => {
  console.log(`HARDY server started on http://localhost:${env.PORT}`);
});
