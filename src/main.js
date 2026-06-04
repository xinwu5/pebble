import { Crepe } from "@milkdown/crepe";
import { marked } from "marked";
import hljs from "highlight.js";
import mermaid from "mermaid";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save, ask } from "@tauri-apps/plugin-dialog";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/nord.css";
import "highlight.js/styles/github.css";
import "./styles.css";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------- State ----------
// Tab: { id, markdown (full, incl. frontmatter), filePath, dirty }
let tabs = [];
let activeId = null;
let mode = "wysiwyg"; // wysiwyg | source | split
let crepe = null;
let seq = 0;
let sidebarOpen = false;

const $ = (id) => document.getElementById(id);
const els = {
  tabbar: $("tabbar"),
  wysiwygPane: $("wysiwyg-pane"),
  textPane: $("text-pane"),
  source: $("source"),
  preview: $("preview"),
  modeSwitch: $("mode-switch"),
  fmBox: $("frontmatter-box"),
  sidebar: $("sidebar"),
  outlineList: $("outline-list"),
  findBar: $("find-bar"),
  findInput: $("find-input"),
  replaceInput: $("replace-input"),
  findCount: $("find-count"),
  statWords: $("stat-words"),
  statChars: $("stat-chars"),
  statRead: $("stat-read"),
  statSave: $("stat-save"),
  printRoot: $("print-root"),
};

// ---------- Markdown rendering (hljs + mermaid + task lists) ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function highlight(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang }).value; } catch {}
  }
  try { return hljs.highlightAuto(code).value; } catch { return escapeHtml(code); }
}
marked.use({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      const l = (lang || "").trim().split(/\s+/)[0];
      if (l === "mermaid") return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
      return `<pre><code class="hljs language-${l}">${highlight(text, l)}</code></pre>`;
    },
  },
});
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
});

// ---------- Error banner ----------
function showError(msg) {
  let banner = $("error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "error-banner";
    banner.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#cf222e;color:#fff;padding:8px 12px;font:13px -apple-system,sans-serif;white-space:pre-wrap;cursor:pointer;";
    banner.addEventListener("click", () => banner.remove());
    document.body.appendChild(banner);
  }
  banner.textContent = "\u26A0 " + msg;
}
window.addEventListener("error", (e) => showError(String(e.message || e.error)));
window.addEventListener("unhandledrejection", (e) =>
  showError("Unhandled: " + String(e.reason))
);

// ---------- Frontmatter ----------
function splitFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { fm: null, body: md };
  return { fm: m[1], body: md.slice(m[0].length) };
}
function joinFrontmatter(fm, body) {
  if (fm === null || fm === undefined) return body;
  return `---\n${fm}\n---\n\n${body.replace(/^\n+/, "")}`;
}
function renderFmBox(fm) {
  const rows = fm
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const i = line.indexOf(":");
      const key = i >= 0 ? line.slice(0, i) : line;
      const val = i >= 0 ? line.slice(i + 1).trim() : "";
      return `<tr><td class="fm-key">${escapeHtml(key.trim())}</td><td>${escapeHtml(val)}</td></tr>`;
    })
    .join("");
  return `<div class="fm-box"><table>${rows}</table></div>`;
}

// ---------- Helpers ----------
function baseName(p) { return p ? p.split("/").pop() : "Untitled"; }
function activeTab() { return tabs.find((t) => t.id === activeId); }
function makeTab(markdown = "", filePath = null) {
  const t = { id: ++seq, markdown, filePath, dirty: false };
  tabs.push(t);
  return t;
}
function isPristine(t) { return t && !t.filePath && !t.dirty && t.markdown.trim() === ""; }
function markDirty(t) { if (t && !t.dirty) { t.dirty = true; renderTabs(); } }

function bodyOf(md) { return splitFrontmatter(md).body; }
function currentFmFromBox() { return els.fmBox.hidden ? null : els.fmBox.value; }

