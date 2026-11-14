/* FunThing 导航页 · 统一管理后台 API（Cloudflare Pages Functions）
   路由: /api/admin（POST JSON，需请求头 X-Admin-Password）
   环境变量（在 Cloudflare 后台 → funthing-pages 项目 → Settings → Environment variables 添加）:
     ADMIN_PASSWORD  — 管理密码（必填，未配置时后台整体停用）
     QINIU_AK / QINIU_SK / QINIU_BUCKET — 七牛云密钥（投稿墙管理用）
     QINIU_DOMAIN    — 七牛下载域名（可选，默认 tn3b3bcgf.hn-bkt.clouddn.com）
   KV 绑定:
     MESSAGES — 留言（msg:*）
     COUNTERS — 余票（key ticket_stock，与 guntaodance 购票页共用同一命名空间）
   功能:
     留言管理  listMessages / editMessage(改昵称/改内容) / deleteMessage —— 存 KV 绑定 MESSAGES
     投稿墙    listFiles / renameFile(改名) / deleteFile —— 调七牛云 rs 管理接口
     余票管理  getStock / setStock —— 存 KV 绑定 COUNTERS */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  'Access-Control-Max-Age': '86400',
};

const QINIU_DEFAULT_DOMAIN = 'tn3b3bcgf.hn-bkt.clouddn.com';
const MSG_KEY_RE = /^msg:\d+:[a-z0-9]+$/;
const FILE_KEY_RE = /^[A-Za-z0-9_.\-]{1,200}$/;
const NAV_CARDS_KEY = 'nav_cards';
const MAX_CARDS = 200;
const CARD_QINIU_PREFIX = 'card/';
const CARD_CATS = ['game', 'tool', 'site'];
const CARD_COLORS = ['dance', 'trade', 'cloud', 'register', 'exam', 'login', 'ai'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  // ---- 密码校验 ----
  const pwd = (env.ADMIN_PASSWORD || '').trim();
  if (!pwd) {
    return json({
      ok: false,
      error: '管理密码未配置：请在 Cloudflare 后台 → Workers & Pages → funthing-pages → Settings → Environment variables → Production 添加 ADMIN_PASSWORD（以及 QINIU_AK / QINIU_SK / QINIU_BUCKET 用于投稿墙与音乐上传）后重新部署。',
      setup: true,
    }, 503);
  }
  if ((request.headers.get('X-Admin-Password') || '') !== pwd) {
    return json({ ok: false, error: '密码错误' }, 401);
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ ok: false, error: 'bad request' }, 400);
  }
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'ping': return json({ ok: true, time: Date.now() });
      case 'listMessages': return await listMessages(env);
      case 'editMessage': return await editMessage(env, body);
      case 'deleteMessage': return await deleteMessage(env, body);
      case 'listFiles': return await listFiles(env);
      case 'renameFile': return await renameFile(env, body);
      case 'deleteFile': return await deleteFile(env, body);
      case 'getStock': return await getStock(env);
      case 'setStock': return await setStock(env, body);
      case 'getMusic': return await getMusic(env);
      case 'setMusic': return await setMusic(env, body);
      case 'musicToken': return await musicToken(env, body);
      case 'deleteMusic': return await deleteMusic(env, body);
      case 'getCards': return await getCards(env);
      case 'saveCards': return await saveCards(env, body);
      case 'cardToken': return await cardToken(env, body);
      case 'listVisits': return await listVisits(env);
      case 'clearVisits': return await clearVisits(env);
      default: return json({ ok: false, error: '未知操作: ' + action }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

/* ================= 留言管理（KV: MESSAGES） ================= */

async function listMessages(env) {
  const list = await env.MESSAGES.list({ limit: 500 });
  const keys = list.keys.map(k => k.name).sort().reverse(); // 新 → 旧
  const messages = [];
  for (const name of keys.slice(0, 200)) {
    const item = await env.MESSAGES.get(name, 'json');
    if (item && typeof item === 'object' && item.text) messages.push({ key: name, ...item });
  }
  return json({ ok: true, messages });
}

async function editMessage(env, body) {
  const key = String(body.key || '');
  if (!MSG_KEY_RE.test(key)) return json({ ok: false, error: '非法留言标识' }, 400);
  const item = await env.MESSAGES.get(key, 'json');
  if (!item || typeof item !== 'object') return json({ ok: false, error: '留言不存在（可能已被自动裁剪）' }, 404);

  if (body.name !== undefined) item.name = String(body.name).trim().slice(0, 16) || '匿名';
  if (body.text !== undefined) item.text = String(body.text).trim().slice(0, 200);
  if (!item.text) return json({ ok: false, error: '内容不能为空' }, 400);

  await env.MESSAGES.put(key, JSON.stringify(item));
  return json({ ok: true, message: { key, ...item } });
}

async function deleteMessage(env, body) {
  const key = String(body.key || '');
  if (!MSG_KEY_RE.test(key)) return json({ ok: false, error: '非法留言标识' }, 400);
  await env.MESSAGES.delete(key);
  return json({ ok: true });
}

/* ================= 余票管理（KV: COUNTERS，key ticket_stock） ================= */

const TICKET_TYPES = ['normal', 'premium', 'vip'];
const STOCK_KEY = 'ticket_stock';
const DEFAULT_STOCK = 80;

function normalizeStock(stock) {
  const out = {};
  if (stock && typeof stock === 'object') {
    for (const [id, t] of Object.entries(stock)) {
      if (!t || typeof t !== 'object') continue;
      out[id] = {
        normal: Math.max(0, parseInt(t.normal, 10) || 0),
        premium: Math.max(0, parseInt(t.premium, 10) || 0),
        vip: Math.max(0, parseInt(t.vip, 10) || 0),
      };
    }
  }
  return out;
}

async function readStock(env) {
  let raw = null;
  try { raw = await env.COUNTERS.get(STOCK_KEY, 'json'); } catch (e) { raw = null; }
  return normalizeStock(raw);
}

async function getStock(env) {
  return json({ ok: true, stock: await readStock(env), default: DEFAULT_STOCK });
}

async function setStock(env, body) {
  const showId = String(body.showId || '').trim();
  if (!showId) return json({ ok: false, error: '缺少场次 id' }, 400);
  const stock = await readStock(env);
  if (!stock[showId]) {
    stock[showId] = { normal: DEFAULT_STOCK, premium: DEFAULT_STOCK, vip: DEFAULT_STOCK };
  }

  // 允许单独设置某票种余量，也允许整体重设
  let changed = false;
  for (const type of TICKET_TYPES) {
    if (body[type] === undefined) continue;
    let n = parseInt(body[type], 10);
    if (!Number.isFinite(n)) return json({ ok: false, error: '余票必须是数字' }, 400);
    n = Math.max(0, Math.min(99999, n));
    stock[showId][type] = n;
    changed = true;
  }
  if (!changed) return json({ ok: false, error: '没有要修改的票种' }, 400);

  await env.COUNTERS.put(STOCK_KEY, JSON.stringify(stock));
  return json({ ok: true, stock, show: stock[showId] });
}

/* ================= 音乐管理（KV: COUNTERS，key music_list） =================

   歌单结构:
     { version:1, updatedAt:ISO, tracks:[ {id,name,artist,src,type,lrc} ] }
       type='repo'  → src 是站点内相对路径，例如 '13.mp3'（Cloudflare Pages 静态文件）
       type='qiniu' → src 是七牛对象 key，例如 'music/1752_abcd.mp3'
   站点读取: guntaodance 的 GET /api/music
   新上传的音乐统一走七牛（不占仓库、不需要 git push 重新部署） */

const MUSIC_KEY = 'music_list';
const MAX_TRACKS = 300;
const MUSIC_QINIU_PREFIX = 'music/';

function normalizeTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const src = String(t.src || '').trim();
  if (!src || src.length > 300) return null;
  if (src.indexOf('..') >= 0) return null;
  return {
    id: String(t.id || src).slice(0, 160),
    name: String(t.name || '').trim().slice(0, 120),
    artist: String(t.artist || '').trim().slice(0, 120),
    src,
    type: t.type === 'qiniu' ? 'qiniu' : 'repo',
    lrc: String(t.lrc || '').trim().slice(0, 300),
  };
}

