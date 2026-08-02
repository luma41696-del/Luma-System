# نظام إدارة وكالة لوما · Luma Agency Management System

نظام إدارة داخلي متكامل لوكالة لوما — واجهة عربية بالكامل (RTL) مبنية على
Firebase، تغطي إدارة المهام والموظفين والعملاء والطلبات الإدارية والدردشة
والتقويم والتقارير مع نظام صلاحيات دقيق وسجل تدقيق.

---

## 1. نظرة سريعة

| المجال | التقنية |
|---|---|
| الواجهة | HTML5 · CSS3 · JavaScript ES Modules (بدون أطر عمل) |
| قاعدة البيانات | Cloud Firestore |
| الحضور اللحظي | Realtime Database (`onDisconnect`) |
| الملفات | Cloud Storage |
| المصادقة | Firebase Authentication + Custom Claims |
| العمليات المحمية | Cloud Functions (Node 20، الجيل الثاني) |
| الحماية | App Check · Security Rules · Secret Manager |
| الرسوم البيانية | Chart.js 4 |
| PDF | jsPDF + html2canvas (تشكيل عربي صحيح عبر المتصفح) |
| الأيقونات | Lucide |
| تعقيم المدخلات | DOMPurify + طبقة تحقق خاصة |
| الخط | DIN Next LT Arabic (محلي عبر `@font-face`) |

---

## 2. شجرة المشروع

```
programming/
├── index.html                     صفحة تسجيل الدخول
├── dashboard.html                 هيكل التطبيق (SPA بموجّه hash)
├── 404.html
├── firebase-messaging-sw.js       Service Worker لإشعارات الويب
├── firebase.json / .firebaserc
├── firestore.rules                قواعد أمان Firestore
├── firestore.indexes.json         الفهارس المركّبة
├── storage.rules                  قواعد أمان التخزين
├── database.rules.json            قواعد Realtime Database
├── .env.example                   قالب الأسرار (الخادم فقط)
│
├── assets/
│   ├── fonts/                     DIN Next Arabic (7 أوزان)
│   ├── logo/                      الشعار: أصلي + فاتح + داكن + أصفر + favicon
│   ├── images/  · icons/
│
├── css/
│   ├── variables.css              الألوان والخطوط والمسافات (Design Tokens)
│   ├── global.css                 إعادة الضبط والطباعة الأساسية
│   ├── layout.css                 الهيكل: القائمة الجانبية، الشريط العلوي، الدخول
│   ├── components.css             البطاقات، الأزرار، النماذج، الجداول، الدردشة…
│   ├── rtl.css                    طبقة الاتجاه (RTL افتراضياً، LTR جاهز)
│   ├── responsive.css             نقاط التوقف: 1400 / 1180 / 900 / 640
│   └── print.css                  ورقة المستند A4 للطباعة و PDF
│
├── js/
│   ├── firebase-config.js         تهيئة كل خدمات Firebase مرة واحدة
│   ├── auth.js                    الجلسة، الدخول باسم المستخدم، كلمة المرور
│   ├── permissions.js             المسميات + الصلاحيات + عناصر القائمة
│   ├── router.js                  موجّه hash مع حراسة الصلاحيات
│   ├── app.js                     هيكل التطبيق (القائمة، البحث، الحالة، الإشعارات)
│   ├── dashboard.js               لوحة الموظف ولوحة المدير
│   ├── tasks.js                   قائمة / لوحة / جدول + تفاصيل المهمة + النموذج
│   ├── employees.js               دليل الموظفين + إنشاء الحسابات
│   ├── employee-profile.js        الملف الشخصي، الإحصائيات، المالية، الصلاحيات
│   ├── clients.js                 دليل العملاء + النموذج
│   ├── client-profile.js          تبويبات العميل + خزنة بيانات الدخول
│   ├── calendar.js                شهر / أسبوع / يوم / جدول + السحب والإفلات
│   ├── documents.js               الطلبات الإدارية + الاعتماد + PDF
│   ├── chat.js                    الدردشة اللحظية
│   ├── reports.js                 التقارير والتصدير
│   ├── notifications.js           مركز الإشعارات
│   ├── settings.js                التفضيلات، الأمان، مصفوفة الصلاحيات، التدقيق
│   ├── team.js                    لوحة الفريق
│   ├── login.js                   منطق صفحة الدخول
│   └── utils/
│       ├── api.js                 استدعاء الدوال + اختصارات Firestore + كاش الدليل
│       ├── dom.js                 مساعدات DOM + الهروب الآمن + الحالات الفارغة
│       ├── format.js              التواريخ والأرقام بالعربية بتوقيت عمّان
│       ├── task-model.js          نموذج المهام والإحصائيات المشتركة
│       ├── presence.js            الحضور، حالة العمل، نظام الاستراحات
│       ├── charts.js              Chart.js مع ثيم لوما
│       ├── modal.js               النوافذ والتأكيدات
│       ├── toast.js               التنبيهات + ترجمة أخطاء Firebase
│       ├── sanitize.js            التعقيم والتحقق (نصوص، روابط، ملفات، IBAN)
│       ├── upload.js              رفع الملفات مع ضغط الصور
│       └── pdf.js                 مستندات PDF عربية + تصدير CSV
│
└── functions/
    ├── index.js                   نقطة التصدير لكل الدوال
    ├── package.json
    ├── lib/
    │   ├── admin.js               تهيئة Admin SDK
    │   ├── permissions.js         نموذج الصلاحيات (المرجع الرسمي)
    │   ├── audit.js               سجل التدقيق (إضافة فقط)
    │   └── validate.js            التحقق وتوليد كلمات المرور المؤقتة
    ├── auth/index.js              الدخول، إنشاء الحسابات، الصلاحيات، الرواتب
    ├── encryption/index.js        خزنة AES-256-GCM
    ├── notifications/index.js     محفّزات الإشعارات + المهام المجدولة
    ├── pdf/index.js               ترقيم الطلبات + الاعتماد + بيانات المستند
    └── scripts/
        ├── seed-admin.js          إنشاء الحساب الإداري الأول بشكل آمن
        └── seed-demo.js           بيانات تجريبية عربية واقعية
```

