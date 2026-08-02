#!/usr/bin/env node
/**
 * Realistic Arabic demo data for Luma Agency.
 *
 * Creates employees (with real Auth accounts and correct custom claims),
 * clients, social accounts, tasks with comments and checklists, administrative
 * requests, calendar events, chat rooms with messages and break sessions.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *   LUMA_DEMO_PASSWORD='<a temporary password for all demo accounts>' \
 *   node scripts/seed-demo.js
 *
 * Flags:  --reset   delete previously seeded demo data first
 *
 * Every demo account is flagged `mustChangePassword`. The shared demo password
 * is read from the environment and is never written to the repository.
 */

'use strict';

try { require('dotenv').config(); } catch { /* optional */ }

const admin = require('firebase-admin');
const { PERMISSION_CODES } = require('../lib/permissions');

const PROJECT_ID = process.env.LUMA_PROJECT_ID || 'luma-web-d3550';
const DEMO_PASSWORD = process.env.LUMA_DEMO_PASSWORD;
const AUTH_EMAIL_DOMAIN = 'users.luma-agency.internal';
const RESET = process.argv.includes('--reset');

if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 6) {
  console.error(`
❌ LUMA_DEMO_PASSWORD is not set (or shorter than 6 characters).

   Set a temporary password for the demo accounts, e.g.

     PowerShell:  $env:LUMA_DEMO_PASSWORD="Luma#Demo2026"
     bash:        export LUMA_DEMO_PASSWORD='Luma#Demo2026'

   It is intentionally not stored in the repository.
`);
  process.exit(1);
}

/* Emulator mode needs no credentials — see the note in seed-admin.js. */
const USING_EMULATORS = !!(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);

if (!admin.apps.length) {
  admin.initializeApp(
    USING_EMULATORS
      ? { projectId: PROJECT_ID }
      : { credential: admin.credential.applicationDefault(), projectId: PROJECT_ID }
  );
}
if (USING_EMULATORS) console.log('⚙  Emulator mode — writing to the local Firebase emulators.');

const db = admin.firestore();
const auth = admin.auth();
const now = admin.firestore.FieldValue.serverTimestamp();
const DEMO_TAG = { demo: true };

const days = (n) => new Date(Date.now() + n * 86_400_000);
const hours = (n) => new Date(Date.now() + n * 3_600_000);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const codes = (names) => names.map((n) => PERMISSION_CODES[n]).filter(Boolean);

/* ========================================================================== */
/* People                                                                     */
/* ========================================================================== */

