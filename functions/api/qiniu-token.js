export async function onRequestPost(context) {
  const { env } = context;
  
  try {
    const AK = env.QINIU_AK;
    const SK = env.QINIU_SK;
    const BUCKET = env.QINIU_BUCKET;

    if (!AK || !SK || !BUCKET) {
      throw new Error('Cloudflare 环境变量未正确读取，请检查 AK/SK/BUCKET 是否拼写正确。');
    }

    // 构造上传策略
    const putPolicy = {
      scope: BUCKET,
      deadline: Math.floor(Date.now() / 1000) + 3600
    };

    // Base64 编码策略
    const encodedPutPolicy = btoa(JSON.stringify(putPolicy))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // HMAC-SHA1 签名
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(SK),
      { name: 'HMAC', hash: 'SHA-1' },
      false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPutPolicy));

    // 签名结果转 Base64
    const signatureArray = Array.from(new Uint8Array(signature));
    const signatureBase64 = btoa(String.fromCharCode(...signatureArray))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // 拼接最终的 Token
    const uploadToken = `${AK}:${signatureBase64}:${encodedPutPolicy}`;

    return new Response(JSON.stringify({ token: uploadToken }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    // 核心：如果出错，强制返回 JSON 格式的报错信息给前端
    return new Response(JSON.stringify({ error: '后端崩溃: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}