---

## 3. المتطلبات

- Node.js **20** أو أحدث
- Firebase CLI: `npm install -g firebase-tools`
- خطة **Blaze** على مشروع Firebase (Cloud Functions من الجيل الثاني تتطلبها)
- متصفح حديث يدعم ES Modules

---

## 4. الإعداد خطوة بخطوة

### 4.1 تجهيز المشروع

```bash
cd "C:/Users/Dell/Desktop/Graphic Design/luma/programming"
firebase login
firebase use luma-web-d3550
cd functions && npm install && cd ..
```

### 4.2 تفعيل خدمات Firebase من الـ Console

| الخدمة | الإجراء |
|---|---|
| Authentication | فعّل مزوّد **Email/Password** |
| Firestore | أنشئ قاعدة بيانات في وضع **Production** (المنطقة: `europe-west`) |
| Realtime Database | أنشئ قاعدة بيانات في وضع **Locked** |
| Storage | فعّل Cloud Storage |
| App Check | سجّل تطبيق الويب مع **reCAPTCHA v3** |
| Cloud Messaging | (اختياري) انسخ مفتاح **VAPID** من إعدادات الويب |

### 4.3 مفتاح تشفير الخزنة

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
firebase functions:secrets:set VAULT_ENCRYPTION_KEY
```

> ⚠️ تغيير هذا المفتاح لاحقاً يجعل كل بيانات الخزنة غير قابلة لفك التشفير.
> احتفظ بنسخة احتياطية آمنة منه خارج المستودع.

### 4.4 مفاتيح الواجهة العامة (ليست أسراراً)

أضف قبل `<script type="module" ...>` في `index.html` و `dashboard.html`:

```html
<script>
  window.__LUMA_APPCHECK_SITE_KEY__ = "6Lxxxxxxxxxxxxxxxxxxxxxx";
  window.__LUMA_FCM_VAPID_KEY__     = "BLxxxxxxxxxxxxxxxxxxxxxx";
</script>
```

بدونهما يعمل النظام لكن **App Check** و**إشعارات الويب** تبقى معطّلة.

### 4.5 نشر القواعد والفهارس والدوال

```bash
firebase deploy --only firestore:rules,firestore:indexes,database,storage,functions
```

### 4.6 إنشاء الحساب الإداري الأول

نزّل مفتاح حساب خدمة من
`Project settings → Service accounts → Generate new private key`، ثم:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
$env:LUMA_ADMIN_TEMP_PASSWORD       = "<كلمة المرور المؤقتة>"
cd functions
node scripts/seed-admin.js
```

النتيجة: حساب `admin` بكلمة مرور مؤقتة **مطلوب تغييرها إجبارياً عند أول دخول**.
كلمة المرور تُقرأ من متغيّر البيئة ولا تُكتب في أي ملف داخل المستودع.

