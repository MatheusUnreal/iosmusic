/* IOSMusic – app (PWA). Fala direto com o Supabase; os downloads rodam no GitHub Actions. */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* cheio ou bloqueado */ } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const rel = (p) => new URL(p, document.baseURI).href;

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path class="fill" d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path class="fill" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M3 7h3c4 0 6 10 10 10h4M3 17h3c1.5 0 2.7-1.4 3.7-3M14.3 10c1-1.6 2.2-3 3.7-3h2M17 4l3 3-3 3M17 14l3 3-3 3"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle class="fill" cx="5" cy="12" r="1.6"/><circle class="fill" cx="12" cy="12" r="1.6"/><circle class="fill" cx="19" cy="12" r="1.6"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  dl: '<svg class="dl" viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M5 21h14"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M4 6h10M4 12h10M4 18h6M17 15l4 3-4 3z"/></svg>',
  queue: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></svg>',
};

/* ------------------------------------------------------------------ Supabase */
const CFG = window.IOSMUSIC_CONFIG || {};
let sbUrl = CFG.supabaseUrl || store.get('sbUrl', '');
let sbKey = CFG.supabaseAnonKey || store.get('sbKey', '');
let sb = null;
const BUCKET = 'music';
const SIGN_SECONDS = 30 * 24 * 3600;  // links das músicas valem 30 dias

function initSb() {
  if (!sbUrl || !sbKey) return false;
  sb = window.supabase.createClient(sbUrl, sbKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return true;
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) {
    if (error.status === 401 || /JWT/i.test(error.message || '')) { /* sessão expirou */ }
    throw new Error(error.message || 'Erro');
  }
  return data;
}

/* ------------------------------------------------------------------ estado */
let lib = store.get('lib', { tracks: [], playlists: [] });
let T = {};
const offline = new Set(store.get('offline', []));
const AUDIO_CACHE = 'iosmusic-audio-v1';
let jobs = [];
let jobTimer = null;
const urlCache = store.get('urls', {});  // caminho → { u, exp }

function indexLib() { T = Object.fromEntries(lib.tracks.map((t) => [t.id, t])); }
indexLib();

async function signPaths(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => p && !(urlCache[p] && urlCache[p].exp - now > 5 * 86400e3));
  for (let i = 0; i < need.length; i += 200) {
    const res = await q(sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 200), SIGN_SECONDS));
    for (const r of res) if (r.signedUrl) urlCache[r.path] = { u: r.signedUrl, exp: now + SIGN_SECONDS * 1000 };
  }
  for (const k of Object.keys(urlCache)) if (urlCache[k].exp < now) delete urlCache[k];
  store.set('urls', urlCache);
}

async function refreshLib() {
  try {
    const [tracks, playlists] = await Promise.all([
      q(sb.from('tracks').select('*').order('added_at', { ascending: false })),
      q(sb.from('playlists').select('*').order('created_at')),
    ]);
    await signPaths(tracks.flatMap((t) => [t.audio_path, t.cover_path]));
    for (const t of tracks) {
      t.audio_url = urlCache[t.audio_path]?.u;
      t.cover_url = t.cover_path ? urlCache[t.cover_path]?.u : null;
    }
    lib = { tracks, playlists, at: Date.now() };
    store.set('lib', lib);
    indexLib();
    $('#offline-badge').classList.add('hidden');
    render();
    return true;
  } catch (e) {
    if (!navigator.onLine || e instanceof TypeError || /fetch/i.test(e.message)) $('#offline-badge').classList.remove('hidden');
    else toast(e.message);
    return false;
  }
}

/* ------------------------------------------------------------------ login */
function showLogin() {
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  $('#cfg-fields').classList.toggle('hidden', configured);
  if (!configured) { $('#cfg-url').value = sbUrl; $('#cfg-key').value = sbKey; }
}
async function logout() {
  try { await sb?.auth.signOut(); } catch {}
  store.del('lib'); store.del('urls'); store.del('player');
  location.reload();
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-err').textContent = '';
  try {
    if (!(CFG.supabaseUrl && CFG.supabaseAnonKey)) {
      sbUrl = $('#cfg-url').value.trim().replace(/\/+$/, ''); sbKey = $('#cfg-key').value.trim();
      if (!sbUrl || !sbKey) throw new Error('Preencha a URL e a chave do Supabase');
      store.set('sbUrl', sbUrl); store.set('sbKey', sbKey);
    }
    initSb();
    const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message);
    start();
  } catch (err) { $('#login-err').textContent = err.message; }
});

