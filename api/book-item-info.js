// Vercel Serverless Function
// Route: POST /api/book-item-info
//
// "نسخہ / دوا کی مکمل تفصیل": کسی جڑی بوٹی، کشتے یا مرکب نسخے کا نام — براؤزر کتابوں (PDF) میں سے وہ صفحات
// ڈھونڈ کر جن پر اس کا ذکر ہے، ان کی اصل تصویریں یہاں بھیجتا ہے۔ AI صرف انہی صفحات سے مزاج، درجہ، خوراک،
// فوائد، اجزاء، طریقہ تیاری/استعمال اور احتیاط نکالتا ہے — اپنی طرف سے کچھ نہیں۔
// درخواست: { name, isKushta, knownMizaj, pages:[{ book, page, image }] }  (زیادہ سے زیادہ 4 صفحات)
// جواب: { found, type, mizaj, darja, dose, benefits[], ingredients[{name,amount}], method, usage, cautions, other, used[] }
//
// اہم: OPENAI_API_KEY صرف Vercel کے Environment Variables میں — کبھی براؤزر کوڈ میں نہیں۔

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } }, maxDuration: 60 };
export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'صرف POST request قبول ہے۔' });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'سرور پر OPENAI_API_KEY سیٹ نہیں ہے۔' });

  try {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 120);
    const knownMizaj = String(body.knownMizaj || '').trim().slice(0, 60);
    const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : []).slice(0, 12)
      .map(x => ({ name: String((x && x.name) || '').slice(0, 50), amount: String((x && x.amount) || '').slice(0, 30), known: String((x && x.known) || '').slice(0, 80) }))
      .filter(x => x.name);
    const pages = (Array.isArray(body.pages) ? body.pages : []).slice(0, 4)
      .map(p => ({ book: String(p.book || '').slice(0, 100), page: String(p.page || '').slice(0, 10), image: String(p.image || '') }))
      .filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(p.image));
    if (!name || !pages.length) return res.status(400).json({ error: 'نام یا کتاب کے صفحات موجود نہیں۔' });
    const composite = ingredients.length > 1;

    const system = `آپ اردو (نستعلیق، ہاتھ کی لکھائی سمیت) طبی کتابوں (قانون مفرد اعضاء، طب یونانی، کشتہ جات) کے صفحات پڑھنے کے ماہر ہیں۔
آپ کو ایک دوا/جڑی بوٹی/کشتہ/مرکب نسخے کا نام اور کتابوں کے چند صفحات کی تصویریں (نمبر 1، 2، ...) دی جائیں گی۔
کام: صرف انہی صفحات پر اس چیز کے بارے میں جو لکھا ہے وہ نکالیں:
- "type": "herb" (مفرد بوٹی/دوا)، "kushta" (کشتہ) یا "nuskha" (مرکب نسخہ)
- "mizaj": مزاج/تحریک جیسا کتاب میں لکھا ہے (مثلاً عضلاتی اعصابی، گرم خشک)
- "darja": درجہ (اگر لکھا ہو)
- "dose": مقدار خوراک اور کب/کیسے کھانی ہے
- "benefits": فوائد/افعال و اثرات — ہر ایک مختصر (زیادہ سے زیادہ 15)
- "ingredients": مرکب نسخہ یا کشتے کے اجزاء [{"name":"...","amount":"..."}] (اگر لکھے ہوں)
- "method": ترکیب تیاری (مختصر، کتاب کے مطابق)
- "usage": طریقہ استعمال / بدرقہ / انوپان
- "cautions": احتیاط، نقصان، مصلح
- "other": کوئی اور اہم بات (متبادل نام، پہچان وغیرہ)
- "used": جن تصویروں سے معلومات لی ان کے نمبر
سخت اصول: صرف وہی لکھیں جو صفحات پر واقعی اسی چیز کے بارے میں لکھا ہے — اپنی معلومات سے کچھ نہ جوڑیں، اندازہ نہ لگائیں۔ جو چیز صفحات پر نہیں وہ خالی ("" یا []) چھوڑ دیں۔ کسی دوسری دوا کی معلومات اس میں نہ ملائیں۔
${knownMizaj ? `اس کا مزاج سائٹ کے مالک (حکیم صاحب) کی فہرست کے مطابق پہلے سے طے ہے: "${knownMizaj}" — "mizaj" میں یہی لکھیں، اس کے خلاف نہ لکھیں۔` : ''}
اگر صفحات پر اس چیز کا ذکر ہی نہ ہو تو found=false۔
صرف JSON: {"found":true,"type":"herb","mizaj":"","darja":"","dose":"","benefits":[],"ingredients":[],"method":"","usage":"","cautions":"","other":"","used":[1]}`
    + (composite ? `

یہ ایک مرکب نسخہ ہے جس کے اجزاء صارف نے خود لکھے ہیں (ساتھ سائٹ کی فہرست سے ہر جزو کا معلوم مزاج)۔ اس صورت میں:
- "parts": ہر جزو کے لیے {"name":"...","mizaj":"","darja":"","benefits":["..."],"src":تصویر نمبر} — صرف صفحات سے؛ صفحے پر نہ ملے تو سائٹ والا معلوم مزاج رکھیں اور benefits خالی۔
- "type" = "nuskha"؛ "mizaj" = اجزاء کے مزاج اور مقدار کو دیکھ کر پورے نسخے کا غالب مزاج/تحریک (قانون مفرد اعضاء کے مطابق)؛ "benefits" = اجزاء کے کتابی فوائد کو ملا کر پورے نسخے کے فوائد؛ "dose" = اگر صفحات پر اجزاء کی خوراک لکھی ہو تو اس سے مناسب خوراک، ورنہ خالی۔
JSON میں "parts" بھی شامل کریں۔` : '');

    const content = [{ type: 'text', text: `نام: "${name}"${body.isKushta ? ' (کشتہ)' : ''}` +
      (composite ? `\nاجزاء: ${ingredients.map(x => x.name + (x.amount ? ' ' + x.amount : '') + (x.known ? ' [سائٹ: ' + x.known + ']' : '')).join('، ')}` : '') + `\nصفحات:` }];
    pages.forEach((p, i) => {
      content.push({ type: 'text', text: `تصویر ${i + 1}: کتاب "${p.book}" — صفحہ ${p.page}` });
      content.push({ type: 'image_url', image_url: { url: p.image, detail: 'high' } });
    });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) return res.status(502).json({ error: 'OpenAI API سے جواب نہیں ملا۔', details: (await r.text().catch(() => '')).slice(0, 300) });
    const data = await r.json();
    const txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    let o = {};
    try { o = JSON.parse(txt || '{}'); } catch (e) { o = {}; }
    const str = (v, n) => String(v || '').trim().slice(0, n);
    const arr = (v, n, len) => (Array.isArray(v) ? v : []).map(x => String(x || '').trim()).filter(x => x && x.length <= len).slice(0, n);
    const out = {
      found: !!o.found,
      type: ['herb', 'kushta', 'nuskha'].includes(o.type) ? o.type : '',
      mizaj: knownMizaj || str(o.mizaj, 80),
      darja: str(o.darja, 60),
      dose: str(o.dose, 300),
      benefits: arr(o.benefits, 15, 120),
      ingredients: (Array.isArray(o.ingredients) ? o.ingredients : []).map(x => ({ name: str(x && x.name, 60), amount: str(x && x.amount, 40) })).filter(x => x.name).slice(0, 25),
      method: str(o.method, 600),
      usage: str(o.usage, 300),
      cautions: str(o.cautions, 300),
      other: str(o.other, 300),
      used: (Array.isArray(o.used) ? o.used : []).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= pages.length),
      parts: (Array.isArray(o.parts) ? o.parts : []).map(x => ({ name: str(x && x.name, 50), mizaj: str(x && x.mizaj, 60), darja: str(x && x.darja, 40), benefits: arr(x && x.benefits, 10, 80), src: parseInt(x && x.src, 10) || 0 })).filter(x => x.name).slice(0, 12)
    };
    if (composite && (out.parts.length || out.mizaj)) out.found = true;
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
