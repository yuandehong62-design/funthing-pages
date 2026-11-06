// 列出七牛云桶内所有已上传文件（供"所有人可见"的投稿墙展示）
export async function onRequestGet(context) {
  const { env } = context;
  const AK = (env.QINIU_AK || '').trim();
  const SK = (env.QINIU_SK || '').trim();
  const BUCKET = (env.QINIU_BUCKET || '').trim();

  if (!AK || !SK || !BUCKET) {
    return new Response(JSON.stringify({ error: '服务端环境变量未正确配置' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const allItems = [];
    let marker = '';

    // 分页拉取（每页最多 1000 个，最多循环 100 次）
    for (let i = 0; i < 100; i++) {
      let path = '/list?bucket=' + encodeURIComponent(BUCKET) + '&limit=1000';
      if (marker) path += '&marker=' + encodeURIComponent(marker);

      const auth = await qiniuManagementAuth(AK, SK, 'GET', path, 'rsf.qbox.me');
      const resp = await fetch('https://rsf.qbox.me' + path, {
        headers: { Authorization: auth }
      });

      if (!resp.ok) {
        return new Response(JSON.stringify({ error: '七牛列举失败 HTTP ' + resp.status }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const data = await resp.json();
      if (data.items) allItems.push(...data.items);
      if (!data.marker) break;
      marker = data.marker;
    }

    // 转成前端需要的精简结构，按上传时间倒序（新 → 旧）
    const items = allItems
      .map(f => ({
        key: f.key,
        size: f.fsize || 0,
        mimeType: f.mimeType || '',
        putTime: f.putTime || 0
      }))
      .sort((a, b) => b.putTime - a.putTime);

    return new Response(JSON.stringify({ items }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 生成七牛管理凭证（Qiniu <AK>:<urlsafe-base64(HMAC-SHA1)>）
async function qiniuManagementAuth(AK, SK, method, pathAndQuery, host) {
  const signingStr = method + ' ' + pathAndQuery + '\nHost: ' + host + '\n\n';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SK),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(signingStr));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return 'Qiniu ' + AK + ':' + sigB64;
}
