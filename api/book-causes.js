// Vercel Serverless Function
// Route: POST /api/book-causes
//
// مرض کی وجوہات صرف سائٹ کی کتابوں (PDF) سے: براؤزر کتابوں میں سے وہ صفحات ڈھونڈ کر جن پر اس مرض کے
// اسباب/وجوہات لکھے ہیں، ان صفحات کی اصل تصویریں یہاں بھیجتا ہے۔ AI صرف وہی وجوہات لکھتا ہے جو ان
// صفحات پر چھپی ہوئی ہیں — اپنی طرف سے کوئی وجہ نہیں۔ ہر وجہ کے ساتھ بتاتا ہے کہ کس صفحے (src) سے لی۔
// درخواست: { disease, pages:[{ book, page, image:"data:image/jpeg;base64,..." }] }  (زیادہ سے زیادہ 4 صفحات)
// جواب: { found, organ, causes:[{ cause, detail, src }], effects:[...] }
//
// اہم: OPENAI_API_KEY صرف Vercel کے Environment Variables میں — کبھی براؤزر کوڈ میں نہیں۔
// تصویر پڑھنے کا ماڈل بدلنا ہو تو Vercel میں OPENAI_VISION_MODEL سیٹ کریں (پہلے سے gpt-4o)۔

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };

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
    const disease = String(body.disease || '').trim().slice(0, 300);
    const pages = (Array.isArray(body.pages) ? body.pages : []).slice(0, 4)
      .map(p => ({ book: String(p.book || '').slice(0, 100), page: String(p.page || '').slice(0, 10), image: String(p.image || '') }))
      .filter(p => /^data:image\/(jpeg|png|webp);base64,/.test(p.image));
    if (!disease || !pages.length) return res.status(400).json({ error: 'مرض یا کتاب کے صفحات موجود نہیں۔' });

    const system = `آپ اردو (نستعلیق، ہاتھ کی لکھائی سمیت) طبی کتابوں کے صفحات پڑھنے کے ماہر ہیں۔ یہ طبی ویب سائٹ ہے؛ پوشیدہ اعضاء کے نام عام طبی الفاظ ہیں۔
آپ کو ایک مرض کا نام اور کتابوں کے چند صفحات کی تصویریں دی جائیں گی (ہر تصویر کا نمبر src ہے)۔
کام: ان صفحات پر اس مرض کے جو اسباب/وجوہات/سبب (اور قانون مفرد اعضاء کے مطابق متاثرہ عضو/تحریک) لکھے ہیں، صرف وہی نکالیں۔
سخت اصول:
1) صرف وہی وجہ لکھیں جو صفحے پر واقعی لکھی ہوئی ہے — اپنی معلومات سے کوئی وجہ ہرگز شامل نہ کریں۔ اندازہ نہ لگائیں۔
2) وجہ اسی مرض (یا اس کے واضح دوسرے نام) کی ہو — صفحے پر کسی دوسرے مرض کی وجوہات ہوں تو وہ نہ لیں۔
3) ہر وجہ: {"cause":"مختصر وجہ (1 سے 6 الفاظ، کتاب کے الفاظ کے قریب — مثلاً شوگر، تیزابیت)","detail":"کتاب میں اس کی جو وضاحت ہے اس کا ایک مختصر جملہ","question":"مریض سے پوچھنے کا ایک سادہ ہاں/نہیں سوال جس سے پتا چلے کہ یہی وجہ ہے (مثلاً: کیا مریض کو شوگر ہے؟، کیا معدے میں تیزابیت/جلن رہتی ہے؟)","effects":["اسی ایک وجہ کو دور کرنے کے لیے دوا/جڑی بوٹی کے فوائد میں لکھے جانے والے 2 سے 6 الفاظ (مثلاً شوگر، تیزابیت، معدے کی جلن)"],"tehreek":"اگر کتاب میں اس وجہ کی تحریک/مزاج لکھا ہو (مثلاً غدی عضلاتی) ورنہ خالی","src":تصویر کا نمبر}۔ زیادہ سے زیادہ 4۔ ترتیب لازمی: سب سے طاقتور/سنگین بنیادی بیماری والی وجہ پہلے (مثلاً شوگر، بلڈ پریشر، گردے/جگر کی بیماری، دل کی بیماری)، اور سب سے عام/ہلکی وجہ (مثلاً تیزابیت، گرمی، کمزوری) سب سے آخر میں — کیونکہ سائٹ پہلی وجوہات کے بارے میں مریض سے پوچھے گی اور سب کا جواب "نہیں" ہو تو آخری وجہ خود بخود مان لے گی۔ ملتی جلتی وجوہات کو ایک ہی وجہ میں ملا دیں تاکہ مریض سے کم سے کم سوال پوچھنے پڑیں۔
4) "organ": اگر کتاب میں متاثرہ عضو/تحریک لکھی ہو تو وہ، ورنہ خالی۔
5) "effects": 4 سے 12 مختصر اردو الفاظ جو انہی کتابی وجوہات کو دور کرنے کے لیے دوا/جڑی بوٹی کے فوائد میں لکھے ہوتے ہیں (مثلاً وجہ "جگر کی گرمی" ہو تو "جگر کی گرمی"، "صفرا")۔ صرف انہی وجوہات سے، نئی چیز نہیں۔
6) اگر ان صفحات پر اس مرض کی کوئی وجہ نہ لکھی ہو تو found=false اور causes خالی۔
صرف JSON: {"found":true,"organ":"...","causes":[{"cause":"...","detail":"...","question":"...","effects":["..."],"tehreek":"","src":1}],"effects":["..."]}`;

    const content = [{ type: 'text', text: `مرض: "${disease}"\nصفحات:` }];
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
    let out = {};
    try { out = JSON.parse(txt || '{}'); } catch (e) { out = {}; }
    const causes = (Array.isArray(out.causes) ? out.causes : []).map(c => ({
      cause: String((c && c.cause) || '').trim().slice(0, 90),
      detail: String((c && c.detail) || '').trim().slice(0, 240),
      question: String((c && c.question) || '').trim().slice(0, 160),
      effects: (Array.isArray(c && c.effects) ? c.effects : []).map(x => String(x || '').trim()).filter(x => x && x.length <= 30).slice(0, 6),
      tehreek: String((c && c.tehreek) || '').trim().slice(0, 40),
      src: Math.max(1, Math.min(pages.length, parseInt(c && c.src, 10) || 1))
    })).filter(c => c.cause).slice(0, 4);
    causes.forEach(c => { if (!c.question) c.question = `کیا مریض کو ${c.cause} ہے؟`; if (!c.effects.length) c.effects = [c.cause]; });
    const effects = (Array.isArray(out.effects) ? out.effects : []).map(x => String(x || '').trim()).filter(x => x && x.length <= 30).slice(0, 12);
    return res.status(200).json({ found: causes.length > 0, organ: String(out.organ || '').trim().slice(0, 40), causes, effects });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
