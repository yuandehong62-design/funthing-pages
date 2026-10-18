export async function onRequestPost(context) {
  const { env } = context;
  
  const AK = env.QINIU_AK;
  const SK = env.QINIU_SK;
  const BUCKET = env.QINIU_BUCKET;

  if (!AK || !SK || !BUCKET) {
    return new Response(JSON.stringify({ error: '缺少 Cloudflare 环境变量配置' }), { status: 500 });
  }

  const putPolicy = {
    scope: BUCKET,
    deadline: Math.floor(Date.now() / 1000) + 3600
  };

  const encodedPutPolicy = btoa(JSON.stringify(putPolicy))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(SK),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPutPolicy));

  const signatureArray = Array.from(new Uint8Array(signature));
  const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const uploadToken = `${AK}:${signatureBase64}:${encodedPutPolicy}`;

  return new Response(JSON.stringify({ token: uploadToken }), {
    headers: { 'Content-Type': 'application/json' }
  });
}