/* ------------------------------------------------------------------ navegação */
let nav = [{ name: 'library' }];
const cur = () => nav[nav.length - 1];
function go(view, push = true) { if (push) nav.push(view); else nav = [view]; render(); window.scrollTo(0, 0); }
$('#back-btn').onclick = () => { if (nav.length > 1) { nav.pop(); render(); } };
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => go({ name: b.dataset.tab }, false)));

let searchQ = '';

function render() {
  const v = cur();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === (v.name === 'playlist' ? 'playlists' : v.name)));
  $('#back-btn').classList.toggle('hidden', nav.length < 2);
  const view = $('#view');
  if (v.name === 'library') { $('#view-title').textContent = 'Biblioteca'; view.innerHTML = libraryView(); bindSearch(); }
  else if (v.name === 'playlists') { $('#view-title').textContent = 'Playlists'; view.innerHTML = playlistsView(); }
  else if (v.name === 'playlist') { const p = getPl(v.id); $('#view-title').textContent = p ? p.name : 'Baixadas no iPhone'; view.innerHTML = playlistView(v.id); }
  else if (v.name === 'add') { $('#view-title').textContent = 'Adicionar'; view.innerHTML = addView(); bindAdd(); }
  markPlaying();
}

const getPl = (id) => lib.playlists.find((p) => p.id === id);
const coverUrl = (t) => (t?.cover_url && offline.has(t.id) ? rel(`offline-cover/${t.id}`) : t?.cover_url);
const plTracks = (id) => (id === '__offline' ? lib.tracks.filter((t) => offline.has(t.id)) : (getPl(id)?.track_ids || []).map((i) => T[i]).filter(Boolean));

function coverHtml(t, cls = 'sm') {
  return t?.cover_url ? `<img class="cover ${cls}" src="${esc(coverUrl(t))}" loading="lazy" alt="">` : `<div class="cover ${cls} ph">${ICON.note}</div>`;
}

function trackList(tracks, ctx) {
  if (!tracks.length) return '';
  return `<ul class="list" data-ctx="${esc(ctx)}">${tracks.map((t, i) => `
    <li class="item" data-act="play" data-i="${i}" data-id="${t.id}">
      ${coverHtml(t)}
      <div class="meta"><div class="t1">${esc(t.title)}</div>
        <div class="t2">${offline.has(t.id) ? ICON.dl : ''}${esc(t.artist || 'Desconhecido')}${t.duration ? ' · ' + fmt(t.duration) : ''}</div></div>
      <button class="icon-btn" data-act="more" data-id="${t.id}" aria-label="Opções">${ICON.more}</button>
    </li>`).join('')}</ul>`;
}

function filtered() {
  const s = searchQ.trim().toLowerCase();
  return s ? lib.tracks.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(s)) : lib.tracks;
}

function libraryView() {
  if (!lib.tracks.length) {
    return `<div class="empty"><b>Sua biblioteca está vazia</b>Toque em <b style="display:inline">Adicionar</b> e cole o link de uma música.</div>`;
  }
  return `<input class="search" id="search" type="search" placeholder="Buscar em ${lib.tracks.length} músicas" value="${esc(searchQ)}">
    <div class="row-actions">
      <button class="btn" data-act="playall" data-ctx="lib">${ICON.play} Tocar</button>
      <button class="btn" data-act="shuffleall" data-ctx="lib">${ICON.shuffle} Aleatório</button>
    </div>
    <div id="lib-list">${trackList(filtered(), 'lib')}</div>`;
}
function bindSearch() {
  const s = $('#search'); if (!s) return;
  s.oninput = () => { searchQ = s.value; $('#lib-list').innerHTML = trackList(filtered(), 'lib') || '<div class="empty">Nada encontrado</div>'; markPlaying(); };
}

function mosaic(tracks) {
  const covers = tracks.filter((t) => t.cover_url).map(coverUrl).slice(0, 4);
  if (covers.length >= 4) return `<div class="mosaic">${covers.map((c) => `<img src="${esc(c)}" loading="lazy" alt="">`).join('')}</div>`;
  if (covers.length) return `<div class="mosaic one"><img src="${esc(covers[0])}" loading="lazy" alt=""></div>`;
  return `<div class="mosaic one cover ph">${ICON.note}</div>`;
}

