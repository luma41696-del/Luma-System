# دليل النشر · Deployment Guide

خطوات نشر نظام إدارة لوما على مشروع `luma-web-d3550` من الصفر.

---

## 0. قبل البدء

- [ ] Node.js 20+ مثبّت (`node -v`)
- [ ] `npm install -g firebase-tools`
- [ ] `firebase login`
- [ ] المشروع على خطة **Blaze** (مطلوبة لـ Cloud Functions v2)
- [ ] صلاحية Owner أو Editor على مشروع Firebase

```bash
cd "C:/Users/Dell/Desktop/Graphic Design/luma/programming"
firebase use luma-web-d3550
```

---

## 1. تفعيل الخدمات (Firebase Console)

### 1.1 Authentication
`Build → Authentication → Get started → Sign-in method`
فعّل **Email/Password**. لا تفعّل «Email link» ولا التسجيل الذاتي — الحسابات
تُنشأ من الإدارة فقط.

### 1.2 Firestore
`Build → Firestore Database → Create database`
- الوضع: **Production mode**
- المنطقة: `eur3 (europe-west)` — نفس منطقة الدوال

### 1.3 Realtime Database
`Build → Realtime Database → Create database`
- الوضع: **Locked mode**
- تأكد أن الرابط يطابق `databaseURL` في `js/firebase-config.js`

### 1.4 Storage
`Build → Storage → Get started` — الوضع Production.

### 1.5 App Check
`Build → App Check → Apps → أضف تطبيق الويب → reCAPTCHA v3`
انسخ **site key**.

للتطوير المحلي: `App Check → Apps → ⋮ → Manage debug tokens`، ثم في الطرفية:

```js
// في وحدة تحكم المتصفح قبل تحميل الصفحة
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
```

انسخ الرمز الذي يظهر في الـ console وسجّله في الـ Console.

### 1.6 Cloud Messaging (اختياري)
`Project settings → Cloud Messaging → Web configuration → Generate key pair`
انسخ **VAPID key**.

---

## 2. الأسرار

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
firebase functions:secrets:set VAULT_ENCRYPTION_KEY
```

للتأكد لاحقاً:

```bash
firebase functions:secrets:access VAULT_ENCRYPTION_KEY
```

> احتفظ بنسخة احتياطية من المفتاح في مدير كلمات مرور المؤسسة.
> فقدانه = فقدان كل بيانات الخزنة نهائياً.

---

## 3. المفاتيح العامة في الواجهة

عدّل `index.html` و `dashboard.html` وأضف قبل وسم `<script type="module">`:

```html
<script>
  window.__LUMA_APPCHECK_SITE_KEY__ = "6Lxxxxxxxxxxxxxxxxxxxx";
  window.__LUMA_FCM_VAPID_KEY__     = "BLxxxxxxxxxxxxxxxxxxxx";
</script>
```

هذه مفاتيح عامة بطبيعتها ولا تُعتبر أسراراً.

---

## 4. تثبيت اعتماديات الدوال

```bash
cd functions
npm install
cd ..
```

---

## 5. النشر

### 5.1 القواعد والفهارس أولاً

```bash
firebase deploy --only firestore:rules,firestore:indexes,database,storage
```

بناء الفهارس المركّبة قد يستغرق عدة دقائق. تابع التقدم من
`Firestore → Indexes`. **لا تنشر الواجهة قبل اكتمالها** وإلا ستفشل بعض
الاستعلامات مؤقتاً.

### 5.2 الدوال

```bash
firebase deploy --only functions
```

عند أول نشر ستُطلب موافقات على تفعيل واجهات برمجية
(Cloud Build, Artifact Registry, Eventarc, Cloud Scheduler) — وافق عليها.

تحقق:

```bash
firebase functions:list
```

يجب أن تظهر 24 دالة في `europe-west1`.

### 5.3 الاستضافة

```bash
firebase deploy --only hosting
```

الرابط: `https://luma-web-d3550.web.app`

---

## 6. الحساب الإداري الأول

```powershell
# PowerShell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\service-account.json"
$env:LUMA_ADMIN_TEMP_PASSWORD       = "<كلمة المرور المؤقتة>"
cd functions
node scripts/seed-admin.js
```

