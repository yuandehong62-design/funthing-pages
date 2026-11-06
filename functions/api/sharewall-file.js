// 通过同域代理提供七牛云文件下载/预览
// 避免七牛 HTTP 测试域名在 HTTPS 页面被浏览器拦截（混合内容问题）
const QINIU_DOMAIN = 'tn3b3bcgf.hn-bkt.clouddn.com';

export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const key = (url.searchParams.get('key') || '').trim();

  if (!key) {
    return new Response('缺少 key 参数', { status: 400 });
  }

  // 简单校验 key，防止异常字符
  if (!/^[\w.\-]+$/.test(key)) {
    return new Response('非法的 key', { status: 400 });
  }

  const domain = (env.QINIU_DOMAIN || QINIU_DOMAIN).replace(/\/+$/, '');
  const upstream = 'http://' + domain + '/' + key;

  try {
    const resp = await fetch(upstream);
    if (!resp.ok) {
      return new Response('文件不存在', { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', resp.headers.get('Content-Type') || 'application/octet-stream');
    headers.set('Content-Disposition', 'inline; filename="' + key + '"');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const cl = resp.headers.get('Content-Length');
    if (cl) headers.set('Content-Length', cl);

    return new Response(resp.body, { status: resp.status, headers });
  } catch (err) {
    return new Response('代理文件失败：' + err.message, { status: 502 });
  }
}