function playlistsView() {
  const offTracks = plTracks('__offline');
  return `<div class="row-actions"><button class="btn" data-act="newpl">${ICON.plus} Nova playlist</button></div>
    <div class="pl-grid">
      ${lib.playlists.map((p) => { const ts = plTracks(p.id); return `
        <button class="pl-card" data-act="openpl" data-id="${p.id}">${mosaic(ts)}
          <div class="t1">${esc(p.name)}</div><div class="t2">${ts.length} músicas</div></button>`; }).join('')}
      <button class="pl-card" data-act="openpl" data-id="__offline">
        <div class="mosaic one cover ph">${ICON.phone}</div>
        <div class="t1">Baixadas no iPhone</div><div class="t2">${offTracks.length} músicas</div></button>
    </div>`;
}

function playlistView(id) {
  const ts = plTracks(id);
  const isReal = id !== '__offline';
  return `<div class="row-actions">
      <button class="btn" data-act="playall" data-ctx="pl:${id}" ${ts.length ? '' : 'disabled'}>${ICON.play} Tocar</button>
      <button class="btn" data-act="shuffleall" data-ctx="pl:${id}" ${ts.length ? '' : 'disabled'}>${ICON.shuffle} Aleatório</button>
      ${isReal ? `<button class="btn" style="flex:0 0 52px" data-act="plmenu" data-id="${id}">${ICON.more}</button>` : ''}
    </div>
    ${ts.length ? trackList(ts, `pl:${id}`) : `<div class="empty"><b>Nenhuma música aqui</b>${isReal ? 'Use o menu ••• de uma música para adicioná-la, ou baixe um link direto nesta playlist.' : 'Abra o player e toque em “Baixar no iPhone” para ouvir sem internet.'}</div>`}`;
}

function ctxTracks(ctx) {
  if (ctx === 'lib') return filtered();
  if (ctx.startsWith('pl:')) return plTracks(ctx.slice(3));
  return [];
}

$('#view').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'more') { e.stopPropagation(); const ctx = el.closest('[data-ctx]')?.dataset.ctx; trackSheet(T[el.dataset.id], ctx); return; }
  if (act === 'play') { const ctx = el.closest('[data-ctx]').dataset.ctx; playList(ctxTracks(ctx).map((t) => t.id), +el.dataset.i, ctxName(ctx)); }
  if (act === 'playall' || act === 'shuffleall') {
    const ids = ctxTracks(el.dataset.ctx).map((t) => t.id); if (!ids.length) return;
    setShuffle(act === 'shuffleall');
    playList(ids, act === 'shuffleall' ? Math.floor(Math.random() * ids.length) : 0, ctxName(el.dataset.ctx));
  }
  if (act === 'openpl') go({ name: 'playlist', id: el.dataset.id });
  if (act === 'newpl') newPlaylist();
  if (act === 'plmenu') playlistSheet(el.dataset.id);
  if (act === 'logout') { if (confirm('Sair da conta neste aparelho?')) logout(); }
});
function ctxName(ctx) { return ctx === 'lib' ? 'Biblioteca' : ctx === 'pl:__offline' ? 'Baixadas no iPhone' : getPl(ctx.slice(3))?.name || ''; }

/* ------------------------------------------------------------------ adicionar */
const STATUS = { queued: 'na fila', downloading: 'baixando', converting: 'convertendo', uploading: 'enviando para a nuvem', done: 'pronto', error: 'erro' };
const ACTIVE = (j) => !['done', 'error'].includes(j.status);