```bash
# bash
export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
export LUMA_ADMIN_TEMP_PASSWORD='<كلمة المرور المؤقتة>'
node functions/scripts/seed-admin.js
```

بعد نجاح السكربت:

1. سجّل الدخول بـ `admin` وكلمة المرور المؤقتة
2. سيفرض النظام تغيير كلمة المرور فوراً
3. **احذف** ملف حساب الخدمة من الجهاز
4. امسح متغيّرات البيئة:
   ```powershell
   Remove-Item Env:LUMA_ADMIN_TEMP_PASSWORD
   Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS
   ```

---

## 7. البيانات التجريبية (بيئة الاختبار فقط)

```powershell
$env:LUMA_DEMO_PASSWORD = "<كلمة مرور مؤقتة>"
node functions/scripts/seed-demo.js
```

للحذف وإعادة الإنشاء: `node functions/scripts/seed-demo.js --reset`

> لا تشغّل هذا السكربت على بيئة الإنتاج الحقيقية.

---

## 8. امتداد البريد (اختياري)

```bash
firebase ext:install firebase/firestore-send-email
```

| الإعداد | القيمة |
|---|---|
| Email documents collection | `mail` |
| SMTP connection URI | `smtps://user:pass@smtp.example.com:465` |
| Default FROM address | `no-reply@lumaagency.jo` |

بدونه تبقى رسائل استعادة كلمة المرور في مجموعة `mail` دون إرسال.

---

## 9. التشغيل المحلي

```bash
firebase emulators:start
```

| الخدمة | المنفذ |
|---|---|
| Hosting | 5000 |
| Firestore | 8080 |
| Auth | 9099 |
| Functions | 5001 |
| Realtime DB | 9000 |
| Storage | 9199 |
| Emulator UI | 4000 |

افتح `http://localhost:5000/index.html?emulator=1` — بدون `?emulator=1`
سيتصل المتصفح بمشروع الإنتاج حتى وأنت على localhost.

لتشغيل السكربتات على المحاكي:

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
node functions/scripts/seed-admin.js
```

---

## 10. استكشاف الأخطاء

| العرض | السبب المحتمل | الحل |
|---|---|---|
| `permission-denied` عند القراءة | القواعد لم تُنشر، أو الـ claims قديمة | انشر القواعد، ثم سجّل خروج ودخول |
| `The query requires an index` | فهرس مركّب ناقص | افتح الرابط في رسالة الخطأ، أو انشر `firestore.indexes.json` |
| `unauthenticated` عند استدعاء دالة | انتهت الجلسة | أعد تسجيل الدخول |
| `failed-precondition: خزنة التشفير غير مهيأة` | `VAULT_ENCRYPTION_KEY` غير مضبوط | `firebase functions:secrets:set VAULT_ENCRYPTION_KEY` ثم أعد نشر الدوال |
| App Check يرفض الطلبات | مفتاح reCAPTCHA خاطئ أو النطاق غير مسجّل | راجع `__LUMA_APPCHECK_SITE_KEY__` والنطاقات المسموحة |
| الصلاحيات الجديدة لا تُطبَّق | التوكن لم يُحدَّث بعد | الدالة تُبطل الجلسة تلقائياً؛ أعد تسجيل الدخول |
| الخط لا يظهر | مسار `assets/fonts` غير منشور | تأكد أن `firebase.json` لا يستبعد المجلد |
| PDF بحروف مفكّكة | تعطّل html2canvas | استخدم زر «طباعة» → حفظ كـ PDF |
| `Function returned undefined` في السجلات | خطأ داخل محفّز | `firebase functions:log --only <name>` |

---

## 11. بعد النشر

- [ ] فعّل النسخ الاحتياطي التلقائي لـ Firestore
      (`gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7w`)
- [ ] راجع `SECURITY-CHECKLIST.md` بالكامل
- [ ] نفّذ `TESTING-CHECKLIST.md`
- [ ] اضبط تنبيهات الميزانية في Google Cloud Billing
- [ ] فعّل **App Check enforcement** لكل خدمة بعد التأكد من عمل النظام
- [ ] راجع سجل التدقيق من `الإعدادات ← سجل التدقيق`
