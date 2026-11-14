/* FunThing 导航页 · ShareMore 匿名留言 API（Cloudflare Pages Functions）
   路由: GET /api/messages   获取留言（新 → 旧）
         POST /api/messages  提交留言，JSON: { "name": "昵称(可空)", "text": "内容" }
   KV 绑定: MESSAGES（与 admin.js 留言管理共用同一命名空间，
             key 形如 msg:<毫秒时间戳>:<随机串>，后台可统一改名/删除）
   说明: 无需记名 —— 昵称可留空，默认"匿名"；留言全网公开可见。 */

const MAX_MESSAGES = 100; // 服务器最多保留的留言条数

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const list = await env.MESSAGES.list({ limit: 600 });
    const keys = list.keys.map(k => k.name).sort().reverse(); // 新 → 旧
    const messages = [];
    for (const name of keys.slice(0, MAX_MESSAGES)) {
      const item = await env.MESSAGES.get(name, 'json');
      if (item && typeof item === 'object' && item.text) messages.push(item);
    }
    return json({ ok: true, messages });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ ok: false, error: 'bad request' }, 400);
  }

  const name = String(body.name || '').trim().slice(0, 16) || '匿名';
  const text = String(body.text || '').trim().slice(0, 200);
  if (!text) return json({ ok: false, error: 'empty message' }, 400);

  const message = { name, text, time: new Date().toISOString() };
  const key = 'msg:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);

  try {
    await env.MESSAGES.put(key, JSON.stringify(message));

    // 超出上限时裁剪最旧的留言
    const all = await env.MESSAGES.list({ limit: 600 });
    if (all.keys.length > MAX_MESSAGES) {
      const sorted = all.keys.map(k => k.name).sort(); // 旧 → 新
      const toDelete = sorted.slice(0, all.keys.length - MAX_MESSAGES);
      await Promise.all(toDelete.map(n => env.MESSAGES.delete(n)));
    }
    return json({ ok: true, message });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}