const EMPLOYEES = [
  {
    username: 'rana.masri',
    displayName: 'رنا المصري',
    accountRole: 'manager',
    roles: ['account_manager'],
    department: 'accounts',
    phone: '+962791234501',
    email: 'rana@lumaagency.jo',
    joinDate: '2023-02-12',
    salary: 950,
    permissions: [
      'dashboard.viewCompany', 'dashboard.viewTeam', 'employees.view', 'employees.create',
      'employees.edit', 'clients.view', 'clients.create', 'clients.edit',
      'clients.viewCredentials', 'tasks.create', 'tasks.assign', 'tasks.editAll',
      'tasks.delete', 'requests.approve', 'chat.manage', 'reports.view', 'reports.export'
    ]
  },
  {
    username: 'yousef.qudah',
    displayName: 'يوسف القضاة',
    accountRole: 'employee',
    roles: ['graphic_designer', 'video_editor'],
    department: 'creative',
    phone: '+962791234502',
    email: 'yousef@lumaagency.jo',
    joinDate: '2023-06-01',
    salary: 620,
    permissions: ['clients.view']
  },
  {
    username: 'lina.khatib',
    displayName: 'لينا الخطيب',
    accountRole: 'employee',
    roles: ['graphic_designer'],
    department: 'creative',
    phone: '+962791234503',
    email: 'lina@lumaagency.jo',
    joinDate: '2024-01-15',
    salary: 540,
    permissions: ['clients.view']
  },
  {
    username: 'omar.haddad',
    displayName: 'عمر الحداد',
    accountRole: 'employee',
    roles: ['it', 'programmer'],
    department: 'tech',
    phone: '+962791234504',
    email: 'omar@lumaagency.jo',
    joinDate: '2022-09-05',
    salary: 880,
    permissions: ['clients.view', 'dashboard.viewTeam', 'reports.view']
  },
  {
    username: 'sara.nabulsi',
    displayName: 'سارة النابلسي',
    accountRole: 'employee',
    roles: ['photographer', 'video_editor'],
    department: 'media',
    phone: '+962791234505',
    email: 'sara@lumaagency.jo',
    joinDate: '2024-03-20',
    salary: 600,
    permissions: ['clients.view']
  },
  {
    username: 'khaled.zoubi',
    displayName: 'خالد الزعبي',
    accountRole: 'employee',
    roles: ['programmer'],
    department: 'tech',
    phone: '+962791234506',
    email: 'khaled@lumaagency.jo',
    joinDate: '2023-11-02',
    salary: 810,
    permissions: ['clients.view']
  },
  {
    username: 'dana.sharif',
    displayName: 'دانا الشريف',
    accountRole: 'employee',
    roles: ['sales'],
    department: 'sales',
    phone: '+962791234507',
    email: 'dana@lumaagency.jo',
    joinDate: '2024-05-11',
    salary: 570,
    permissions: ['clients.view', 'clients.create']
  },
  {
    username: 'majd.tamimi',
    displayName: 'مجد التميمي',
    accountRole: 'employee',
    roles: ['video_editor', 'photographer'],
    department: 'media',
    phone: '+962791234508',
    email: 'majd@lumaagency.jo',
    joinDate: '2025-01-08',
    salary: 560,
    permissions: ['clients.view']
  }
];

/* ========================================================================== */
/* Clients                                                                    */
/* ========================================================================== */