بعد الانتهاء: احذف ملف حساب الخدمة وامسح متغيّر البيئة.

### 4.7 (اختياري) البيانات التجريبية

```powershell
$env:LUMA_DEMO_PASSWORD = "<كلمة مرور مؤقتة للحسابات التجريبية>"
node scripts/seed-demo.js
```

ينشئ 8 موظفين و5 عملاء و37 مهمة و6 طلبات وأحداث تقويم ومحادثات وسجل استراحات.

### 4.8 التشغيل

```bash
firebase deploy --only hosting
```

أو محلياً:

```bash
firebase emulators:start
```

ثم افتح `http://localhost:5000` — أضف `?emulator=1` للاتصال بالمحاكيات بدل الإنتاج.

---

## 5. نموذج الصلاحيات

الصلاحيات تُخزَّن في **Firebase custom claims** ويُعاد التحقق منها في
Security Rules وفي كل Cloud Function. إخفاء زر في الواجهة ليس حماية.

```
token.role   = 'admin' | 'manager' | 'employee'
token.perms  = ['ev','tc','ra', …]        رموز مختصرة (حد الـ claims ألف بايت)
token.status = 'active' | 'disabled'
```

**23 صلاحية** موزّعة على: لوحة التحكم · الموظفون · العملاء · المهام · الطلبات ·
الدردشة · التقارير · الإعدادات. القائمة الكاملة في
[`js/permissions.js`](js/permissions.js) و[`functions/lib/permissions.js`](functions/lib/permissions.js).

**المسميات الوظيفية منفصلة عن الصلاحيات** وتُخزَّن كمصفوفة، فيمكن للموظف أن يكون
«مصمم جرافيك + مونتير» في الوقت نفسه.

**حماية من تصعيد الصلاحيات:** لا يستطيع أي مستخدم غير المدير العام منح صلاحية
لا يملكها بنفسه، ولا ترقية أحد إلى `admin`، ولا إزالة آخر مدير نظام.

---

## 6. بنية قاعدة البيانات

```
users/{uid}                        الملف الشخصي (بدون بيانات مالية)
  └ private/salary                 الراتب        — صلاحية employees.viewSalary
  └ private/banking                IBAN / CliQ   — صلاحية employees.viewBanking
usernames/{username}               فهرس اسم المستخدم → uid   (الخادم فقط)
loginAttempts/{key}                عدّاد المحاولات الفاشلة   (الخادم فقط)
clients/{id}
  └ social/{id}   files/{id}   activity/{id}
clientCredentials/{id}             خزنة مشفّرة   (الخادم فقط — لا قراءة من المتصفح)
tasks/{id}
  └ comments/{id}   activity/{id}
requests/{id}
  └ thread/{id}                    المراسلة الخاصة مع الإدارة
chats/{id}
  └ messages/{id}
calendarEvents/{id}
workSessions/{id}   breakSessions/{id}
notifications/{id}
reports/{id}
auditLogs/{id}                     إضافة فقط — يُكتب من الخادم حصراً
settings/app
counters/{name}                    ترقيم الطلبات (معاملات ذرّية)
mail/{id}                          طابور البريد (امتداد Trigger Email)
```

Realtime Database:

```
status/{uid}       { state, lastChanged, breakStartedAt, todayBreakMs, … }
typing/{chatId}/{uid}
```

---

## 7. تفاصيل مهمّة في التنفيذ

### الدخول باسم المستخدم
Firebase Authentication يعمل بالبريد وكلمة المرور. الواجهة تعرض **اسم مستخدم**،
ودالة `resolveUsername` على الخادم تترجمه إلى عنوان داخلي
(`username@users.luma-agency.internal`) بعد التحقق من الإيقاف المؤقت.
الردّ موحّد دائماً حتى لا يُستخدم في استكشاف الحسابات الموجودة.
الإيقاف: **8 محاولات فاشلة → 15 دقيقة**.

### الاستراحات والحضور
`onDisconnect()` في Realtime Database هو ما يجعل «غير متصل» موثوقاً — الخادم هو
من ينفّذها عند انقطاع الاتصال. مدة الاستراحة تُحسب من **طابع زمني من الخادم**،
فتغيير ساعة الجهاز لا يقصّر الاستراحة. الاستراحات المنسية تُغلق تلقائياً ليلاً.

