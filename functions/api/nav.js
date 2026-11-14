/* FunThing 导航页 · 卡片公开读取 API（Cloudflare Pages Functions）
   路由: GET /api/nav
   免密，供 index.html 访客端读取导航卡片（管理端写操作走 /api/admin 的 getCards/saveCards）
   数据来源: KV 绑定 COUNTERS，key nav_cards
   若未配置或为空，返回空数组，访客端回退到 index.html 内置硬编码卡片 */

const NAV_CARDS_KEY = 'nav_cards';
const MAX_CARDS = 200;
const CARD_CATS = ['game', 'tool', 'site'];
const CARD_COLORS = ['dance', 'trade', 'cloud', 'register', 'exam', 'login', 'ai'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=15',
    },
  });
}

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

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  try {
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
    });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err), cards: [] }, 500);
  }
}