const CLIENTS = [
  {
    name: 'مطاعم بيت السدو',
    contactPerson: 'أبو محمد السدو',
    phone: '+962795550101',
    email: 'info@baitalsadu.jo',
    website: 'https://baitalsadu.jo',
    address: 'عمّان — عبدون، شارع الأميرة بسمة',
    services: ['social', 'design', 'photo', 'ads'],
    status: 'active',
    contractStart: '2025-01-01',
    contractEnd: '2026-12-31',
    notes: 'يفضّل النشر مساءً. اللهجة الأردنية في المحتوى. تصوير الأطباق كل يوم إثنين.',
    social: [
      { platform: 'instagram', pageName: 'Bait Al Sadu', username: '@baitalsadu', url: 'https://instagram.com/baitalsadu', accessNotes: 'الوصول عبر Meta Business Manager — لا حاجة لكلمة مرور.' },
      { platform: 'facebook', pageName: 'بيت السدو', username: 'baitalsadu.jo', url: 'https://facebook.com/baitalsadu', accessNotes: 'صلاحية مدير عبر Business Manager.' },
      { platform: 'tiktok', pageName: 'baitalsadu', username: '@baitalsadu', url: 'https://tiktok.com/@baitalsadu', accessNotes: 'دعوة كمنشئ محتوى.' }
    ]
  },
  {
    name: 'عيادات نور التخصصية',
    contactPerson: 'د. نور العبادي',
    phone: '+962795550102',
    email: 'marketing@noorclinics.jo',
    website: 'https://noorclinics.jo',
    address: 'عمّان — الشميساني، مجمع الحسين الطبي',
    services: ['social', 'design', 'web', 'seo'],
    status: 'active',
    contractStart: '2025-03-01',
    contractEnd: '2026-09-30',
    notes: 'محتوى طبي يحتاج مراجعة الطبيبة قبل النشر. ممنوع استخدام صور المرضى.',
    social: [
      { platform: 'instagram', pageName: 'Noor Clinics', username: '@noorclinics', url: 'https://instagram.com/noorclinics', accessNotes: 'Business Manager.' },
      { platform: 'website', pageName: 'الموقع الرسمي', username: 'admin', url: 'https://noorclinics.jo/wp-admin', accessNotes: 'حساب محرر فقط — كلمة المرور في الخزنة المشفّرة.' }
    ]
  },
  {
    name: 'شركة الأفق للمقاولات',
    contactPerson: 'م. سامر أبو غزالة',
    phone: '+962795550103',
    email: 'samer@ofoq-contracting.com',
    website: 'https://ofoq-contracting.com',
    address: 'الزرقاء — المنطقة الحرة',
    services: ['branding', 'web', 'video'],
    status: 'active',
    contractStart: '2025-06-15',
    contractEnd: '2026-06-14',
    notes: 'إعادة بناء الهوية البصرية بالكامل + موقع تعريفي. التسليم على مراحل.',
    social: [
      { platform: 'linkedin', pageName: 'Ofoq Contracting', username: 'ofoq-contracting', url: 'https://linkedin.com/company/ofoq', accessNotes: 'صلاحية مسؤول صفحة.' }
    ]
  },
  {
    name: 'متجر زهرة اللوز',
    contactPerson: 'هبة العمري',
    phone: '+962795550104',
    email: 'hello@zahratallawz.com',
    website: 'https://zahratallawz.com',
    address: 'إربد — شارع الجامعة',
    services: ['social', 'photo', 'ads', 'design'],
    status: 'active',
    contractStart: '2025-09-01',
    contractEnd: '2026-08-31',
    notes: 'متجر إلكتروني للحلويات. حملات مكثفة في المواسم والأعياد.',
    social: [
      { platform: 'instagram', pageName: 'Zahrat Al Lawz', username: '@zahratallawz', url: 'https://instagram.com/zahratallawz', accessNotes: 'Business Manager.' },
      { platform: 'snapchat', pageName: 'zahratallawz', username: 'zahratallawz', url: '', accessNotes: 'الوصول عبر جهاز العميل فقط.' }
    ]
  },
  {
    name: 'أكاديمية مسار التعليمية',
    contactPerson: 'أ. رائد الشوبكي',
    phone: '+962795550105',
    email: 'info@masaracademy.jo',
    website: 'https://masaracademy.jo',
    address: 'عمّان — خلدا',
    services: ['social', 'video', 'web'],
    status: 'paused',
    contractStart: '2024-09-01',
    contractEnd: '2025-08-31',
    notes: 'العقد متوقف مؤقتاً بانتظار موافقة الميزانية للعام الدراسي الجديد.',
    social: [
      { platform: 'youtube', pageName: 'Masar Academy', username: '@masaracademy', url: 'https://youtube.com/@masaracademy', accessNotes: 'وصول عبر Brand Account.' }
    ]
  }
];

/* ========================================================================== */
/* Task templates                                                             */
/* ========================================================================== */

