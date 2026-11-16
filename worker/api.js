let active = 0;
const json = (status, data) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function callGemini(endpoint, payload, env) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${endpoint}`, {
    method: 'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(300000),
  });
  const data = await response.json();
  if (!response.ok) {
    const messages = {
      400: 'Gemini 요청 또는 API 키 설정을 확인해 주세요.',
      401: 'Gemini API 키가 유효하지 않습니다. 운영자가 GEMINI_API_KEY를 확인해 주세요.',
      403: 'Gemini 모델 접근 권한이 없습니다. 운영자가 API 키와 모델 권한을 확인해 주세요.',
      404: 'Gemini 모델을 사용할 수 없습니다. 운영자가 모델 설정을 확인해 주세요.',
      429: 'Gemini 사용 한도 또는 요청 제한에 도달했습니다. 잠시 후 다시 시도해 주세요.',
    };
    const error = new Error(messages[response.status] || 'Gemini에서 사진을 처리하지 못했습니다. 다시 시도해 주세요.');
    error.publicMessage = true;
    throw error;
  }
  return data;
}

export async function handleStyle(request, env) {

    if (request.headers.get('origin') && new URL(request.headers.get('origin')).host !== new URL(request.url).host && request.headers.get('origin') !== env.PAGES_ORIGIN) return json(403, { error: '허용되지 않은 요청입니다.' });
    if (!env.GEMINI_API_KEY) return json(503, { error: '아직 AI 생성 서비스가 연결되지 않았어요. 운영자가 서버에 GEMINI_API_KEY를 설정하면 사용할 수 있습니다.' });
    if (active >= 2) return json(429, { error: '현재 다른 사진을 생성 중입니다. 잠시 후 다시 시도해 주세요.' });
    active++;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request.body || []) { size += chunk.length; if (size > 8 * 1024 * 1024) { return json(413, { error: '사진이 너무 큽니다. 더 작은 사진을 선택해 주세요.' }); } chunks.push(chunk); }
      let body; try { body = JSON.parse(await new Blob(chunks).text()); } catch { return json(400, { error: '잘못된 요청입니다.' }); }
      if (body.consent !== true || typeof body.image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image)) return json(400, { error: '사진과 AI 전송 동의를 확인해 주세요.' });
      const reference = { mimeType: 'image/jpeg', data: body.image.split(',')[1] };
      const analysis = await callGemini(`models/${env.GEMINI_VISION_MODEL || 'gemini-2.5-flash'}:generateContent`, {
        contents: [{ role: 'user', parts: [{ text: 'You are a hairstylist. Only discuss visible hair, face proportions, and styling, never identity or sensitive traits. If the image is not a clear single human portrait, set valid=false, styles=[], best=0. Otherwise propose exactly 8 distinct realistic hairstyles suitable for the person, avoiding gender assumptions. Write names and reasons in Korean. Each reason explains styling balance and maintenance. The recommendation is subjective. best is a zero-based index. edit is a concise English image-edit instruction for the hairstyle.' }, { inlineData: reference }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: {
          type: 'OBJECT', properties: { valid: { type: 'BOOLEAN' }, best: { type: 'INTEGER' }, styles: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, reason: { type: 'STRING' }, edit: { type: 'STRING' } }, required: ['name', 'reason', 'edit'] } } }, required: ['valid', 'best', 'styles'],
        } },
      }, env);
      const plan = JSON.parse(analysis.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') || '{}');
      if (!plan.valid || !Array.isArray(plan.styles) || plan.styles.length !== 8 || !plan.styles.every(s => s && ['name', 'reason', 'edit'].every(k => typeof s[k] === 'string' && s[k].trim())) || !Number.isInteger(plan.best) || plan.best < 0 || plan.best > 7) return json(422, { error: '얼굴과 머리가 잘 보이는 한 사람의 정면 사진을 선택해 주세요.' });
      const prompt = `Create a photorealistic square contact sheet in an EXACT edge-to-edge 3 by 3 grid of equal square cells. No borders, gaps, text, numbers, labels or watermarks. Every cell shows the SAME person from the reference, preserving facial identity, skin tone, clothes, pose and background. Change ONLY the hair. Center cell: unchanged original hairstyle. Around it, in row-major order skipping center, apply these 8 styles: ${plan.styles.map((s, i) => `${i + 1}: ${s.edit}`).join('; ')}. Keep the full hairstyle visible in each square. Each cell must align exactly on thirds of the full image.`;
      const generated = await callGemini('interactions', {
        model: env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1', store: false,
        input: [{ type: 'text', text: prompt }, { type: 'image', mime_type: reference.mimeType, data: reference.data }],
        response_format: { type: 'image', aspect_ratio: '1:1', image_size: '2K' },
      }, env);
      const image = generated.output_image || generated.steps?.filter(s => s.type === 'model_output').flatMap(s => s.content || []).find(p => p.type === 'image' && p.data);
      if (!image?.data || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime_type)) throw new Error('이미지를 생성하지 못했습니다.');
      return json(200, { image: `data:${image.mime_type};base64,${image.data}`, best: plan.best, styles: plan.styles.map(({ name, reason }) => ({ name, reason })) });
    } catch (error) { return json(502, { error: error.publicMessage ? error.message : error.name === 'TimeoutError' ? '이미지 생성 시간이 초과됐습니다. 다시 시도해 주세요.' : error.message === 'fetch failed' ? 'AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '스타일을 생성하지 못했습니다. 사진 또는 서버 API 설정을 확인하고 다시 시도해 주세요.' }); }
    finally { active--; }
}