function addView() {
  const pre = cur().playlist || '';
  return `<form class="add-box" id="add-form">
      <div class="add-row">
        <input id="add-url" type="url" inputmode="url" placeholder="Cole o link (YouTube, SoundCloud…)" autocomplete="off" required>
        <button type="button" class="btn" id="paste-btn">Colar</button>
      </div>
      <select id="add-pl"><option value="">Só na biblioteca</option>
        ${lib.playlists.map((p) => `<option value="${p.id}" ${p.id === pre ? 'selected' : ''}>Também na playlist: ${esc(p.name)}</option>`).join('')}</select>
      <button class="btn primary block" type="submit" id="add-submit">Baixar música</button>
      <div class="hint">O download roda no GitHub e leva de 1 a 2 minutos. Pode fechar o app, ele continua. Links de playlist baixam todas as músicas (até 100).</div>
      <p class="err" id="add-err"></p>
    </form>
    <div class="jobs" id="jobs">${jobsHtml()}</div>
    <div style="text-align:center;margin-top:36px"><button class="chip" data-act="logout">Sair da conta</button></div>`;
}
function jobsHtml() {
  if (!jobs.length) return '';
  return `<h3>Downloads</h3>${jobs.map((j) => `
    <div class="job"><div class="t1">${esc(j.title || j.url)}</div>
      <div class="st ${j.status === 'error' ? 'erro' : j.status === 'done' ? 'pronto' : ''}">${esc(STATUS[j.status] || j.status)}${j.status === 'downloading' && j.progress ? ` · ${j.progress}%` : ''}${j.status === 'queued' ? ' · aguardando o GitHub' : ''}${j.note ? ` · ${esc(j.note)}` : ''}${j.error ? `: ${esc(j.error)}` : ''}</div>
      ${ACTIVE(j) ? `<div class="bar"><div style="width:${j.status === 'downloading' ? Math.max(3, j.progress) : j.status === 'queued' ? 2 : 100}%"></div></div>` : ''}
    </div>`).join('')}`;
}
function bindAdd() {
  $('#paste-btn').onclick = async () => {
    try { $('#add-url').value = (await navigator.clipboard.readText()).trim(); } catch { $('#add-url').focus(); toast('Segure no campo e toque em Colar'); }
  };
  $('#add-form').onsubmit = async (e) => { e.preventDefault(); await submitUrl($('#add-url').value.trim(), $('#add-pl').value || null); };
}
async function submitUrl(url, playlistId) {
  const btn = $('#add-submit'); const err = $('#add-err');
  if (err) err.textContent = '';
  if (!/^https?:\/\/\S+$/.test(url)) { if (err) err.textContent = 'Link inválido'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    await q(sb.from('jobs').insert({ url, playlist_id: playlistId }));
    toast('Na fila! O GitHub começa em instantes');
    if ($('#add-url')) $('#add-url').value = '';
    pollJobs();
  } catch (e2) { if (err) err.textContent = e2.message; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Baixar música'; } }
}
async function pollJobs() {
  clearTimeout(jobTimer);
  try {
    const prevDone = new Set(jobs.filter((j) => j.status === 'done').map((j) => j.id));
    jobs = await q(sb.from('jobs').select('*').order('created_at', { ascending: false }).limit(40));
    if (jobs.some((j) => j.status === 'done' && !prevDone.has(j.id))) await refreshLib();
    if ($('#jobs')) $('#jobs').innerHTML = jobsHtml();
    if (jobs.some(ACTIVE)) jobTimer = setTimeout(pollJobs, 4000);
  } catch { jobTimer = setTimeout(pollJobs, 10000); }
}
async function cleanOldJobs() {
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  try { await sb.from('jobs').delete().in('status', ['done', 'error']).lt('created_at', dayAgo); } catch {}
}

/* ------------------------------------------------------------------ folhas (menus) */
function sheet(html) { $('#sheet').innerHTML = html; $('#sheet-wrap').classList.remove('hidden'); }
function closeSheet() { $('#sheet-wrap').classList.add('hidden'); }
$('#sheet-wrap').addEventListener('click', (e) => { if (e.target.id === 'sheet-wrap') closeSheet(); });
const opt = (act, icon, label, cls = '') => `<button class="opt ${cls}" data-o="${act}">${ICON[icon]}<span>${label}</span></button>`;

function trackSheet(t, ctx) {
  if (!t) return;
  const inPl = ctx && ctx.startsWith('pl:') && ctx !== 'pl:__offline' ? ctx.slice(3) : null;
  sheet(`<div class="head">${coverHtml(t, 'md')}<div class="meta" style="min-width:0"><div class="t1">${esc(t.title)}</div><div class="t2">${esc(t.artist)}</div></div></div>
    ${opt('next', 'next', 'Tocar a seguir')}
    ${opt('queue', 'queue', 'Adicionar à fila')}
    ${opt('addpl', 'plus', 'Adicionar a uma playlist')}
    ${inPl ? opt('rmpl', 'minus', 'Remover desta playlist') : ''}
    ${offline.has(t.id) ? opt('unoff', 'phone', 'Remover do iPhone') : opt('off', 'phone', 'Baixar no iPhone (offline)')}
    ${opt('edit', 'edit', 'Editar nome/artista')}
    ${t.source_url ? opt('src', 'link', 'Abrir link original') : ''}
    ${opt('del', 'trash', 'Apagar da nuvem', 'danger')}`);
  $('#sheet').onclick = async (e) => {
    const o = e.target.closest('[data-o]')?.dataset.o; if (!o) return;
    try {
      if (o === 'next') { queueNext(t.id); closeSheet(); toast('Toca a seguir'); }
      if (o === 'queue') { queueAdd(t.id); closeSheet(); toast('Adicionada à fila'); }
      if (o === 'addpl') pickPlaylist(t);
      if (o === 'rmpl') { const p = getPl(inPl); await savePl(inPl, { track_ids: p.track_ids.filter((i) => i !== t.id) }); closeSheet(); }
      if (o === 'off') { closeSheet(); saveOffline(t); }
      if (o === 'unoff') { closeSheet(); removeOffline(t.id); }
      if (o === 'edit') editTrack(t);
      if (o === 'src') { window.open(t.source_url, '_blank'); closeSheet(); }
      if (o === 'del') {
        if (!confirm(`Apagar “${t.title}” da nuvem? Isso não pode ser desfeito.`)) return;
        closeSheet();
        await deleteTrack(t);
        toast('Apagada');
      }
    } catch (e2) { toast(e2.message); }
  };
}

async function deleteTrack(t) {
  for (const p of lib.playlists.filter((x) => x.track_ids.includes(t.id))) {
    await q(sb.from('playlists').update({ track_ids: p.track_ids.filter((i) => i !== t.id) }).eq('id', p.id));
  }
  await q(sb.from('tracks').delete().eq('id', t.id));
  await q(sb.storage.from(BUCKET).remove([t.audio_path, t.cover_path].filter(Boolean)));
  removeOffline(t.id, true);
  await refreshLib();
}

function pickPlaylist(t) {
  sheet(`<h3>Adicionar a…</h3>${opt('__new', 'plus', 'Nova playlist')}
    ${lib.playlists.map((p) => `<button class="opt" data-o="${p.id}">${ICON.queue}<span>${esc(p.name)}${p.track_ids.includes(t.id) ? ' ✓' : ''}</span></button>`).join('')}`);
  $('#sheet').onclick = async (e) => {
    const o = e.target.closest('[data-o]')?.dataset.o; if (!o) return;
    closeSheet();
    try {
      if (o === '__new') {
        const name = prompt('Nome da playlist'); if (!name) return;
        await q(sb.from('playlists').insert({ name: name.trim().slice(0, 100), track_ids: [t.id] }));
        await refreshLib();
      } else {
        const p = getPl(o);
        if (!p.track_ids.includes(t.id)) await savePl(o, { track_ids: [...p.track_ids, t.id] });
      }
      toast('Adicionada à playlist');
    } catch (e2) { toast(e2.message); }
  };
}

function editTrack(t) {
  sheet(`<h3>Editar</h3><form class="form" id="edit-form">
    <input type="text" id="e-title" value="${esc(t.title)}" placeholder="Título">
    <input type="text" id="e-artist" value="${esc(t.artist)}" placeholder="Artista">
    <button class="btn primary" type="submit">Salvar</button></form>`);
  $('#sheet').onclick = null;
  $('#edit-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await q(sb.from('tracks').update({ title: $('#e-title').value.trim().slice(0, 200), artist: $('#e-artist').value.trim().slice(0, 200) }).eq('id', t.id));
      closeSheet(); await refreshLib(); updateNowPlaying();
    } catch (e2) { toast(e2.message); }
  };
}