const TASK_TEMPLATES = [
  { title: 'تصميم 12 منشور إنستغرام لشهر آب', role: 'graphic_designer', project: 'خطة المحتوى الشهرية',
    description: 'تصميم المنشورات وفق خطة المحتوى المعتمدة مع مراعاة الهوية البصرية للعميل والألوان الأساسية.',
    checklist: ['مراجعة خطة المحتوى', 'إعداد القوالب', 'التصميم النهائي', 'مراجعة مدير الحساب'] },
  { title: 'تصوير الأطباق الجديدة في المطعم', role: 'photographer', project: 'جلسة تصوير آب',
    description: 'جلسة تصوير احترافية لعشرة أطباق جديدة، مع إضاءة طبيعية وخلفيات متناسقة.',
    checklist: ['تجهيز المعدات', 'تنسيق الموعد مع العميل', 'التصوير', 'المعالجة والتسليم'] },
  { title: 'مونتاج فيديو ريلز ترويجي', role: 'video_editor', project: 'حملة الإطلاق',
    description: 'مونتاج فيديو بطول 30 ثانية للريلز مع موسيقى وتأثيرات نصية عربية.',
    checklist: ['اختيار اللقطات', 'المونتاج الأولي', 'إضافة النصوص', 'التصدير بجودة عالية'] },
  { title: 'تطوير صفحة الهبوط للحملة الإعلانية', role: 'programmer', project: 'حملة سبتمبر',
    description: 'صفحة هبوط سريعة ومتجاوبة مع نموذج تسجيل مرتبط بجدول بيانات العميل.',
    checklist: ['تصميم الواجهة', 'البرمجة', 'اختبار السرعة', 'الربط مع التحليلات'] },
  { title: 'إعداد التقرير الشهري لأداء الحسابات', role: 'account_manager', project: 'تقارير الأداء',
    description: 'تقرير يشمل نسب التفاعل والوصول ومقارنة بالشهر السابق مع التوصيات.',
    checklist: ['جمع البيانات', 'تحليل النتائج', 'كتابة التوصيات', 'إرسال التقرير للعميل'] },
  { title: 'تحديث الهوية البصرية — دليل الاستخدام', role: 'graphic_designer', project: 'الهوية البصرية',
    description: 'إعداد دليل استخدام الهوية بصيغة PDF يشمل الشعار والألوان والخطوط.',
    checklist: ['الشعار وتنويعاته', 'لوحة الألوان', 'الخطوط', 'أمثلة تطبيقية'] },
  { title: 'صيانة السيرفر ونسخ احتياطي', role: 'it', project: 'البنية التقنية',
    description: 'فحص دوري للسيرفر، تحديث الحزم، والتأكد من عمل النسخ الاحتياطي التلقائي.',
    checklist: ['فحص المساحة', 'تحديث الحزم', 'اختبار النسخة الاحتياطية'] },
  { title: 'متابعة عرض السعر مع العميل المحتمل', role: 'sales', project: 'تطوير الأعمال',
    description: 'إرسال عرض السعر ومتابعة الرد خلال ثلاثة أيام عمل.',
    checklist: ['إعداد العرض', 'الإرسال', 'المتابعة الهاتفية'] },
  { title: 'تجهيز محتوى الحملة الإعلانية المدفوعة', role: 'account_manager', project: 'حملة سبتمبر',
    description: 'كتابة النصوص الإعلانية وتحديد الجمهور المستهدف والميزانية اليومية.',
    checklist: ['كتابة النصوص', 'تحديد الجمهور', 'ضبط الميزانية', 'إطلاق الحملة'] },
  { title: 'تصميم بروشور تعريفي بالخدمات', role: 'graphic_designer', project: 'مواد تسويقية',
    description: 'بروشور من ست صفحات بمقاس A5 جاهز للطباعة مع ملفات CMYK.',
    checklist: ['التخطيط', 'التصميم', 'مراجعة المحتوى', 'ملفات الطباعة'] }
];