async function getMusic(env) {
  let raw = null;
  try { raw = await env.COUNTERS.get(MUSIC_KEY, 'json'); } catch (e) { raw = null; }
  const tracks = (raw && Array.isArray(raw.tracks))
    ? raw.tracks.slice(0, MAX_TRACKS).map(normalizeTrack).filter(Boolean)
    : [];
  return json({
    ok: true,
    tracks,
    updatedAt: (raw && raw.updatedAt) || null,
    count: tracks.length,
    max: MAX_TRACKS,
  });
}

async function setMusic(env, body) {
  if (!Array.isArray(body.tracks)) return json({ ok: false, error: '缺少 tracks 数组' }, 400);
  if (body.tracks.length > MAX_TRACKS) return json({ ok: false, error: '曲目数量超过上限 ' + MAX_TRACKS }, 400);

  const tracks = [];
  for (const t of body.tracks) {
    const n = normalizeTrack(t);
    if (!n) return json({ ok: false, error: '存在非法的曲目数据（src 为空或路径非法）' }, 400);
    tracks.push(n);
  }

  const updatedAt = new Date().toISOString();
  await env.COUNTERS.put(MUSIC_KEY, JSON.stringify({ version: 1, updatedAt, tracks }));
  return json({ ok: true, tracks, updatedAt, count: tracks.length });
}