function playlistSheet(id) {
  const p = getPl(id);
  sheet(`<h3>${esc(p.name)}</h3>${opt('link', 'plus', 'Baixar link direto nesta playlist')}${opt('offall', 'phone', 'Baixar todas no iPhone')}${opt('ren', 'edit', 'Renomear')}${opt('del', 'trash', 'Apagar playlist', 'danger')}`);
  $('#sheet').onclick = async (e) => {
    const o = e.target.closest('[data-o]')?.dataset.o; if (!o) return;
    closeSheet();
    try {
      if (o === 'link') go({ name: 'add', playlist: id }, false);
      if (o === 'offall') { toast('Baixando para o iPhone…'); for (const t of plTracks(id)) if (!offline.has(t.id)) await saveOffline(t, true); toast('Playlist disponível offline ✓'); render(); }
      if (o === 'ren') { const n = prompt('Novo nome', p.name); if (n && n.trim()) await savePl(id, { name: n.trim().slice(0, 100) }); }
      if (o === 'del') {
        if (!confirm(`Apagar a playlist “${p.name}”? As músicas continuam na biblioteca.`)) return;
        await q(sb.from('playlists').delete().eq('id', id));
        nav = [{ name: 'playlists' }]; await refreshLib();
      }
    } catch (e2) { toast(e2.message); }
  };
}