const STATUSES = ['new', 'assigned', 'inprogress', 'waiting', 'review', 'completed'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

/* ========================================================================== */
/* Seeding                                                                    */
/* ========================================================================== */

async function deleteQuery(query) {
  const snap = await query.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snap.size;
}

async function reset() {
  console.log('🧹 Removing previous demo data…');
  for (const name of ['tasks', 'clients', 'requests', 'calendarEvents', 'breakSessions', 'notifications']) {
    const removed = await deleteQuery(db.collection(name).where('demo', '==', true).limit(400));
    if (removed) console.log(`   – ${removed} from ${name}`);
  }
  for (const employee of EMPLOYEES) {
    try {
      const user = await auth.getUserByEmail(`${employee.username}@${AUTH_EMAIL_DOMAIN}`);
      await auth.deleteUser(user.uid);
      await db.collection('users').doc(user.uid).delete().catch(() => {});
      await db.collection('usernames').doc(employee.username).delete().catch(() => {});
    } catch { /* not present */ }
  }
  console.log('   ✔ demo accounts removed\n');
}

async function seedEmployees() {
  console.log('👥 Creating employees…');
  const created = [];

  for (const employee of EMPLOYEES) {
    const authEmail = `${employee.username}@${AUTH_EMAIL_DOMAIN}`;
    let user;
    try {
      user = await auth.getUserByEmail(authEmail);
      await auth.updateUser(user.uid, { password: DEMO_PASSWORD, displayName: employee.displayName });
    } catch {
      user = await auth.createUser({
        email: authEmail,
        password: DEMO_PASSWORD,
        displayName: employee.displayName,
        emailVerified: false
      });
    }

    const permCodes = employee.accountRole === 'admin' ? [] : codes(employee.permissions);
    await auth.setCustomUserClaims(user.uid, {
      role: employee.accountRole,
      perms: permCodes,
      status: 'active'
    });

    await db.collection('usernames').doc(employee.username).set({
      uid: user.uid, authEmail, createdAt: now
    });

    await db.collection('users').doc(user.uid).set({
      uid: user.uid,
      username: employee.username,
      usernameLower: employee.username,
      displayName: employee.displayName,
      displayNameLower: employee.displayName.toLowerCase(),
      personalEmail: employee.email,
      phone: employee.phone,
      department: employee.department,
      roles: employee.roles,
      accountRole: employee.accountRole,
      perms: permCodes,
      photoURL: null,
      status: 'active',
      mustChangePassword: true,
      joinDate: employee.joinDate,
      managerId: null,
      leave: {
        annualQuota: 14,
        used: Math.floor(Math.random() * 5),
        remaining: 14 - Math.floor(Math.random() * 5),
        usedThisMonth: Math.floor(Math.random() * 2)
      },
      notifPrefs: {},
      notes: '',
      demo: true,
      createdAt: now,
      updatedAt: now
    }, { merge: true });

    await db.collection('users').doc(user.uid).collection('private').doc('salary').set({
      amount: employee.salary, allowances: 50, currency: 'JOD', updatedAt: now
    });
    await db.collection('users').doc(user.uid).collection('private').doc('banking').set({
      iban: '', bankName: 'البنك العربي', cliq: employee.username.split('.')[0], updatedAt: now
    });

    created.push({ ...employee, uid: user.uid });
    console.log(`   ✔ ${employee.displayName} (@${employee.username})`);
  }

  // The account manager manages everyone else.
  const manager = created.find((e) => e.accountRole === 'manager');
  if (manager) {
    const batch = db.batch();
    created.filter((e) => e.uid !== manager.uid).forEach((e) => {
      batch.set(db.collection('users').doc(e.uid), { managerId: manager.uid }, { merge: true });
    });
    await batch.commit();
  }

  return created;
}

async function seedClients(employees) {
  console.log('\n🏢 Creating clients…');
  const manager = employees.find((e) => e.accountRole === 'manager');
  const created = [];

  for (const client of CLIENTS) {
    const { social, ...fields } = client;
    const ref = await db.collection('clients').add({
      ...fields,
      nameLower: client.name.toLowerCase(),
      logoURL: null,
      accountManagerId: manager?.uid || null,
      demo: true,
      createdBy: manager?.uid || null,
      createdAt: now,
      updatedAt: now
    });

    for (const account of social) {
      await ref.collection('social').add({
        ...account,
        assignees: [pick(employees).uid],
        createdAt: now,
        updatedAt: now
      });
    }

    await ref.collection('activity').add({
      actorId: manager?.uid || null,
      text: 'أضاف العميل إلى النظام',
      at: now
    });

    created.push({ id: ref.id, ...fields });
    console.log(`   ✔ ${client.name}`);
  }
  return created;
}

async function seedTasks(employees, clients) {
  console.log('\n📋 Creating tasks…');
  const manager = employees.find((e) => e.accountRole === 'manager');
  let count = 0;

  for (let i = 0; i < 34; i++) {
    const template = TASK_TEMPLATES[i % TASK_TEMPLATES.length];
    const candidates = employees.filter((e) => e.roles.includes(template.role));
    const assignee = candidates.length ? pick(candidates) : pick(employees);
    const client = pick(clients);
    const status = i < 12 ? 'completed' : pick(STATUSES);
    const overdue = i % 7 === 3;

    const createdAt = days(-Math.floor(Math.random() * 30) - 1);
    const dueAt = overdue ? days(-Math.floor(Math.random() * 5) - 1) : days(Math.floor(Math.random() * 14) - 2);
    const startedAt = status === 'new' ? null : days(-Math.floor(Math.random() * 10));
    const completedAt = status === 'completed' ? days(-Math.floor(Math.random() * 8)) : null;

    const checklist = template.checklist.map((text, index) => ({
      id: `c${i}_${index}`,
      text,
      done: status === 'completed' ? true : index < Math.floor(Math.random() * template.checklist.length)
    }));

    const doc = await db.collection('tasks').add({
      title: `${template.title} — ${client.name}`,
      titleLower: `${template.title} — ${client.name}`.toLowerCase(),
      description: template.description,
      project: template.project,
      clientId: client.id,
      clientName: client.name,
      assignees: [assignee.uid],
      roleTags: [template.role],
      priority: overdue ? 'urgent' : pick(PRIORITIES),
      status,
      progress: status === 'completed' ? 100
        : Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100),
      checklist,
      attachments: [],
      watchers: [assignee.uid, manager?.uid].filter(Boolean),
      timeSpentMs: status === 'completed' ? (2 + Math.random() * 8) * 3_600_000 : Math.random() * 4 * 3_600_000,
      commentCount: 0,
      isPersonal: false,
      deleted: false,
      demo: true,
      createdBy: manager?.uid || assignee.uid,
      createdAt,
      startedAt,
      dueAt,
      completedAt,
      lastStatusAt: startedAt || createdAt,
      updatedAt: now
    });

    // A couple of comments on some tasks.
    if (i % 3 === 0) {
      const comments = [
        'تم البدء بالعمل، سأرسل المسودة الأولى غداً بإذن الله.',
        'الرجاء الانتباه لاستخدام الخط المعتمد في الهوية.',
        'تمت مراجعة العمل والملاحظات بسيطة — ممتاز.'
      ];
      for (let c = 0; c < 2; c++) {
        await doc.collection('comments').add({
          authorId: c === 0 ? assignee.uid : (manager?.uid || assignee.uid),
          authorName: c === 0 ? assignee.displayName : (manager?.displayName || ''),
          body: comments[c % comments.length],
          createdAt: days(-Math.floor(Math.random() * 5))
        });
      }
      await doc.set({ commentCount: 2 }, { merge: true });
    }

    await doc.collection('activity').add({
      actorId: manager?.uid || assignee.uid,
      type: 'create',
      text: 'أنشأ المهمة',
      at: createdAt
    });

    count++;
  }

  // A few personal tasks so the employee dashboard is not empty.
  for (const employee of employees.slice(1, 4)) {
    await db.collection('tasks').add({
      title: 'ترتيب ملفات المشاريع على الدرايف',
      titleLower: 'ترتيب ملفات المشاريع على الدرايف',
      description: 'مهمة شخصية لتنظيم مجلدات العمل نهاية الأسبوع.',
      project: '',
      clientId: null,
      clientName: null,
      assignees: [employee.uid],
      roleTags: employee.roles,
      priority: 'low',
      status: 'assigned',
      progress: 0,
      checklist: [],
      attachments: [],
      watchers: [employee.uid],
      timeSpentMs: 0,
      commentCount: 0,
      isPersonal: true,
      deleted: false,
      demo: true,
      createdBy: employee.uid,
      createdAt: now,
      startedAt: null,
      dueAt: days(4),
      completedAt: null,
      updatedAt: now
    });
    count++;
  }

  console.log(`   ✔ ${count} tasks`);
}

