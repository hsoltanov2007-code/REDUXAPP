import { api, uploadZip } from "./services/api.js";

const state = {
  screen: "loading",
  token: "",
  user: null,
  categories: [],
  mods: [],
  activeCategoryId: "",
  activeMod: null,
  installs: [],
  favorites: [],
  gtaPath: "",
  status: "",
  updateStatus: "Нажми кнопку, чтобы проверить обновления."
};

function el(id) {
  return document.getElementById(id);
}

function badge(text) {
  return `<span class="badge">${text}</span>`;
}

async function init() {
  const authState = await window.hardy.getAuthState();
  state.token = authState.token || "";
  state.user = authState.user || null;
  state.gtaPath = authState.gtaPath || "";

  if (state.token) {
    try {
      const me = await api("/me", { token: state.token });
      state.user = me.user;
      await window.hardy.setUser({ user: me.user, token: state.token });
      await loadData();
      state.screen = "home";
    } catch {
      state.screen = "login";
    }
  } else {
    state.screen = "login";
  }

  window.hardy.onAuthToken(async ({ token }) => {
    state.token = token;
    const me = await api("/me", { token });
    state.user = me.user;
    await window.hardy.setUser({ user: me.user, token });
    await loadData();
    state.screen = "home";
    render();
  });

  window.hardy.onInstallStatus((payload) => {
    if (payload.type === "progress") {
      if (payload.stage === "downloading") {
        state.status = `Скачивание: ${payload.percent ?? 0}%`;
      } else if (payload.stage === "extracting") {
        state.status = "Распаковка архива...";
      } else if (payload.stage === "copying") {
        state.status = `Замена файлов: ${payload.current}/${payload.total}`;
      } else if (payload.stage === "done") {
        state.status = "Установка завершена.";
      }
    } else if (payload.type === "error") {
      state.status = `Ошибка установки: ${payload.message}`;
    }
    render();
  });

  window.hardy.onUpdateStatus((payload) => {
    if (payload.type === "checking") state.updateStatus = "Проверяем обновления...";
    if (payload.type === "available") state.updateStatus = "Найдена новая версия.";
    if (payload.type === "not-available") state.updateStatus = "Обновлений нет.";
    if (payload.type === "downloading") state.updateStatus = `Скачивание обновления: ${Math.round(payload.progress.percent || 0)}%`;
    if (payload.type === "downloaded") state.updateStatus = "Обновление скачано. Можно установить.";
    if (payload.type === "error") state.updateStatus = `Ошибка обновления: ${payload.message}`;
    render();
  });

  render();
}

async function loadData() {
  const includeHidden = state.user?.role === "admin" ? "?includeHidden=1" : "";
  const cats = await api(`/categories${includeHidden}`);
  const mods = await api(`/mods${includeHidden}`);
  state.categories = cats.items;
  state.mods = mods.items;

  if (state.token) {
    try {
      const fav = await api("/favorites", { token: state.token });
      state.favorites = fav.items;
      const installs = await api("/installs", { token: state.token });
      state.installs = installs.items;
    } catch {}
  }
}

function startDiscordLogin() {
  window.hardy.getServerUrl().then((base) => {
    window.hardy.openExternal(`${base}/auth/discord/start`);
  });
}

function logout() {
  window.hardy.logout();
  state.token = "";
  state.user = null;
  state.screen = "login";
  render();
}

function openCategory(id) {
  state.activeCategoryId = id;
  state.activeMod = null;
  state.screen = "category";
  render();
}

async function openMod(id) {
  const { item } = await api(`/mods/${id}`);
  state.activeMod = item;
  state.screen = "mod";
  render();
}

async function installCurrentMod() {
  const mod = state.activeMod;
  if (!mod) return;
  state.status = "Старт установки...";
  render();

  const result = await window.hardy.installMod({
    mod,
    gtaPath: state.gtaPath
  });

  await api("/installs", {
    method: "POST",
    token: state.token,
    body: {
      mod_id: mod.id,
      status: "done",
      details: result
    }
  });

  await loadData();
  render();
}

async function detectGtaPath() {
  const result = await window.hardy.detectGtaPath();
  state.gtaPath = result.path || "";
  render();
}

async function chooseGtaPath() {
  const result = await window.hardy.chooseGtaPath();
  state.gtaPath = result.path || state.gtaPath;
  render();
}

async function checkUpdates() {
  await window.hardy.checkUpdates();
}

async function downloadUpdate() {
  await window.hardy.downloadUpdate();
}