async function newPlaylist() {
  const name = prompt('Nome da playlist'); if (!name || !name.trim()) return;
  try {
    const rows = await q(sb.from('playlists').insert({ name: name.trim().slice(0, 100) }).select());
    await refreshLib(); go({ name: 'playlist', id: rows[0].id });
  } catch (e) { toast(e.message); }
}
async function savePl(id, fields) { await q(sb.from('playlists').update(fields).eq('id', id)); await refreshLib(); }

/* ------------------------------------------------------------------ offline (Cache API) */
const offKey = (id) => rel(`offline/${id}`);
async function saveOffline(t, quiet = false) {
  if (!('caches' in window)) { toast('Seu navegador não suporta offline'); return; }
  if (!quiet) toast('Baixando para o iPhone…');
  try {
    const res = await fetch(t.audio_url);
    if (!res.ok) throw new Error('Falha ao baixar');
    const blob = await res.blob();
    const c = await caches.open(AUDIO_CACHE);
    await c.put(offKey(t.id), new Response(blob, { headers: { 'Content-Type': 'audio/mp4' } }));
    if (t.cover_url) {
      try { const cr = await fetch(t.cover_url); if (cr.ok) await c.put(rel(`offline-cover/${t.id}`), new Response(await cr.blob(), { headers: { 'Content-Type': 'image/jpeg' } })); } catch {}
    }
    offline.add(t.id); store.set('offline', [...offline]);
    if (navigator.storage?.persist) navigator.storage.persist();
    if (!quiet) { toast('Disponível offline ✓'); render(); }
    updateOfflineBtn();
  } catch (e) { toast(e.message); }
}
async function removeOffline(id, quiet) {
  try { const c = await caches.open(AUDIO_CACHE); await c.delete(offKey(id)); await c.delete(rel(`offline-cover/${id}`)); } catch {}
  offline.delete(id); store.set('offline', [...offline]);
  if (!quiet) { toast('Removida do iPhone'); render(); }
  updateOfflineBtn();
}
async function offlineSrc(id) {
  const c = await caches.open(AUDIO_CACHE);
  const r = await c.match(offKey(id));
  return r ? URL.createObjectURL(await r.blob()) : null;
}

/* ------------------------------------------------------------------ player */
const audio = $('#audio');
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const P = store.get('player', { queue: [], original: [], idx: -1, shuffle: false, repeat: 0, ctx: '', time: 0 });
let blobUrl = null;
let retried = false;

function savePlayer() { store.set('player', { ...P, time: audio.currentTime || P.time }); }
const curTrack = () => T[P.queue[P.idx]];