async function seedRequests(employees) {
  console.log('\n📄 Creating administrative requests…');
  const manager = employees.find((e) => e.accountRole === 'manager');

  const items = [
    { employee: employees[1], type: 'leave', status: 'approved', fromDate: dateStr(-12), toDate: dateStr(-10), days: 3,
      reason: 'إجازة سنوية لقضاء عطلة عائلية خارج المملكة.',
      managerResponse: 'موافق — يرجى تسليم المهام العاجلة قبل السفر.' },
    { employee: employees[2], type: 'departure', status: 'approved', fromDate: dateStr(-3), toDate: dateStr(-3),
      fromTime: '14:00', toTime: '16:30',
      reason: 'مراجعة طبية مسبقة الحجز في عيادة الأسنان.',
      managerResponse: 'موافق مع تعويض الساعات لاحقاً.' },
    { employee: employees[3], type: 'advance', status: 'submitted', amount: 300, installments: 3,
      reason: 'سلفة على الراتب لتغطية مصاريف طارئة، على أن تُخصم على ثلاثة أقساط.' },
    { employee: employees[4], type: 'sick', status: 'submitted', fromDate: dateStr(-1), toDate: dateStr(0), days: 2,
      reason: 'إجازة مرضية بسبب نزلة برد شديدة مع تقرير طبي مرفق.' },
    { employee: employees[5], type: 'leave', status: 'rejected', fromDate: dateStr(6), toDate: dateStr(12), days: 7,
      reason: 'إجازة سنوية مطولة.',
      managerResponse: 'معتذرين — الفترة تتزامن مع تسليم مشروع الأفق. يرجى إعادة الطلب بعد التسليم.' },
    { employee: employees[6], type: 'leave', status: 'draft', fromDate: dateStr(20), toDate: dateStr(22), days: 3,
      reason: 'إجازة لحضور مؤتمر تسويقي في دبي.' }
  ];

  let index = 1;
  for (const item of items) {
    const { employee, ...fields } = item;
    const doc = await db.collection('requests').add({
      ...fields,
      employeeId: employee.uid,
      employeeName: employee.displayName,
      managerId: manager?.uid || null,
      requestNo: `${{ leave: 'LR', departure: 'DR', advance: 'AR', sick: 'SR' }[item.type]}-${new Date().getFullYear()}-${String(index).padStart(4, '0')}`,
      decidedBy: ['approved', 'rejected'].includes(item.status) ? manager?.uid : null,
      decidedAt: ['approved', 'rejected'].includes(item.status) ? days(-2) : null,
      submittedAt: item.status === 'draft' ? null : days(-4),
      demo: true,
      createdAt: days(-5),
      updatedAt: now
    });

    if (item.status !== 'draft') {
      await doc.collection('thread').add({
        authorId: employee.uid,
        authorName: employee.displayName,
        body: 'مرحباً، أرجو النظر في الطلب في أقرب وقت ممكن. شكراً لكم.',
        createdAt: days(-4)
      });
      if (item.managerResponse) {
        await doc.collection('thread').add({
          authorId: manager?.uid || null,
          authorName: manager?.displayName || '',
          body: item.managerResponse,
          createdAt: days(-2)
        });
      }
    }
    index++;
  }
  console.log(`   ✔ ${items.length} requests`);
}