### PDF عربي
تضمين خط TTF داخل jsPDF واستدعاء `doc.text()` بالعربية ينتج حروفاً **مفكّكة
ومعكوسة**، لأن jsPDF لا ينفّذ تشكيل الحروف العربية ولا ترتيب bidi.
لذلك يبني النظام ورقة A4 من HTML، ويترك **المتصفح** يقوم بالتشكيل والترتيب
(وهو المحرّك الوحيد الذي يفعل ذلك بشكل صحيح)، ثم يحوّلها إلى PDF:

- `downloadPdf()` → html2canvas + jsPDF (ملف PDF مباشر)
- `printSheet()` → نافذة الطباعة (نص متجهي قابل للتحديد — أعلى جودة)

### خزنة بيانات العملاء
AES-256-GCM · مفتاح في Secret Manager · النص المشفّر غير قابل للقراءة من
المتصفح إطلاقاً · العرض يتطلب صلاحية `clients.viewCredentials` **وإعادة إدخال
كلمة المرور** (نافذة خمس دقائق) · كل عرض/إضافة/تعديل/حذف يُسجَّل في سجل التدقيق ·
النافذة تُغلق تلقائياً بعد 45 ثانية.

> التوصية الأمنية تبقى: استخدم **Meta Business Manager** أو دعوات المنصات أو
> OAuth بدل تخزين كلمة المرور أساساً. الخزنة هي الحل الأخير.

---

## 7.0 الحذف النهائي

الحذف يتم دائماً عبر Cloud Functions، لأن Firestore **لا يحذف المجموعات
الفرعية تلقائياً** ولا يزيل الإشارات إلى المستند المحذوف.

| العنصر | الصلاحية | ما يُحذف | ما يبقى |
|---|---|---|---|
| **موظف** | `employees.delete` | حساب الدخول · الملف الشخصي · البيانات المالية · طلباته ومراسلاتها · الاستراحات · الإشعارات · عضويته في الدردشات · حجز اسم المستخدم | **المهام** (يُزال اسمه من المسؤولين فقط) · **سجل التدقيق** |
| **عميل** | `clients.delete` | ملف العميل · حسابات التواصل · الملفات · سجل النشاط · **كل بيانات الخزنة المشفّرة** | **المهام** (تُفصل عن العميل مع الاحتفاظ باسمه كنص) |
| **طلب إداري** | `requests.approve` أو صاحبه (مسودة/ملغى/مرفوض فقط) | الطلب ومراسلات الإدارة | سجل التدقيق · **رصيد الإجازة يُعاد تلقائياً** لو كان معتمداً |

**الحمايات المطبَّقة:**

- لا يمكن حذف حسابك الخاص
- لا يمكن حذف آخر مدير نظام
- لا يمكن لصاحب الطلب حذف طلب **معتمد** أو قيد المراجعة (يسحبه بدلاً من ذلك)
- حذف الموظف والعميل يتطلب **كتابة الاسم يدوياً** للتأكيد
- حذف العميل يعرض أولاً **عدد المهام وبيانات الدخول المتأثرة** قبل التنفيذ
- كل عملية حذف تُسجَّل في سجل التدقيق باسم المنفّذ ووقته

> للموظفين: **التعطيل** (`employees.delete` أيضاً) هو الخيار الموصى به — يمنع
> الدخول فوراً ويحتفظ بكل السجلات، ويمكن التراجع عنه.

---

## 7.1 رفع الملفات — معطّل مؤقتاً ⚠️

Cloud Storage يتطلب خطة **Blaze**. لذلك رفع الملفات والصور **معطّل حالياً** عبر
مفتاح واحد في [`js/features.js`](js/features.js):

```js
export const FEATURES = {
  uploads: false        // ← غيّرها إلى true بعد الاشتراك بخطة Blaze
};
```

ما الذي يحدث والمفتاح مغلق:

| الموضع | السلوك |
|---|---|
| الصورة الشخصية للموظف | زر الكاميرا مخفي (الأحرف الأولى الملوّنة تُستخدم كصورة) |
| شعار العميل | منطقة الرفع مخفية من نموذج العميل |
| مرفقات المهام | زر «رفع ملف» مستبدل برسالة توضيحية |
| ملفات العميل | زر الرفع مخفي + تنبيه — والملفات القديمة تبقى قابلة للعرض |
| مرفقات الدردشة | زر المشبك مخفي — الرسائل النصية والروابط تعمل بشكل طبيعي |
| مرفق الطلب الإداري | منطقة الرفع مخفية — الطلب يُقدَّم بدون مرفق |
| `uploadFile()` | يرفض التنفيذ فوراً برسالة عربية واضحة (خط دفاع أخير) |

