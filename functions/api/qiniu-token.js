export async function onRequestPost(context) {
  const { env } = context;
  
  try {
    const AK = env.QINIU_AK;
    const SK = env.QINIU_SK;
    const BUCKET = env.QINIU_BUCKET;

    if (!AK || !SK || !BUCKET) {
      throw new Error('环境变量未读取到');
    }

    const putPolicy = JSON.stringify({
      scope: BUCKET,
      deadline: Math.floor(Date.now() / 1000) + 3600
    });

    const encodedPutPolicy = btoa(putPolicy)
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

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}