async function seedCalendar(employees, clients) {
  console.log('\n📅 Creating calendar events…');
  const manager = employees.find((e) => e.accountRole === 'manager');

  const events = [
    { title: 'اجتماع الفريق الأسبوعي', type: 'meeting', startAt: hours(24), endAt: hours(25),
      location: 'قاعة الاجتماعات — الطابق الثاني',
      description: 'مراجعة مهام الأسبوع وتوزيع المهام الجديدة.' },
    { title: 'جلسة تصوير — بيت السدو', type: 'event', startAt: hours(48), endAt: hours(52),
      location: 'فرع عبدون',
      description: 'تصوير الأطباق الجديدة، يرجى إحضار الإضاءة المحمولة.' },
    { title: 'تسليم الهوية البصرية — الأفق', type: 'deadline', startAt: days(5), endAt: days(5),
      location: 'أونلاين',
      description: 'تسليم دليل الهوية البصرية النهائي للعميل.' },
    { title: 'عرض تقديمي للعميل — عيادات نور', type: 'meeting', startAt: days(3), endAt: days(3),
      location: 'مكتب العميل — الشميساني',
      description: 'عرض خطة المحتوى للربع القادم.' },
    { title: 'ورشة تدريب على أدوات المونتاج', type: 'event', startAt: days(8), endAt: days(8),
      location: 'استوديو لوما',
      description: 'ورشة داخلية لفريق الإنتاج.' }
  ];

  for (const event of events) {
    await db.collection('calendarEvents').add({
      ...event,
      visibility: 'team',
      participants: employees.slice(0, 5).map((e) => e.uid),
      clientId: pick(clients).id,
      createdBy: manager?.uid || employees[0].uid,
      demo: true,
      createdAt: now,
      updatedAt: now
    });
  }
  console.log(`   ✔ ${events.length} events`);
}

