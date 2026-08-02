# النشر على Netlify

## كيف يعمل النظام بعد النشر

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│      Netlify (CDN)      │         │          Firebase            │
│                         │  HTTPS  │                              │
│  index.html             │────────▶│  Authentication              │
│  dashboard.html         │         │  Firestore                   │
│  js/ · css/ · assets/   │         │  Realtime Database (الحضور)  │
│                         │         │  Cloud Functions (33 دالة)   │
│  ← الواجهة فقط          │         │  ← كل البيانات والمنطق       │
└─────────────────────────┘         └──────────────────────────────┘
```

Netlify يخدم **الملفات الثابتة فقط**. قاعدة البيانات والمصادقة والدوال تبقى على
Firebase، والمتصفح يتصل بها مباشرة — لذلك تعمل من أي نطاق بشرط تسجيله في
Firebase (الخطوة 3 أدناه).

> ⚠️ **Cloud Functions تتطلب خطة Blaze.** بدونها لن يعمل: تسجيل الدخول ·
> إنشاء الموظفين · تعديل الصلاحيات · الحذف · خزنة العملاء · اعتماد الطلبات ·
> الإشعارات. راجع القسم الأخير للبدائل.

---

## 1. تجهيز المستودع

```bash
cd "C:/Users/Dell/Desktop/Graphic Design/luma/programming"
git init
git add .
git commit -m "Luma Agency management system"
```

`.gitignore` يستبعد تلقائياً: `functions/node_modules` · `.env` ·
`.secret.local` · `emulator-data/` · `dist/` · ملفات حساب الخدمة.

ارفع المستودع إلى GitHub (مستودع **خاص**).

---

## 2. الربط مع Netlify

`app.netlify.com` ← **Add new site** ← **Import an existing project** ← اختر
المستودع.

الإعدادات تُقرأ تلقائياً من [`netlify.toml`](netlify.toml):

| الحقل | القيمة |
|---|---|
| Build command | `node build.js` |
| Publish directory | `dist` |
| Node version | 20 |

### لماذا خطوة بناء؟

`build.js` ينسخ ملفات المتصفح فقط إلى `dist/`. نشر المجلد كاملاً كان سيضع على
الإنترنت:

- `functions/` — كود الخادم ومنطق التشفير
- `functions/scripts/` — سكربتات إنشاء المدير
- `emulator-data/` — **نسخة حسابات المصادقة مع بصمات كلمات المرور**
- `.env` و `.secret.local`

السكربت يفشل عمداً لو وجد أي ملف يشبه الأسرار داخل `dist/`.

---

## 3. تسجيل نطاق Netlify في Firebase ⚠️ إلزامي

بدون هذه الخطوة سيفشل تسجيل الدخول برسالة `auth/unauthorized-domain`.

Firebase Console ← **Authentication** ← **Settings** ← **Authorized domains**
← **Add domain**، وأضف:

```
your-site-name.netlify.app
```

ولو ربطت نطاقاً خاصاً أضفه أيضاً.

---

## 4. متغيرات البيئة (اختياري)

Netlify ← **Site settings** ← **Environment variables**:

| المتغيّر | من أين تجلبه |
|---|---|
| `LUMA_APPCHECK_SITE_KEY` | Firebase ← App Check ← Web ← reCAPTCHA v3 |
| `LUMA_FCM_VAPID_KEY` | Firebase ← Project settings ← Cloud Messaging ← Web |

`build.js` يحقنهما في الصفحات وقت البناء. هذه **مفاتيح عامة** وليست أسراراً،
لكن وضعها في متغيرات البيئة يسمح لكل بيئة نشر بقيمها الخاصة.

بدونهما يعمل الموقع لكن App Check وإشعارات الويب تبقى معطّلة.

عند استخدام App Check أضف نطاق Netlify في إعدادات reCAPTCHA أيضاً.

---

## 5. نشر الخادم على Firebase

Netlify لا يشغّل Cloud Functions، فتُنشر على Firebase من جهازك:

```bash
firebase login && firebase use luma-web-d3550
```

```bash
firebase deploy --only firestore:rules,firestore:indexes,database,functions
```

> `hosting` غير مطلوب — Netlify يتولى الواجهة.

---

## 6. إنشاء حساب المدير

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
$env:LUMA_ADMIN_TEMP_PASSWORD="<كلمة مرور مؤقتة>"
node functions\scripts\seed-admin.js
```

ثم احذف ملف حساب الخدمة وامسح متغيرات البيئة.

---

## 7. الاختبار

- [ ] الموقع يفتح على `https://your-site.netlify.app`
- [ ] تسجيل الدخول بـ `admin` يعمل (يثبت أن الدوال والنطاق مضبوطان)
- [ ] لوحة التحكم تعرض بيانات حقيقية
- [ ] وحدة تحكم المتصفح خالية من الأخطاء
- [ ] الخط العربي DIN محمّل
- [ ] لا يوجد `/functions` أو `/emulator-data` على الموقع — جرّب فتحهما، يجب أن تحصل على 404

---

## البناء محلياً قبل الرفع

```bash
node build.js
```

ثم افتح `dist/` للتأكد من محتوياتها. للمعاينة:

```bash
npx serve dist
```

---

## بدائل إن لم ترغب بتفعيل Blaze

| الخيار | النتيجة |
|---|---|
| **تفعيل Blaze** (موصى به) | كل شيء يعمل. الحد المجاني 2 مليون استدعاء شهرياً — فريق من 9 أشخاص لن يقترب منه، والتكلفة الفعلية صفر. يحتاج بطاقة فقط للتحقق. |
| **إعادة بناء بدون دوال** | نقل الصلاحيات إلى قواعد الأمان وإنشاء الحسابات من المتصفح. عمل كبير، وخزنة بيانات العملاء تتعطل نهائياً لأن مفتاح التشفير لا يمكن أن يوجد في المتصفح. |
| **البقاء على التشغيل المحلي** | `start-luma.cmd` — يعمل بالكامل بلا تكلفة، لكن على جهازك فقط. |

---

## استكشاف الأخطاء

| العرض | السبب | الحل |
|---|---|---|
| `auth/unauthorized-domain` | النطاق غير مسجّل | الخطوة 3 |
| `functions/not-found` عند الدخول | الدوال غير منشورة | الخطوة 5 |
| `permission-denied` في كل مكان | القواعد غير منشورة | الخطوة 5 |
| صفحة بيضاء | فشل البناء | راجع Deploy log في Netlify |
| الخط لا يظهر | `assets/` لم يُنسخ | شغّل `node build.js` محلياً وتحقق من `dist/assets/fonts` |
| `The query requires an index` | الفهارس غير منشورة | `firebase deploy --only firestore:indexes` |