async function installUpdate() {
  await window.hardy.installUpdate();
}

function categoryMods() {
  return state.mods.filter(m => m.category_id === state.activeCategoryId);
}

function activeCategory() {
  return state.categories.find(c => c.id === state.activeCategoryId);
}

async function submitCategoryForm(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  await api("/admin/categories", {
    method: "POST",
    token: state.token,
    body: {
      name: form.get("name"),
      icon: form.get("icon"),
      position: Number(form.get("position") || 0),
      is_visible: form.get("is_visible") === "on"
    }
  });
  event.target.reset();
  await loadData();
  render();
}

async function submitModForm(event) {
  event.preventDefault();
  const form = new FormData(event.target);

  let uploadAsset = null;
  const file = form.get("zip");
  if (file && file.size) {
    uploadAsset = await uploadZip(file, state.token);
  }

  await api("/admin/mods", {
    method: "POST",
    token: state.token,
    body: {
      category_id: form.get("category_id"),
      title: form.get("title"),
      short_description: form.get("short_description"),
      full_description: form.get("full_description"),
      version: form.get("version"),
      size_mb: Number(uploadAsset?.asset?.size_mb || form.get("size_mb") || 0),
      source_type: uploadAsset?.asset?.source_type || "url",
      download_url: uploadAsset?.asset?.download_url || form.get("download_url"),
      preview_url: form.get("preview_url"),
      checksum: uploadAsset?.asset?.checksum || form.get("checksum"),
      is_visible: form.get("is_visible") === "on"
    }
  });

  event.target.reset();
  await loadData();
  render();
}

async function deleteCategory(id) {
  await api(`/admin/categories/${id}`, { method: "DELETE", token: state.token });
  await loadData();
  render();
}

async function deleteMod(id) {
  await api(`/admin/mods/${id}`, { method: "DELETE", token: state.token });
  await loadData();
  render();
}

function renderLogin() {
  return `
    <div class="center">
      <div class="glass pad hero">
        <div class="brand">
          <div class="brand-icon">H</div>
          <div>
            <h1>HARDY</h1>
            <div class="muted">Мод-менеджер для Majestic RP</div>
          </div>
        </div>
        <div style="margin:26px 0 18px;">
          <h2>Вход через Discord</h2>
          <div class="muted">
            После входа пользователь увидит только категории, которые настроены в админке.
            Админ получает доступ к управлению модами, категориями и загрузке ZIP.
          </div>
        </div>
        <div class="actions">
          <button class="btn-primary" id="login-btn">Войти через Discord</button>
        </div>
      </div>
    </div>
  `;
}