/* 生成带固定对象 key 的上传凭证（scope = bucket:key），
   这样后台可以精确控制文件落到 music/ 目录，前端上传完直接把 key 记进歌单 */
async function musicToken(env, body) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const name = String(body.name || '').replace(/[^A-Za-z0-9_.\-]/g, '_').slice(-80) || 'track.mp3';
  const key = MUSIC_QINIU_PREFIX + Date.now() + '_' + Math.floor(Math.random() * 10000) + '_' + name;

  const putPolicy = JSON.stringify({
    scope: BUCKET + ':' + key,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  });
  const encodedPutPolicy = btoa(putPolicy).replace(/\+/g, '-').replace(/\//g, '_');

  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SK),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(encodedPutPolicy));
  const signatureBase64 = b64url(new Uint8Array(sig));

  return json({
    ok: true,
    key,
    token: AK + ':' + signatureBase64 + ':' + encodedPutPolicy,
    uploadUrl: 'https://upload-z2.qiniup.com',
  });
}

/* 删除七牛上的音乐对象（只允许删 music/ 前缀，避免误删投稿墙图片） */
async function deleteMusic(env, body) {
  const key = String(body.key || '').trim();
  if (key.indexOf(MUSIC_QINIU_PREFIX) !== 0) {
    return json({ ok: false, error: '只能删除 music/ 目录下的文件' }, 400);
  }
  if (!/^[A-Za-z0-9_.\-\/]{1,300}$/.test(key) || key.indexOf('..') >= 0) {
    return json({ ok: false, error: '非法文件名' }, 400);
  }
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const path = '/delete/' + entry(BUCKET, key);
  const auth = await qiniuAuth(AK, SK, 'POST', path, 'rs.qbox.me');
  const resp = await fetch('https://rs.qbox.me' + path, {
    method: 'POST',
    headers: { Authorization: auth },
  });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const d = await resp.json(); if (d && d.error) msg += ': ' + d.error; } catch (e) {}
    // 七牛返回 612 表示文件不存在，对删除操作视为已达成目标
    if (resp.status === 612) return json({ ok: true, missing: true });
    return json({ ok: false, error: '删除七牛文件失败（' + msg + '）' }, 502);
  }
  return json({ ok: true });
}

/* ================= 投稿墙管理（七牛云 rs 接口） ================= */

function qiniuEnv(env) {
  const AK = (env.QINIU_AK || '').trim();
  const SK = (env.QINIU_SK || '').trim();
  const BUCKET = (env.QINIU_BUCKET || '').trim();
  if (!AK || !SK || !BUCKET) {
    const err = new Error('七牛云环境变量未配置：请在 Cloudflare 后台给 funthing-pages 项目添加 QINIU_AK / QINIU_SK / QINIU_BUCKET 后重新部署');
    err.status = 500;
    throw err;
  }
  return { AK, SK, BUCKET, DOMAIN: (env.QINIU_DOMAIN || '').trim() || QINIU_DEFAULT_DOMAIN };
}