function shuffled(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function playList(ids, start, ctx) {
  P.original = ids.slice(); P.ctx = ctx || '';
  if (P.shuffle) { const first = ids[start]; P.queue = [first, ...shuffled(ids.filter((_, i) => i !== start))]; P.idx = 0; }
  else { P.queue = ids.slice(); P.idx = start; }
  load(true);
}

function setShuffle(on) {
  P.shuffle = on;
  const id = P.queue[P.idx];
  if (id) {
    if (on) { P.queue = [id, ...shuffled(P.queue.filter((x, i) => i !== P.idx))]; P.idx = 0; }
    else if (P.original.length) { P.queue = P.original.slice(); P.idx = Math.max(0, P.queue.indexOf(id)); }
  }
  $('#btn-shuffle').classList.toggle('on', on); savePlayer();
}

function queueNext(id) { if (P.idx < 0) { playList([id], 0, 'Fila'); return; } P.queue.splice(P.idx + 1, 0, id); savePlayer(); }
function queueAdd(id) { if (P.idx < 0) { playList([id], 0, 'Fila'); return; } P.queue.push(id); savePlayer(); }

// Chamado dentro do toque do usuário → o iOS libera o <audio> para tocar depois em segundo plano
async function load(autoplay, startAt = 0) {
  const t = curTrack(); if (!t) return;
  retried = false;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  if (offline.has(t.id)) {
    if (autoplay && audio.paused) { audio.src = SILENT; audio.play().catch(() => {}); }  // desbloqueia já
    blobUrl = await offlineSrc(t.id);
    if (curTrack() !== t) return;
    audio.src = blobUrl || t.audio_url;
  } else {
    audio.src = t.audio_url;
  }
  if (startAt) audio.addEventListener('loadedmetadata', () => { audio.currentTime = startAt; }, { once: true });
  if (autoplay) audio.play().catch(() => {});
  updateNowPlaying(); savePlayer();
}

function next(auto = false) {
  if (!P.queue.length) return;
  if (auto && P.repeat === 2) { audio.currentTime = 0; audio.play(); return; }
  if (P.idx < P.queue.length - 1) P.idx++;
  else if (P.repeat === 1 || !auto) P.idx = 0;
  else { audio.pause(); audio.currentTime = 0; return; }
  load(true);
}
function prev() {
  if (audio.currentTime > 3 || P.idx <= 0) { audio.currentTime = 0; return; }
  P.idx--; load(true);
}
function toggle() {
  if (!curTrack()) return;
  if (!audio.src || audio.src === location.href) { load(true, P.time); return; }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}

audio.addEventListener('ended', () => next(true));
audio.addEventListener('play', updatePlayIcons);
audio.addEventListener('pause', () => { updatePlayIcons(); savePlayer(); });
audio.addEventListener('error', async () => {
  if (audio.src.startsWith('data:')) return;
  const t = curTrack(); if (!t || retried) { toast('Não consegui tocar esta música'); return; }
  retried = true;   // link pode ter vencido → renova e tenta de novo
  const pos = audio.currentTime;
  delete urlCache[t.audio_path];
  if (await refreshLib()) { audio.src = T[t.id]?.audio_url || t.audio_url; audio.currentTime = pos; audio.play().catch(() => {}); }
  else toast('Sem internet — baixe a música no iPhone para ouvir offline');
});

let lastPos = 0;
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || curTrack()?.duration || 0; const c = audio.currentTime;
  const pct = d ? (c / d) * 100 : 0;
  $('#mini-bar').style.width = `${pct}%`;
  if (!seeking) { $('#seek').value = d ? Math.round((c / d) * 1000) : 0; $('#seek').style.setProperty('--p', `${pct}%`); }
  $('#t-cur').textContent = fmt(c); $('#t-dur').textContent = fmt(d);
  if (Math.abs(c - lastPos) > 5) {
    lastPos = c; P.time = c; savePlayer();
    if (navigator.mediaSession?.setPositionState && d && isFinite(d)) { try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: 1 }); } catch {} }
  }
});

let seeking = false;
const seek = $('#seek');
seek.addEventListener('input', () => { seeking = true; const d = audio.duration || 0; $('#t-cur').textContent = fmt((seek.value / 1000) * d); seek.style.setProperty('--p', `${seek.value / 10}%`); });
seek.addEventListener('change', () => { const d = audio.duration || 0; if (d) audio.currentTime = (seek.value / 1000) * d; seeking = false; });

function updatePlayIcons() {
  const ic = audio.paused ? ICON.play : ICON.pause;
  $('#mini-play').innerHTML = ic; $('#btn-play').innerHTML = ic;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}