function syncActiveIntoTab() {
  const t = activeTab();
  if (!t) return;
  if (mode === "wysiwyg" && crepe) t.markdown = joinFrontmatter(currentFmFromBox(), crepe.getMarkdown());
  else if (mode === "source" || mode === "split") t.markdown = els.source.value;
}

function afterEdit(t) {
  markDirty(t);
  updateStatus();
  updateOutline();
  schedulePersist();
  scheduleAutosave();
}

// ---------- Preview enhancement ----------
async function enhancePreview(container) {
  if (isTauri) {
    container.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (src && !/^https?:|^data:|^asset:/.test(src)) {
        try { img.src = convertFileSrc(src); } catch {}
      }
    });
  }
  const nodes = container.querySelectorAll("pre.mermaid");
  if (nodes.length) {
    try { await mermaid.run({ nodes }); } catch (e) { /* leave as code */ }
  }
}
function renderPreviewInto(container, md) {
  const { fm, body } = splitFrontmatter(md);
  let html = fm !== null ? renderFmBox(fm) : "";
  html += marked.parse(body);
  container.innerHTML = html;
  enhancePreview(container);
}
function renderPreview() { renderPreviewInto(els.preview, activeTab()?.markdown ?? ""); }

// ---------- Status bar ----------
function updateStatus() {
  const body = bodyOf(activeTab()?.markdown ?? "");
  const words = (body.trim().match(/\S+/g) || []).length;
  els.statWords.textContent = `${words} words`;
  els.statChars.textContent = `${body.length} chars`;
  els.statRead.textContent = `${Math.max(1, Math.ceil(words / 200))} min read`;
}

// ---------- Outline ----------
function getHeadings(md) {
  const { fm, body } = splitFrontmatter(md);
  const fmLen = fm !== null ? md.length - body.length : 0;
  const res = [];
  const re = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/gm;
  let m;
  while ((m = re.exec(body))) {
    res.push({ level: m[1].length, text: m[2].trim(), offset: fmLen + m.index });
  }
  return res;
}
function updateOutline() {
  const heads = getHeadings(activeTab()?.markdown ?? "");
  els.outlineList.innerHTML = "";
  heads.forEach((h, i) => {
    const li = document.createElement("li");
    li.className = "lvl" + h.level;
    li.textContent = h.text;
    li.addEventListener("click", () => gotoHeading(i, h));
    els.outlineList.appendChild(li);
  });
}
function gotoHeading(order, h) {
  if (mode === "wysiwyg") {
    const hs = els.wysiwygPane.querySelectorAll("h1,h2,h3,h4,h5,h6");
    hs[order]?.scrollIntoView({ block: "start", behavior: "smooth" });
  } else {
    els.source.focus();
    els.source.setSelectionRange(h.offset, h.offset);
    const line = els.source.value.slice(0, h.offset).split("\n").length;
    els.source.scrollTop = Math.max(0, (line - 1) * 22 - 40);
    if (mode === "split") {
      const hs = els.preview.querySelectorAll("h1,h2,h3,h4,h5,h6");
      hs[order]?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
}

// ---------- Tab bar ----------
function renderTabs() {
  els.tabbar.innerHTML = "";
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === activeId ? " active" : "");
    el.dataset.id = String(t.id);
    el.title = t.filePath || "Untitled";
    el.draggable = true;

    const dot = document.createElement("span");
    dot.className = "tab-dirty";
    dot.textContent = t.dirty ? "\u2022" : "";
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = baseName(t.filePath);
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "\u00D7";
    close.title = "Close tab";

    el.append(dot, name, close);
    els.tabbar.appendChild(el);
  }
  const add = document.createElement("button");
  add.id = "tab-add";
  add.textContent = "+";
  add.title = "New tab";
  els.tabbar.appendChild(add);
}