/* URL-safe Base64：二进制 → 保留 = 填充 */
function b64url(bytesOrString) {
  let bin = '';
  const bytes = typeof bytesOrString === 'string'
    ? new TextEncoder().encode(bytesOrString)
    : bytesOrString;
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

/* 七牛条目编码：urlsafe_base64("bucket:key")，保留 = 填充（实测去掉 = 会报 InvalidArgs） */
function entry(bucket, key) {
  return b64url(bucket + ':' + key);
}

/* 七牛管理凭证（rs.qbox.me）：signingStr = "METHOD path?query\nHost: host\n\n"，HMAC-SHA1，保留 = */
async function qiniuAuth(AK, SK, method, pathAndQuery, host) {
  const signingStr = method + ' ' + pathAndQuery + '\nHost: ' + host + '\n\n';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SK),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingStr));
  return 'Qiniu ' + AK + ':' + b64url(new Uint8Array(sig));
}

async function listFiles(env) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const all = [];
  let marker = '';
  for (let i = 0; i < 100; i++) {
    let path = '/list?bucket=' + encodeURIComponent(BUCKET) + '&limit=1000';
    if (marker) path += '&marker=' + encodeURIComponent(marker);
    const auth = await qiniuAuth(AK, SK, 'GET', path, 'rsf.qbox.me');
    const resp = await fetch('https://rsf.qbox.me' + path, { headers: { Authorization: auth } });
    if (!resp.ok) throw new Error('七牛列表失败 HTTP ' + resp.status);
    const data = await resp.json();
    if (data.items) all.push(...data.items);
    if (!data.marker) break;
    marker = data.marker;
  }
  const items = all
    .map(f => ({
      key: f.key,
      size: f.fsize || 0,
      mimeType: f.mimeType || '',
      putTime: f.putTime || 0,
      url: '/api/admin-file?key=' + encodeURIComponent(f.key),
    }))
    .sort((a, b) => b.putTime - a.putTime);
  return json({ ok: true, items });
}

async function deleteFile(env, body) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const key = String(body.key || '');
  if (!FILE_KEY_RE.test(key)) return json({ ok: false, error: '非法文件名' }, 400);

  const path = '/delete/' + entry(BUCKET, key);
  const auth = await qiniuAuth(AK, SK, 'POST', path, 'rs.qbox.me');
  const resp = await fetch('https://rs.qbox.me' + path, {
    method: 'POST',
    headers: { Authorization: auth },
  });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const d = await resp.json(); if (d && d.error) msg += ': ' + d.error; } catch (e) {}
    throw new Error('删除失败（' + msg + '）');
  }
  return json({ ok: true });
}

async function renameFile(env, body) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const key = String(body.key || '');
  const newKey = String(body.newKey || '').trim();
  if (!FILE_KEY_RE.test(key) || !FILE_KEY_RE.test(newKey)) return json({ ok: false, error: '文件名只能包含字母、数字、下划线、点和短横线' }, 400);
  if (key === newKey) return json({ ok: true, newKey });

  const path = '/move/' + entry(BUCKET, key) + '/' + entry(BUCKET, newKey);
  const auth = await qiniuAuth(AK, SK, 'POST', path, 'rs.qbox.me');
  const resp = await fetch('https://rs.qbox.me' + path, {
    method: 'POST',
    headers: { Authorization: auth },
  });
  if (!resp.ok) {
    let msg = 'HTTP ' + resp.status;
    try { const d = await resp.json(); if (d && d.error) msg += ': ' + d.error; } catch (e) {}
    throw new Error('改名失败（' + msg + '），注意新文件名不能与已有文件重名');
  }
  return json({ ok: true, newKey });
}

/* ================= 导航卡片管理（KV: COUNTERS，key nav_cards） =================

   卡片结构:
     { version:1, updatedAt:ISO, cards:[ {id,name,cat,color,icon,tag,href,mode} ] }
       cat  ∈ game | tool | site
       color∈ dance | trade | cloud | register | exam | login | ai
       icon    — emoji 或图片 URL（http... 视为图标图片）
       tag     — 卡片右下角小字（可空）
       href    — 站内相对路径或完整 URL；mode='modal' 时是弹窗标识
       mode    — 'link'（默认，<a>）| 'modal'（onclick 弹窗，仅内置几个）
   站点读取: GET /api/nav（免密）返回 cards 数组 */

