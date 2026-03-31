const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const extract = require("extract-zip");

const COMMON_GTA_PATHS = [
  "C:\\Program Files\\Rockstar Games\\Grand Theft Auto V",
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Grand Theft Auto V",
  "D:\\SteamLibrary\\steamapps\\common\\Grand Theft Auto V",
  "E:\\SteamLibrary\\steamapps\\common\\Grand Theft Auto V"
];

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeJoin(base, target) {
  const normalized = path.normalize(target).replace(/^(\.\.(\/|\\|$))+/, "");
  const finalPath = path.join(base, normalized);
  if (!finalPath.startsWith(base)) {
    throw new Error(`Unsafe path blocked: ${target}`);
  }
  return finalPath;
}

function walk(dir, prefix = "") {
  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      items.push(...walk(full, rel));
    } else {
      items.push({ relative: rel, full });
    }
  }
  return items;
}

function copyFileWithDirs(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function detectGtaPath() {
  return COMMON_GTA_PATHS.find(exists) || "";
}

async function downloadFile(url, targetPath, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const total = Number(response.headers.get("content-length") || 0);
  const fileStream = fs.createWriteStream(targetPath);

  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    fileStream.write(chunk);
    if (total && onProgress) {
      onProgress(Math.round((received / total) * 100));
    }
  }
  fileStream.end();
}

async function installModZip({ mod, gtaPath, onProgress }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hardy-"));
  const zipPath = path.join(tempRoot, `${mod.id}.zip`);
  const extractDir = path.join(tempRoot, "unzipped");
  const backupRoot = path.join(gtaPath, ".hardy-backups", mod.id, new Date().toISOString().replace(/[:.]/g, "-"));
  const manifestPath = path.join(gtaPath, ".hardy-installed", `${mod.id}.json`);

  ensureDir(extractDir);
  ensureDir(backupRoot);
  ensureDir(path.dirname(manifestPath));

  onProgress?.("downloading");
  await downloadFile(mod.download_url, zipPath, percent => onProgress?.("downloading", { percent }));

  if (mod.checksum) {
    const actual = sha256(zipPath);
    if (actual !== mod.checksum) {
      throw new Error("Checksum mismatch");
    }
  }

  onProgress?.("extracting");
  await extract(zipPath, { dir: extractDir });

  const files = walk(extractDir);
  const manifest = {
    modId: mod.id,
    title: mod.title,
    version: mod.version,
    installedAt: new Date().toISOString(),
    backupRoot,
    files: []
  };

  try {
    let index = 0;
    for (const file of files) {
      index += 1;
      const target = safeJoin(gtaPath, file.relative);
      const backup = safeJoin(backupRoot, file.relative);

      if (exists(target)) {
        copyFileWithDirs(target, backup);
      }

      copyFileWithDirs(file.full, target);
      manifest.files.push({ relative: file.relative, target, backupExists: exists(backup) });
      onProgress?.("copying", { current: index, total: files.length, file: file.relative });
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    onProgress?.("done");
    return { ok: true, manifestPath };
  } catch (error) {
    await rollbackInstall({ gtaPath, manifest });
    throw error;
  }
}

async function rollbackInstall({ gtaPath, manifest }) {
  for (const item of manifest.files.reverse()) {
    const backup = path.join(manifest.backupRoot, item.relative);
    const target = path.join(gtaPath, item.relative);
    if (exists(backup)) {
      copyFileWithDirs(backup, target);
    } else if (exists(target)) {
      fs.unlinkSync(target);
    }
  }
}

async function removeInstalledMod({ modId, gtaPath }) {
  const manifestPath = path.join(gtaPath, ".hardy-installed", `${modId}.json`);
  if (!exists(manifestPath)) {
    return { ok: false, error: "Install manifest not found" };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  await rollbackInstall({ gtaPath, manifest });
  return { ok: true };
}

module.exports = {
  detectGtaPath,
  installModZip,
  removeInstalledMod
};