// ---------- Editor lifecycle ----------
async function mountCrepe(initialBody) {
  const fresh = document.createElement("div");
  fresh.id = "wysiwyg-pane";
  fresh.className = "pane";
  els.wysiwygPane.replaceWith(fresh);
  els.wysiwygPane = fresh;

  let ready = false;
  crepe = new Crepe({ root: fresh, defaultValue: initialBody });
  crepe.on((listener) => {
    listener.markdownUpdated((_ctx, md) => {
      const t = activeTab();
      if (!t) return;
      t.markdown = joinFrontmatter(currentFmFromBox(), md);
      if (ready) afterEdit(t);
    });
  });
  await crepe.create();
  ready = true;
}
async function destroyCrepe() {
  if (crepe) {
    const t = activeTab();
    if (t) t.markdown = joinFrontmatter(currentFmFromBox(), crepe.getMarkdown());
    await crepe.destroy();
    crepe = null;
  }
}

// ---------- Render active tab ----------
async function renderActive() {
  const t = activeTab();
  const md = t ? t.markdown : "";
  if (mode === "wysiwyg") {
    els.textPane.hidden = true;
    const { fm, body } = splitFrontmatter(md);
    if (fm !== null) { els.fmBox.hidden = false; els.fmBox.value = fm; }
    else { els.fmBox.hidden = true; els.fmBox.value = ""; }
    await mountCrepe(body);
    els.wysiwygPane.hidden = false;
  } else {
    els.wysiwygPane.hidden = true;
    els.fmBox.hidden = true;
    els.textPane.hidden = false;
    els.source.value = md;
    els.textPane.classList.toggle("split", mode === "split");
    if (mode === "split") renderPreview();
  }
  updateStatus();
  updateOutline();
}

// ---------- Mode switching ----------
async function setMode(m) {
  if (m === mode) return;
  syncActiveIntoTab();
  if (mode === "wysiwyg") await destroyCrepe();
  mode = m;
  for (const btn of els.modeSwitch.querySelectorAll("button"))
    btn.classList.toggle("active", btn.dataset.mode === m);
  await renderActive();
  schedulePersist();
}

// ---------- Tabs ----------
async function switchTab(id) {
  if (id === activeId) return;
  syncActiveIntoTab();
  if (mode === "wysiwyg") await destroyCrepe();
  activeId = id;
  renderTabs();
  await renderActive();
  schedulePersist();
}
async function cycleTab(dir) {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeId);
  const next = tabs[(i + dir + tabs.length) % tabs.length];
  await switchTab(next.id);
}
async function closeTab(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  try {
    if (t.dirty) {
      const ok = await ask(`Discard unsaved changes to ${baseName(t.filePath)}?`, {
        title: "Unsaved changes", kind: "warning",
      });
      if (!ok) return;
    }
  } catch (e) { showError("Close failed: " + String(e)); return; }
  const idx = tabs.indexOf(t);
  const wasActive = id === activeId;
  if (wasActive && mode === "wysiwyg") await destroyCrepe();
  tabs.splice(idx, 1);
  if (tabs.length === 0) makeTab("", null);
  if (wasActive) activeId = tabs[Math.min(idx, tabs.length - 1)].id;
  renderTabs();
  if (wasActive) await renderActive();
  schedulePersist();
}

