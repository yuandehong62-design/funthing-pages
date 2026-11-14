/* FunThing 访问统计 API（Cloudflare Pages Functions）
   路由: POST /api/visit
   用途: 三个网站（funthing.me 导航页 / guntaodance.cc.cd 棍涛舞团 / zhfld.dpdns.org 国际卤蛋）
         在页面加载时上报一次访问，记录 时间 / IP / 设备型号 / 来源。
   免密（只写不读），IP 由 Cloudflare 请求头 CF-Connecting-IP 服务端采集。
   数据存 KV 绑定 COUNTERS，key 前缀 visit:，后台 /admin → 📊 访问统计 查看。

   客户端 POST body: { "site":"guntaodance.cc.cd", "device":"iPhone iOS 26.2",
                       "path":"/", "referer":"" } （均可选） */

const MAX_VISITS = 2000; // 服务器最多保留的访问记录条数
const VISIT_KEY_RE = /^visit:\d+:[a-z0-9]+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

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

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const site = String(body.site || '').trim().slice(0, 80) || 'unknown';
  const device = String(body.device || '').trim().slice(0, 120) || '未知设备';
  const path = String(body.path || '').trim().slice(0, 300);
  const referer = String(body.referer || '').trim().slice(0, 300);
  const ua = String(request.headers.get('User-Agent') || '').slice(0, 400);
  const ip = String(
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('X-Forwarded-For') ||
    ''
  ).split(',')[0].trim().slice(0, 45);

  const visit = {
    site, device, ip, path, referer, ua,
    time: new Date().toISOString(),
  };
  const key = 'visit:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);

  try {
    await env.COUNTERS.put(key, JSON.stringify(visit));

    // 超出上限时裁剪最旧的记录
    const all = await env.COUNTERS.list({ prefix: 'visit:', limit: 3000 });
    if (all.keys.length > MAX_VISITS) {
      const sorted = all.keys.map(k => k.name).sort(); // 旧 → 新
      const toDelete = sorted.slice(0, all.keys.length - MAX_VISITS);
      await Promise.all(toDelete.map(n => env.COUNTERS.delete(n)));
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

/* 供 admin.js 复用（导出具名函数，避免重复实现） */
export { VISIT_KEY_RE, MAX_VISITS };