function normalizeCard(c, i) {
  if (!c || typeof c !== 'object') return null;
  const name = String(c.name || '').trim().slice(0, 40);
  if (!name) return null;
  const cat = CARD_CATS.indexOf(c.cat) >= 0 ? c.cat : 'site';
  const color = CARD_COLORS.indexOf(c.color) >= 0 ? c.color : 'dance';
  const icon = String(c.icon || '🔗').slice(0, 200);
  const tag = String(c.tag || '').trim().slice(0, 20);
  const mode = c.mode === 'modal' ? 'modal' : 'link';
  let href = String(c.href || '').trim().slice(0, 400);
  if (!href) return null;
  if (href.indexOf('..') >= 0 || /[\r\n]/.test(href)) return null;
  return {
    id: String(c.id || 'c' + (i + 1)).slice(0, 40),
    name, cat, color, icon, tag, href, mode,
  };
}

async function getCards(env) {
  let raw = null;
  try { raw = await env.COUNTERS.get(NAV_CARDS_KEY, 'json'); } catch (e) { raw = null; }
  const cards = (raw && Array.isArray(raw.cards))
    ? raw.cards.slice(0, MAX_CARDS).map(normalizeCard).filter(Boolean)
    : [];
  return json({
    ok: true,
    cards,
    updatedAt: (raw && raw.updatedAt) || null,
    count: cards.length,
    max: MAX_CARDS,
  });
}

async function saveCards(env, body) {
  if (!Array.isArray(body.cards)) return json({ ok: false, error: '缺少 cards 数组' }, 400);
  if (body.cards.length > MAX_CARDS) return json({ ok: false, error: '卡片数量超过上限 ' + MAX_CARDS }, 400);

  const cards = [];
  for (let i = 0; i < body.cards.length; i++) {
    const n = normalizeCard(body.cards[i], i);
    if (!n) return json({ ok: false, error: '第 ' + (i + 1) + ' 张卡片数据非法（缺少 name 或 href）' }, 400);
    cards.push(n);
  }

  const updatedAt = new Date().toISOString();
  await env.COUNTERS.put(NAV_CARDS_KEY, JSON.stringify({ version: 1, updatedAt, cards }));
  return json({ ok: true, cards, updatedAt, count: cards.length });
}

/* 生成卡片图标上传凭证（七牛，前缀 card/，与音乐 musicToken 同法） */
async function cardToken(env, body) {
  const { AK, SK, BUCKET } = qiniuEnv(env);
  const name = String(body.name || '').replace(/[^A-Za-z0-9_.\-]/g, '_').slice(-80) || 'icon.png';
  const key = CARD_QINIU_PREFIX + Date.now() + '_' + Math.floor(Math.random() * 10000) + '_' + name;

  const putPolicy = JSON.stringify({
    scope: BUCKET + ':' + key,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  });
  const encodedPutPolicy = btoa(putPolicy).replace(/\+/g, '-').replace(/\//g, '_');

  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SK),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(encodedPutPolicy));
  const signatureBase64 = b64url(new Uint8Array(sig));

  return json({
    ok: true,
    key,
    url: 'https://' + qiniuEnv(env).DOMAIN + '/' + key,
    token: AK + ':' + signatureBase64 + ':' + encodedPutPolicy,
    uploadUrl: 'https://upload-z2.qiniup.com',
  });
}

/* ================= 访问统计（KV: COUNTERS，key 前缀 visit:） ================= */

async function listVisits(env) {
  let list;
  try { list = await env.COUNTERS.list({ prefix: 'visit:', limit: 3000 }); }
  catch (e) { return json({ ok: true, visits: [], count: 0 }); }

  const keys = list.keys.map(k => k.name).sort().reverse(); // 新 → 旧（key 含毫秒时间戳）
  const visits = [];
  for (const name of keys.slice(0, 500)) {
    let item = null;
    try { item = await env.COUNTERS.get(name, 'json'); } catch (e) { item = null; }
    if (item && typeof item === 'object' && (item.site || item.ip || item.device)) {
      visits.push({ key: name, ...item });
    }
  }
  return json({ ok: true, visits, count: visits.length, total: keys.length });
}

async function clearVisits(env) {
  let list;
  try { list = await env.COUNTERS.list({ prefix: 'visit:', limit: 3000 }); }
  catch (e) { list = { keys: [] }; }
  await Promise.all(list.keys.map(k => env.COUNTERS.delete(k.name)));
  return json({ ok: true, deleted: list.keys.length });
}