function updateNowPlaying() {
  const t = curTrack();
  $('#mini').classList.toggle('hidden', !t);
  if (!t) return;
  const cover = coverUrl(t) || 'icons/icon-512.png';
  $('#mini-cover').src = cover; $('#full-cover').src = cover;
  $('#full-bg').style.backgroundImage = `url("${cover}")`;
  $('#mini-title').textContent = t.title; $('#full-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist; $('#full-artist').textContent = t.artist;
  $('#full-context').textContent = P.ctx ? `Tocando de ${P.ctx}` : 'Tocando agora';
  $('#t-dur').textContent = fmt(t.duration);
  updateOfflineBtn(); updatePlayIcons(); markPlaying();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist || '', album: t.album || P.ctx || 'IOSMusic',
      artwork: [{ src: rel(cover), sizes: '512x512', type: t.cover_url ? 'image/jpeg' : 'image/png' }],
    });
  }
  document.title = `${t.title} · IOSMusic`;
}
function updateOfflineBtn() {
  const t = curTrack(); const b = $('#btn-offline'); if (!t) return;
  const on = offline.has(t.id);
  b.textContent = on ? 'No iPhone ✓' : 'Baixar no iPhone'; b.classList.toggle('on', on);
}
function markPlaying() {
  const id = P.queue[P.idx];
  document.querySelectorAll('.item').forEach((li) => li.classList.toggle('playing', li.dataset.id === id));
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => audio.play());
  ms.setActionHandler('pause', () => audio.pause());
  ms.setActionHandler('previoustrack', prev);
  ms.setActionHandler('nexttrack', () => next());
  try { ms.setActionHandler('seekto', (d) => { audio.currentTime = d.seekTime; }); } catch {}
}

$('#mini-play').onclick = (e) => { e.stopPropagation(); toggle(); };
$('#mini-next').onclick = (e) => { e.stopPropagation(); next(); };
$('#mini').onclick = () => $('#full').classList.add('open');
$('#full-close').onclick = () => $('#full').classList.remove('open');
$('#btn-play').onclick = toggle;
$('#btn-next').onclick = () => next();
$('#btn-prev').onclick = prev;
$('#btn-shuffle').onclick = () => setShuffle(!P.shuffle);
$('#btn-repeat').onclick = () => { P.repeat = (P.repeat + 1) % 3; updateRepeat(); savePlayer(); };
$('#btn-offline').onclick = () => { const t = curTrack(); if (!t) return; offline.has(t.id) ? removeOffline(t.id) : saveOffline(t); };
$('#full-more').onclick = () => trackSheet(curTrack(), null);
$('#btn-queue').onclick = queueSheet;
function updateRepeat() { $('#btn-repeat').classList.toggle('on', P.repeat > 0); $('#repeat-one').classList.toggle('hidden', P.repeat !== 2); }

// arrastar o player para baixo fecha
let touchY = null;
$('#full').addEventListener('touchstart', (e) => { if (e.target.closest('input')) return; touchY = e.touches[0].clientY; }, { passive: true });
$('#full').addEventListener('touchend', (e) => { if (touchY != null && e.changedTouches[0].clientY - touchY > 120) $('#full').classList.remove('open'); touchY = null; });

function queueSheet() {
  const up = P.queue.slice(P.idx).map((id, k) => [id, P.idx + k]).filter(([id]) => T[id]);
  sheet(`<h3>Fila</h3><ul class="list" style="padding:0 10px">${up.map(([id, i]) => `
    <li class="item ${i === P.idx ? 'playing' : ''}" data-q="${i}">${coverHtml(T[id])}<div class="meta"><div class="t1">${esc(T[id].title)}</div><div class="t2">${esc(T[id].artist)}</div></div></li>`).join('')}</ul>`);
  $('#sheet').onclick = (e) => { const li = e.target.closest('[data-q]'); if (!li) return; P.idx = +li.dataset.q; closeSheet(); load(true); };
}

/* ------------------------------------------------------------------ misc */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }

window.addEventListener('online', () => sb && refreshLib());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !sb) return;
  if (Date.now() - (lib.at || 0) > 60000) refreshLib();
  if (jobs.some(ACTIVE)) pollJobs();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

function start() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  render();
  if (curTrack()) { updateNowPlaying(); $('#btn-shuffle').classList.toggle('on', P.shuffle); updateRepeat(); }
  refreshLib().then(() => { if (curTrack()) updateNowPlaying(); });
  pollJobs();
  cleanOldJobs();
  // Atalho do iOS: abrir  .../?add=<link>  baixa direto
  const add = new URLSearchParams(location.search).get('add');
  if (add) { history.replaceState(null, '', location.pathname); go({ name: 'add' }, false); submitUrl(add, null); }
}

(async function boot() {
  if (!initSb()) { showLogin(); return; }
  // A sessão fica salva no aparelho → abre mesmo sem internet
  const { data } = await sb.auth.getSession();
  if (data.session) start(); else showLogin();
})();