async function seedChats(employees) {
  console.log('\n💬 Creating chat rooms and messages…');
  const manager = employees.find((e) => e.accountRole === 'manager');
  const memberNames = Object.fromEntries(employees.map((e) => [e.uid, e.displayName]));

  const general = await db.collection('chats').add({
    type: 'group',
    name: 'الفريق العام',
    members: employees.map((e) => e.uid),
    memberNames,
    unread: {},
    createdBy: manager?.uid,
    demo: true,
    createdAt: now,
    lastMessage: '',
    lastMessageAt: now
  });

  const creative = await db.collection('chats').add({
    type: 'department',
    name: 'القسم الإبداعي',
    members: employees.filter((e) => ['creative', 'media'].includes(e.department)).map((e) => e.uid),
    memberNames,
    unread: {},
    createdBy: manager?.uid,
    demo: true,
    createdAt: now,
    lastMessage: '',
    lastMessageAt: now
  });

  const messages = [
    { chat: general, from: manager, body: 'صباح الخير جميعاً 👋 تذكير باجتماع الفريق غداً الساعة 10 صباحاً.' },
    { chat: general, from: employees[1], body: 'تمام، سأجهز عرض التصاميم قبل الاجتماع.' },
    { chat: general, from: employees[3], body: 'تم تحديث السيرفر ليلة أمس، كل شيء يعمل بشكل ممتاز.' },
    { chat: general, from: employees[6], body: 'وصلنا طلب عرض سعر من عميل جديد في إربد، سأشارك التفاصيل اليوم.' },
    { chat: creative, from: employees[2], body: 'هل الهوية الجديدة لعيادات نور معتمدة نهائياً؟' },
    { chat: creative, from: manager, body: 'نعم معتمدة، الملفات على الدرايف في مجلد Brand 2026.' },
    { chat: creative, from: employees[4], body: 'ممتاز، سأبدأ بجلسة التصوير حسب الهوية الجديدة.' }
  ];

  for (const message of messages) {
    await message.chat.collection('messages').add({
      senderId: message.from.uid,
      senderName: message.from.displayName,
      body: message.body,
      attachment: null,
      replyTo: null,
      readBy: [message.from.uid],
      deleted: false,
      createdAt: days(-Math.random())
    });
  }

  await general.set({ lastMessage: messages[3].body.slice(0, 80), lastMessageAt: now }, { merge: true });
  await creative.set({ lastMessage: messages[6].body.slice(0, 80), lastMessageAt: now }, { merge: true });

  console.log(`   ✔ 2 rooms, ${messages.length} messages`);
}

async function seedBreaks(employees) {
  console.log('\n☕ Creating break history…');
  let count = 0;
  for (const employee of employees) {
    for (let d = 1; d <= 5; d++) {
      const start = new Date(Date.now() - d * 86_400_000);
      start.setHours(12, 30, 0, 0);
      const duration = (25 + Math.floor(Math.random() * 25)) * 60_000;
      await db.collection('breakSessions').add({
        userId: employee.uid,
        dayKey: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(start),
        reason: '',
        startedAt: start,
        endedAt: new Date(start.getTime() + duration),
        durationMs: duration,
        demo: true
      });
      count++;
    }
  }
  console.log(`   ✔ ${count} break sessions`);
}

function dateStr(offset) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  console.log(`\n🌱 Seeding demo data into ${PROJECT_ID}\n`);
  if (RESET) await reset();

  const employees = await seedEmployees();
  const clients = await seedClients(employees);
  await seedTasks(employees, clients);
  await seedRequests(employees);
  await seedCalendar(employees, clients);
  await seedChats(employees);
  await seedBreaks(employees);

  console.log(`
✅ Demo data ready.

   Test accounts (all use the value of LUMA_DEMO_PASSWORD, and all are forced
   to change it at first login):

${EMPLOYEES.map((e) =>
  `     ${e.username.padEnd(16)} ${e.displayName.padEnd(16)} — ${e.accountRole}`).join('\n')}

   Note: no credentials were added to the encrypted vault — add those manually
   from a client profile so the encryption key is exercised properly.
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Demo seeding failed:', err);
    process.exit(1);
  });