function renderHome() {
  return `
    <div class="shell">
      <div class="row wrap">
        <div>
          <div class="muted">Главный экран</div>
          <h1>Категории модов</h1>
        </div>
        <div class="actions">
          ${state.user?.role === "admin" ? '<button class="btn-secondary" id="go-admin">Админка</button>' : ""}
          <button class="btn-secondary" id="go-profile">Профиль</button>
          <button class="btn-secondary" id="logout-btn">Выйти</button>
        </div>
      </div>

      <div class="grid-4">
        <div class="glass card"><div class="muted">Категорий</div><h2>${state.categories.length}</h2></div>
        <div class="glass card"><div class="muted">Модов</div><h2>${state.mods.length}</h2></div>
        <div class="glass card"><div class="muted">Путь GTA V</div><div class="small">${state.gtaPath || "не выбран"}</div></div>
        <div class="glass card"><div class="muted">Обновление</div><div class="small">${state.updateStatus}</div></div>
      </div>

      <div class="glass pad">
        <div class="row wrap">
          <div>
            <h3>Настройки и обновления</h3>
            <div class="muted">Автообновление приложения и путь к GTA V</div>
          </div>
          <div class="actions">
            <button class="btn-secondary" id="detect-gta">Автонайти GTA V</button>
            <button class="btn-secondary" id="choose-gta">Выбрать папку</button>
            <button class="btn-secondary" id="check-updates">Проверить обновления</button>
            <button class="btn-secondary" id="download-update">Скачать обновление</button>
            <button class="btn-primary" id="install-update">Установить обновление</button>
          </div>
        </div>
        <div class="status-box" style="margin-top:12px;">${state.status || "Готово к установке модов."}</div>
      </div>

      <div class="grid-4">
        ${state.categories.sort((a,b) => a.position - b.position).map(cat => `
          <button class="glass card" data-cat="${cat.id}" style="text-align:left;">
            <div style="font-size:34px;margin-bottom:12px;">${cat.icon}</div>
            <h3>${cat.name}</h3>
            <div class="muted">${state.mods.filter(m => m.category_id === cat.id).length} модов</div>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function renderCategory() {
  const cat = activeCategory();
  return `
    <div class="shell">
      <div class="row wrap">
        <div>
          <div class="muted">Список модов</div>
          <h1>${cat?.name || ""}</h1>
        </div>
        <div class="actions">
          <button class="btn-secondary" id="go-home">Назад</button>
        </div>
      </div>

      <div class="grid-3">
        ${categoryMods().map(mod => `
          <div class="glass card">
            <div class="preview">${mod.short_description}</div>
            ${badge(mod.version)}
            <h3>${mod.title}</h3>
            <div class="muted">${mod.size_mb} MB • ${mod.source_type}</div>
            <div class="actions" style="margin-top:14px;">
              <button class="btn-primary" data-mod="${mod.id}">Открыть обзор</button>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderMod() {
  const mod = state.activeMod;
  return `
    <div class="shell">
      <div class="row wrap">
        <div>
          <div class="muted">Обзор мода</div>
          <h1>${mod.title}</h1>
        </div>
        <div class="actions">
          <button class="btn-secondary" id="go-category">Назад</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="glass card">
          <div class="preview">${mod.full_description}</div>
          <div class="status-box">${state.status || "Нажми установить для скачивания ZIP, backup и автоматической замены файлов."}</div>
        </div>
        <div class="glass card">
          ${badge(mod.version)}
          <h3 style="margin-top:14px;">Установка</h3>
          <div class="list" style="margin:16px 0;">
            <div class="list-row"><span class="muted">Размер</span><strong>${mod.size_mb} MB</strong></div>
            <div class="list-row"><span class="muted">Источник</span><strong>${mod.source_type}</strong></div>
            <div class="list-row"><span class="muted">URL</span><strong class="small">${mod.download_url}</strong></div>
          </div>
          <div class="actions">
            <button class="btn-primary" id="install-mod">Установить</button>
            <button class="btn-secondary" id="open-source">Открыть источник</button>
            <button class="btn-danger" id="remove-mod">Откатить мод</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderProfile() {
  return `
    <div class="shell">
      <div class="row wrap">
        <div>
          <div class="muted">Профиль</div>
          <h1>${state.user?.username || ""}</h1>
        </div>
        <div class="actions">
          <button class="btn-secondary" id="go-home">Назад</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="glass card">
          <h3>Последние установки</h3>
          <div class="list">
            ${state.installs.length ? state.installs.map(item => `
              <div class="list-row">
                <div>
                  <strong>${item.mod_title || item.mod_id}</strong>
                  <div class="muted small">${item.created_at}</div>
                </div>
                <div>${item.status}</div>
              </div>
            `).join("") : '<div class="muted">Пока нет установок.</div>'}
          </div>
        </div>
        <div class="glass card">
          <h3>Избранное</h3>
          <div class="list">
            ${state.favorites.length ? state.favorites.map(item => `
              <div class="list-row">
                <div>
                  <strong>${item.title}</strong>
                  <div class="muted small">${item.version}</div>
                </div>
              </div>
            `).join("") : '<div class="muted">Пока нет избранного.</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAdmin() {
  return `
    <div class="shell">
      <div class="row wrap">
        <div>
          <div class="muted">Админка</div>
          <h1>Категории и моды</h1>
        </div>
        <div class="actions">
          <button class="btn-secondary" id="go-home">Назад</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="glass pad">
          <h3>Новая категория</h3>
          <form id="category-form" class="form-grid">
            <input name="name" placeholder="Название категории" required />
            <input name="icon" placeholder="Иконка, например ✨" required />
            <input name="position" type="number" placeholder="Позиция" value="0" />
            <label><input type="checkbox" name="is_visible" checked /> Показать пользователям</label>
            <button class="btn-primary" type="submit">Добавить категорию</button>
          </form>

          <div class="list" style="margin-top:16px;">
            ${state.categories.map(cat => `
              <div class="list-row">
                <div>
                  <strong>${cat.icon} ${cat.name}</strong>
                  <div class="muted small">id: ${cat.id} • position: ${cat.position}</div>
                </div>
                <button class="btn-danger" data-del-cat="${cat.id}">Удалить</button>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="glass pad">
          <h3>Новый мод</h3>
          <form id="mod-form" class="form-grid">
            <select name="category_id" required>
              ${state.categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join("")}
            </select>
            <input name="title" placeholder="Название мода" required />
            <input name="version" placeholder="Версия" value="1.0.0" />
            <input name="size_mb" type="number" placeholder="Размер в MB" />
            <input name="preview_url" placeholder="URL превью (опционально)" />
            <input name="download_url" placeholder="URL ZIP, если без загрузки файла" />
            <input name="checksum" placeholder="SHA256 checksum (опционально)" />
            <textarea name="short_description" placeholder="Короткое описание"></textarea>
            <textarea name="full_description" placeholder="Полное описание"></textarea>
            <label>ZIP-файл для загрузки в GitHub Release / сервер <input type="file" name="zip" accept=".zip" /></label>
            <label><input type="checkbox" name="is_visible" checked /> Показать пользователям</label>
            <button class="btn-primary" type="submit">Добавить мод</button>
          </form>

          <div class="list" style="margin-top:16px;">
            ${state.mods.map(mod => `
              <div class="list-row">
                <div>
                  <strong>${mod.title}</strong>
                  <div class="muted small">${mod.category_id} • ${mod.version} • ${mod.source_type}</div>
                </div>
                <button class="btn-danger" data-del-mod="${mod.id}">Удалить</button>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function attachHome() {
  el("logout-btn")?.addEventListener("click", logout);
  el("go-admin")?.addEventListener("click", () => { state.screen = "admin"; render(); });
  el("go-profile")?.addEventListener("click", () => { state.screen = "profile"; render(); });
  el("detect-gta")?.addEventListener("click", detectGtaPath);
  el("choose-gta")?.addEventListener("click", chooseGtaPath);
  el("check-updates")?.addEventListener("click", checkUpdates);
  el("download-update")?.addEventListener("click", downloadUpdate);
  el("install-update")?.addEventListener("click", installUpdate);

  document.querySelectorAll("[data-cat]").forEach(node => {
    node.addEventListener("click", () => openCategory(node.getAttribute("data-cat")));
  });
}

function attachCategory() {
  el("go-home")?.addEventListener("click", () => { state.screen = "home"; render(); });
  document.querySelectorAll("[data-mod]").forEach(node => {
    node.addEventListener("click", () => openMod(node.getAttribute("data-mod")));
  });
}

function attachMod() {
  el("go-category")?.addEventListener("click", () => { state.screen = "category"; render(); });
  el("open-source")?.addEventListener("click", () => window.hardy.openExternal(state.activeMod.download_url));
  el("install-mod")?.addEventListener("click", installCurrentMod);
  el("remove-mod")?.addEventListener("click", async () => {
    await window.hardy.removeMod({ modId: state.activeMod.id, gtaPath: state.gtaPath });
    state.status = "Откат завершён.";
    render();
  });
}

function attachProfile() {
  el("go-home")?.addEventListener("click", () => { state.screen = "home"; render(); });
}

function attachAdmin() {
  el("go-home")?.addEventListener("click", () => { state.screen = "home"; render(); });
  el("category-form")?.addEventListener("submit", submitCategoryForm);
  el("mod-form")?.addEventListener("submit", submitModForm);
  document.querySelectorAll("[data-del-cat]").forEach(node => {
    node.addEventListener("click", () => deleteCategory(node.getAttribute("data-del-cat")));
  });
  document.querySelectorAll("[data-del-mod]").forEach(node => {
    node.addEventListener("click", () => deleteMod(node.getAttribute("data-del-mod")));
  });
}

function render() {
  const app = document.getElementById("app");

  if (state.screen === "loading") {
    app.innerHTML = `<div class="center"><div class="glass pad">Загрузка...</div></div>`;
    return;
  }

  if (state.screen === "login") {
    app.innerHTML = renderLogin();
    el("login-btn")?.addEventListener("click", startDiscordLogin);
    return;
  }

  if (state.screen === "home") {
    app.innerHTML = renderHome();
    attachHome();
    return;
  }

  if (state.screen === "category") {
    app.innerHTML = renderCategory();
    attachCategory();
    return;
  }

  if (state.screen === "mod") {
    app.innerHTML = renderMod();
    attachMod();
    return;
  }

  if (state.screen === "profile") {
    app.innerHTML = renderProfile();
    attachProfile();
    return;
  }

  if (state.screen === "admin") {
    app.innerHTML = renderAdmin();
    attachAdmin();
  }
}

init().catch(err => {
  document.getElementById("app").innerHTML = `<div class="center"><div class="glass pad">Ошибка запуска: ${String(err)}</div></div>`;
});