**للتفعيل بعد الاشتراك:** غيّر القيمة إلى `true` فقط. كل ما عدا ذلك جاهز —
كود الرفع وقواعد `storage.rules` والواجهة موجودة ولم تُحذف.

> بقية النظام لا يتأثر إطلاقاً: المهام والطلبات والدردشة والتقارير وتصدير PDF
> تعمل بالكامل بدون Storage.

---

## 8. البريد الإلكتروني (استعادة كلمة المرور)

دالة `requestPasswordReset` تكتب الرسالة في مجموعة `mail`. لإرسالها فعلياً ثبّت
امتداد **Trigger Email from Firestore**:

```bash
firebase ext:install firebase/firestore-send-email
```

اضبط `MAIL_COLLECTION = mail` وبيانات SMTP. بدون الامتداد يُنشأ المستند ولا
يُرسل بريد — يمكن للمدير حينها إعادة تعيين كلمة المرور يدوياً من ملف الموظف.

---

## 9. الأوامر السريعة

```bash
firebase emulators:start                 # تشغيل محلي كامل
firebase deploy                          # نشر كل شيء
firebase deploy --only hosting           # الواجهة فقط
firebase deploy --only functions         # الدوال فقط
firebase deploy --only firestore:rules   # القواعد فقط
firebase functions:log                   # سجلات الدوال
node functions/scripts/seed-admin.js     # الحساب الإداري
node functions/scripts/seed-demo.js      # بيانات تجريبية
node functions/scripts/seed-demo.js --reset
```

---

## 10. مستندات إضافية

- [`DEPLOYMENT.md`](DEPLOYMENT.md) — خطوات النشر التفصيلية واستكشاف الأخطاء
- [`SECURITY-CHECKLIST.md`](SECURITY-CHECKLIST.md) — قائمة التحقق الأمني
- [`TESTING-CHECKLIST.md`](TESTING-CHECKLIST.md) — قائمة اختبار القبول

---

## 11. الهوية البصرية

| اللون | القيمة | الاستخدام |
|---|---|---|
| كحلي داكن | `#071A2F` | الخلفية الأساسية |
| كحلي سطحي | `#102943` | البطاقات والأسطح |
| أصفر لوما | `#FFC928` | الأزرار الأساسية، العناصر النشطة، المؤشرات |
| أصفر التمرير | `#EAB600` | حالة hover |
| أبيض | `#F8FAFC` | النصوص |
| أسود ناعم | `#171B22` | نصوص الوضع النهاري |
| رمادي متوسط | `#7F8998` | النصوص الثانوية |
| رمادي فاتح | `#D8DEE8` | الفواصل |
| حدود داكنة | `#263B52` | الإطارات |

الشعار مستخدم كما هو دون تعديل في نسبه أو أشكاله. النسخ الملوّنة (فاتح/داكن/أصفر)
مشتقّة من الملف الأصلي عبر قناة الشفافية، والواجهة تعيد تلوينه بـ CSS `mask`
فلا يتشوّه أبداً مهما تغيّر الثيم.

الخط: **DIN Next LT Arabic** بسبعة أوزان محمّلة محلياً، مع `Cairo` ثم
`Arial, sans-serif` كاحتياطي.

---

## 12. حسابات الاختبار

كلمات المرور **غير موجودة في المستودع ولا في الواجهة**. بعد تشغيل
`seed-demo.js` تستخدم كل الحسابات قيمة `LUMA_DEMO_PASSWORD` التي حددتها أنت،
وجميعها مطالَبة بتغييرها عند أول دخول:

| اسم المستخدم | الاسم | الدور |
|---|---|---|
| `admin` | مدير النظام | مدير النظام (كل الصلاحيات) |
| `rana.masri` | رنا المصري | مديرة حسابات |
| `yousef.qudah` | يوسف القضاة | مصمم جرافيك + مونتير |
| `lina.khatib` | لينا الخطيب | مصممة جرافيك |
| `omar.haddad` | عمر الحداد | دعم تقني + مبرمج |
| `sara.nabulsi` | سارة النابلسي | مصورة + مونتيرة |
| `khaled.zoubi` | خالد الزعبي | مبرمج |
| `dana.sharif` | دانا الشريف | مبيعات |
| `majd.tamimi` | مجد التميمي | مونتير + مصور |
