// Cloudflare Pages Functions - API 代理（Key 已内置）

const SENSENOVA_API_KEY = 'sk-rwaB5IGredfRs3fjf78GiZ4XmRuDdeK8';
const SENSENOVA_BASE = 'https://token.sensenova.cn/v1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

// ============ 模型列表 ============
export async function onRequestGet() {
  try {
    const upstream = await fetch(SENSENOVA_BASE + '/models', {
      headers: {
        'Authorization': 'Bearer ' + SENSENOVA_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return json({
        error: `上游返回 ${upstream.status}`,
        detail: errText.slice(0, 500)
      }, upstream.status);
    }

    const data = await upstream.json();

    // 只保留 chat 可用模型（过滤掉 embedding、image 等非对话模型）
    const models = (data.data || [])
      .map(m => m.id)
      .filter(id => {
        if (!id) return false;
        // 排除明显非对话模型
        if (/embed|image|u1\.5-lite|u1-fast/i.test(id)) return false;
        return true;
      })
      .sort();

    return json({ models });
  } catch (err) {
    return json({ error: '代理错误：' + err.message }, 500);
  }
}

// ============ 对话 ============
export async function onRequestPost(context) {
  const { request } = context;

  try {
    const body = await request.text();

    const upstream = await fetch(SENSENOVA_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SENSENOVA_API_KEY
      },
      body
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        ...CORS_HEADERS
      }
    });
  } catch (err) {
    return json({ error: '代理错误：' + err.message }, 500);
  }
}

// ============ OPTIONS 预检 ============
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}