// ---------- File ops ----------
async function openInTab(md, path) {
  const cur = activeTab();
  if (isPristine(cur)) {
    if (mode === "wysiwyg") await destroyCrepe();
    cur.markdown = md; cur.filePath = path; cur.dirty = false;
    renderTabs(); await renderActive(); schedulePersist();
    return;
  }
  syncActiveIntoTab();
  if (mode === "wysiwyg") await destroyCrepe();
  const t = makeTab(md, path);
  activeId = t.id;
  renderTabs(); await renderActive(); schedulePersist();
}
async function newFile() { await openInTab("", null); }
async function openFile() {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (!selected) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    const contents = await invoke("read_file", { path });
    await openInTab(contents, path);
  } catch (e) { showError("Open failed: " + String(e)); }
}
async function writeToPath(path) {
  syncActiveIntoTab();
  const t = activeTab();
  await invoke("write_file", { path, contents: t.markdown });
  t.filePath = path; t.dirty = false;
  renderTabs(); schedulePersist();
  flashSaved();
}
async function saveFile() {
  const t = activeTab();
  if (!t) return;
  if (!t.filePath) return saveFileAs();
  try { await writeToPath(t.filePath); } catch (e) { showError("Save failed: " + String(e)); }
}
async function saveFileAs() {
  const t = activeTab();
  if (!t) return;
  const path = await save({
    defaultPath: t.filePath ?? "Untitled.md",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (!path) return;
  try { await writeToPath(path); } catch (e) { showError("Save failed: " + String(e)); }
}

// ---------- Autosave ----------
let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosaveAll, 1500);
}
async function autosaveAll() {
  syncActiveIntoTab();
  for (const t of tabs) {
    if (t.filePath && t.dirty) {
      try {
        await invoke("write_file", { path: t.filePath, contents: t.markdown });
        t.dirty = false;
      } catch { /* ignore autosave errors */ }
    }
  }
  renderTabs();
  flashSaved();
}
function flashSaved() {
  const d = new Date();
  els.statSave.textContent =
    "Saved " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---------- Session persistence ----------
let persistTimer = null;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistSession, 400);
}
function persistSession() {
  syncActiveIntoTab();
  try {
    const data = {
      mode, sidebarOpen,
      activeIndex: tabs.findIndex((t) => t.id === activeId),
      tabs: tabs.map((t) => ({ markdown: t.markdown, filePath: t.filePath, dirty: t.dirty })),
    };
    localStorage.setItem("mdedit.session", JSON.stringify(data));
  } catch {}
}
function restoreSession() {
  try {
    const raw = localStorage.getItem("mdedit.session");
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.tabs || !data.tabs.length) return false;
    tabs = data.tabs.map((t) => {
      const nt = makeTab(t.markdown || "", t.filePath || null);
      nt.dirty = !!t.dirty;
      return nt;
    });
    mode = data.mode || "wysiwyg";
    sidebarOpen = !!data.sidebarOpen;
    const ai = Math.min(Math.max(0, data.activeIndex ?? 0), tabs.length - 1);
    activeId = tabs[ai].id;
    return true;
  } catch { return false; }
}

// ---------- Find & Replace ----------
const findState = { matches: [], idx: -1 };
async function openFind() {
  if (mode === "wysiwyg") await setMode("source");
  els.findBar.hidden = false;
  els.findInput.focus();
  els.findInput.select();
  recomputeMatches();
}
function closeFind() { els.findBar.hidden = true; els.source.focus(); }
function recomputeMatches() {
  const term = els.findInput.value;
  findState.matches = [];
  findState.idx = -1;
  if (term) {
    const hay = els.source.value.toLowerCase();
    const needle = term.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) { findState.matches.push(i); i = hay.indexOf(needle, i + needle.length); }
  }
  els.findCount.textContent = `${findState.matches.length ? findState.idx + 1 : 0}/${findState.matches.length}`;
}
function selectMatch(i) {
  if (!findState.matches.length) return;
  findState.idx = (i + findState.matches.length) % findState.matches.length;
  const start = findState.matches[findState.idx];
  const len = els.findInput.value.length;
  els.source.focus();
  els.source.setSelectionRange(start, start + len);
  const line = els.source.value.slice(0, start).split("\n").length;
  els.source.scrollTop = Math.max(0, (line - 1) * 22 - 60);
  els.findCount.textContent = `${findState.idx + 1}/${findState.matches.length}`;
}
function findNext() { recomputeKeep(); selectMatch(findState.idx + 1); }
function findPrev() { recomputeKeep(); selectMatch(findState.idx - 1); }
let lastTerm = "";
function recomputeKeep() {
  if (els.findInput.value !== lastTerm) { lastTerm = els.findInput.value; recomputeMatches(); }
}
function replaceOne() {
  const t = activeTab();
  if (!t || !findState.matches.length || findState.idx < 0) { findNext(); return; }
  const start = findState.matches[findState.idx];
  const len = els.findInput.value.length;
  const repl = els.replaceInput.value;
  const v = els.source.value;
  els.source.value = v.slice(0, start) + repl + v.slice(start + len);
  t.markdown = els.source.value;
  afterEdit(t);
  if (mode === "split") renderPreview();
  lastTerm = ""; recomputeMatches(); selectMatch(findState.idx);
}
function replaceAll() {
  const t = activeTab();
  if (!t || !els.findInput.value) return;
  const term = els.findInput.value;
  const repl = els.replaceInput.value;
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  els.source.value = els.source.value.replace(re, repl);
  t.markdown = els.source.value;
  afterEdit(t);
  if (mode === "split") renderPreview();
  lastTerm = ""; recomputeMatches();
}

