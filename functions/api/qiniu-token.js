export async function onRequestPost(context) {
  const { env } = context;

  try {
    const AK = env.QINIU_AK ? env.QINIU_AK.trim() : '';
    const SK = env.QINIU_SK ? env.QINIU_SK.trim() : '';
    const BUCKET = env.QINIU_BUCKET ? env.QINIU_BUCKET.trim() : '';

    if (!AK || !SK || !BUCKET) {
      return new Response(JSON.stringify({ error: '服务端环境变量未正确配置' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. 构造上传策略，确保是紧凑格式的 JSON 字符串
    const putPolicy = JSON.stringify({
      scope: BUCKET,
      deadline: Math.floor(Date.now() / 1000) + 3600
    });

    // 2. 对 JSON 进行 URL 安全的 Base64 编码（保留末尾等号）
    const encodedPutPolicy = btoa(putPolicy)
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    // 3. 使用 SK 进行 HMAC-SHA1 签名
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(SK),
      { name: 'HMAC', hash: 'SHA-1' },
      false, ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPutPolicy));

    // 4. 将签名结果转为 URL 安全的 Base64 字符串
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    // 5. 拼接最终的 UploadToken
    const uploadToken = `${AK}:${signatureBase64}:${encodedPutPolicy}`;

    return new Response(JSON.stringify({ token: uploadToken }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}