// ---------- Export / Print ----------
function buildStandaloneHtml(md, title) {
  const tmp = document.createElement("div");
  renderPreviewInto(tmp, md);
  const hljsCss = document.querySelector('style[data-vite-dev-id*="highlight"]')?.textContent || "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1f2328}
pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow:auto}
code{background:#eaeef2;padding:.2em .4em;border-radius:4px;font-size:85%}
pre code{background:transparent;padding:0}
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:6px 12px}
blockquote{margin:0;padding-left:1em;border-left:3px solid #d0d7de;color:#57606a}
img{max-width:100%}h1,h2{border-bottom:1px solid #d0d7de;padding-bottom:.3em}
.fm-box{border:1px solid #d0d7de;border-radius:8px;background:#f6f8fa;padding:8px 12px;margin-bottom:16px}
.fm-box td{border:none;padding:2px 8px}.fm-key{color:#57606a;font-weight:600}
${hljsCss}
</style></head><body class="markdown-body">${tmp.innerHTML}</body></html>`;
}
async function exportHtml() {
  const t = activeTab();
  if (!t) return;
  try {
    const path = await save({
      defaultPath: (t.filePath ? t.filePath.replace(/\.[^.]+$/, "") : "Untitled") + ".html",
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (!path) return;
    await invoke("write_file", { path, contents: buildStandaloneHtml(t.markdown, baseName(t.filePath)) });
    flashSaved();
  } catch (e) { showError("Export failed: " + String(e)); }
}
async function printDoc() {
  const t = activeTab();
  if (!t) return;
  renderPreviewInto(els.printRoot, t.markdown);
  // Give mermaid a tick to render before printing.
  setTimeout(() => window.print(), 300);
}

// ---------- Sidebar ----------
function toggleSidebar(force) {
  sidebarOpen = force !== undefined ? force : !sidebarOpen;
  els.sidebar.hidden = !sidebarOpen;
  $("btn-outline").classList.toggle("toggled", sidebarOpen);
  if (sidebarOpen) updateOutline();
  schedulePersist();
}

// ---------- Drag & drop (Tauri) ----------
async function setupDragDrop() {
  if (!isTauri) return;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop") return;
      for (const path of event.payload.paths) {
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) insertImage(path);
        else {
          try {
            const contents = await invoke("read_file", { path });
            await openInTab(contents, path);
          } catch (e) { showError("Drop open failed: " + String(e)); }
        }
      }
    });
  } catch (e) { /* drag-drop unavailable */ }
}
function insertImage(path) {
  const t = activeTab();
  if (!t) return;
  const snippet = `![](${path})`;
  if (mode === "source" || mode === "split") {
    const ta = els.source;
    const s = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + snippet + ta.value.slice(ta.selectionEnd ?? s);
    t.markdown = ta.value;
    afterEdit(t);
    if (mode === "split") renderPreview();
  } else {
    // WYSIWYG: append to body and re-render.
    const { fm, body } = splitFrontmatter(t.markdown);
    t.markdown = joinFrontmatter(fm, body.replace(/\n*$/, "\n\n") + snippet + "\n");
    afterEdit(t);
    renderActive();
  }
}

// ---------- Wiring ----------
$("btn-new").addEventListener("click", newFile);
$("btn-open").addEventListener("click", openFile);
$("btn-save").addEventListener("click", saveFile);
$("btn-saveas").addEventListener("click", saveFileAs);
$("btn-outline").addEventListener("click", () => toggleSidebar());
$("btn-find").addEventListener("click", openFind);
$("btn-export").addEventListener("click", exportHtml);
$("btn-print").addEventListener("click", printDoc);

els.modeSwitch.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (btn) setMode(btn.dataset.mode);
});

els.tabbar.addEventListener("click", (e) => {
  if (e.target.id === "tab-add") { newFile(); return; }
  const tabEl = e.target.closest(".tab");
  if (!tabEl) return;
  const id = Number(tabEl.dataset.id);
  if (e.target.classList.contains("tab-close")) closeTab(id);
  else switchTab(id);
});

// Tab drag-to-reorder
let dragId = null;
els.tabbar.addEventListener("dragstart", (e) => {
  const tabEl = e.target.closest(".tab");
  if (tabEl) dragId = Number(tabEl.dataset.id);
});
els.tabbar.addEventListener("dragover", (e) => {
  const tabEl = e.target.closest(".tab");
  if (tabEl && dragId != null) { e.preventDefault(); tabEl.classList.add("dragover"); }
});
els.tabbar.addEventListener("dragleave", (e) => {
  e.target.closest(".tab")?.classList.remove("dragover");
});
els.tabbar.addEventListener("drop", (e) => {
  const tabEl = e.target.closest(".tab");
  if (!tabEl || dragId == null) return;
  e.preventDefault();
  const targetId = Number(tabEl.dataset.id);
  const from = tabs.findIndex((t) => t.id === dragId);
  const to = tabs.findIndex((t) => t.id === targetId);
  if (from >= 0 && to >= 0 && from !== to) {
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    renderTabs();
    schedulePersist();
  }
  dragId = null;
});

els.source.addEventListener("input", () => {
  const t = activeTab();
  if (!t) return;
  t.markdown = els.source.value;
  afterEdit(t);
  if (mode === "split") renderPreview();
});
els.fmBox.addEventListener("input", () => {
  const t = activeTab();
  if (!t || !crepe) return;
  t.markdown = joinFrontmatter(els.fmBox.value, crepe.getMarkdown());
  afterEdit(t);
});

// Find bar wiring
els.findInput.addEventListener("input", () => { lastTerm = els.findInput.value; recomputeMatches(); selectMatch(0); });
els.findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? findPrev() : findNext(); }
  else if (e.key === "Escape") closeFind();
});
$("find-next").addEventListener("click", findNext);
$("find-prev").addEventListener("click", findPrev);
$("replace-one").addEventListener("click", replaceOne);
$("replace-all").addEventListener("click", replaceAll);
$("find-close").addEventListener("click", closeFind);

window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "Tab") { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); e.shiftKey ? saveFileAs() : saveFile(); }
  else if (k === "o") { e.preventDefault(); openFile(); }
  else if (k === "n") { e.preventDefault(); newFile(); }
  else if (k === "w") { e.preventDefault(); if (activeId != null) closeTab(activeId); }
  else if (k === "f") { e.preventDefault(); openFind(); }
  else if (k === "p") { e.preventDefault(); printDoc(); }
  else if (k === "\\") { e.preventDefault(); toggleSidebar(); }
});

window.addEventListener("blur", () => autosaveAll());
window.addEventListener("beforeunload", () => persistSession());

// ---------- Boot ----------
if (!restoreSession()) {
  const first = makeTab(
    "# Welcome\n\nStart typing. Use the tabs above to open multiple files. Toggle **WYSIWYG**, **Source**, or **Split** in the toolbar.\n",
    null
  );
  activeId = first.id;
}
for (const btn of els.modeSwitch.querySelectorAll("button"))
  btn.classList.toggle("active", btn.dataset.mode === mode);
toggleSidebar(sidebarOpen);
renderTabs();
renderActive();
setupDragDrop();
