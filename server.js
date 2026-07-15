const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const EXAMS_FILE = path.join(DATA_DIR, 'exams.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const ADS_FILE = path.join(DATA_DIR, 'ads.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
[EXAMS_FILE, USERS_FILE, SUBMISSIONS_FILE].forEach(f => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '[]', 'utf-8');
});
if (!fs.existsSync(ADS_FILE)) {
  const defaultPositions = ['top-page','after-nav','before-form','in-form','after-submit','bottom-page','dashboard-top','dashboard-side','exam-top','exam-between','exam-after','auth-bottom'];
  const positions = {};
  defaultPositions.forEach(p => { positions[p] = { type: 'placeholder', code: '', label: 'إعلان' }; });
  fs.writeFileSync(ADS_FILE, JSON.stringify({ enabled: true, positions }, null, 2), 'utf-8');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'exam-generator-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
  try {
    res.locals.ads = JSON.parse(fs.readFileSync(ADS_FILE, 'utf-8'));
  } catch {
    res.locals.ads = { enabled: false };
  }
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return []; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
function loadExams() { return loadJSON(EXAMS_FILE); }
function saveExams(d) { saveJSON(EXAMS_FILE, d); }
function loadUsers() { return loadJSON(USERS_FILE); }
function saveUsers(d) { saveJSON(USERS_FILE, d); }
function loadSubmissions() { return loadJSON(SUBMISSIONS_FILE); }
function saveSubmissions(d) { saveJSON(SUBMISSIONS_FILE, d); }

function isAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function getAuthUser(req) {
  if (!req.session.userId) return null;
  return loadUsers().find(u => u.id === req.session.userId);
}

app.get('/', isAuth, (req, res) => {
  res.render('create', { user: getAuthUser(req) });
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.render('register', { error: 'جميع الحقول مطلوبة' });
  }
  const users = loadUsers();
  if (users.find(u => u.email === email)) {
    return res.render('register', { error: 'البريد الإلكتروني مستخدم من قبل' });
  }
  const user = {
    id: uuidv4().slice(0, 12), name, email,
    password: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);
  req.session.userId = user.id;
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('login', { error: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
  }
  const user = loadUsers().find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'بريد إلكتروني أو كلمة مرور غير صحيحة' });
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/dashboard', isAuth, (req, res) => {
  const user = getAuthUser(req);
  const exams = loadExams().filter(e => e.userId === user.id);
  const submissions = loadSubmissions().filter(s => exams.find(e => e.id === s.examId));
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const subsWithExam = submissions.map(s => {
    const exam = exams.find(e => e.id === s.examId);
    return { ...s, examTitle: exam ? exam.title : '', questions: exam ? exam.questions : [] };
  });
  res.render('dashboard', { user, exams, submissions: subsWithExam, baseUrl });
});

app.get('/exam/:id', (req, res) => {
  const exams = loadExams();
  const exam = exams.find(e => e.id === req.params.id);
  if (!exam) {
    return res.render('exam', { exam: null, error: 'الامتحان غير موجود', submitted: false });
  }
  res.render('exam', { exam, error: null, submitted: false });
});

app.post('/api/exams', isAuth, (req, res) => {
  const { title, questions } = req.body;
  if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'الرجاء إدخال عنوان الامتحان والأسئلة' });
  }
  const id = uuidv4().slice(0, 8);
  const exam = {
    id, userId: req.session.userId, title,
    questions: questions.map((q, i) => ({
      id: i + 1,
      text: q.text || '',
      type: q.type || 'text',
      options: Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? q.options.split(/[,;\s]+/).filter(Boolean) : []),
      answer: q.answer || ''
    })),
    createdAt: new Date().toISOString()
  };
  const exams = loadExams();
  exams.push(exam);
  saveExams(exams);
  res.json({ id, url: `/exam/${id}` });
});

app.get('/api/exams/:id', (req, res) => {
  const exam = loadExams().find(e => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: 'الامتحان غير موجود' });
  res.json(exam);
});

app.post('/api/exams/:id/submit', (req, res) => {
  const exams = loadExams();
  const exam = exams.find(e => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: 'الامتحان غير موجود' });

  const { studentName, answers } = req.body;
  if (!answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'بيانات الإجابات غير صالحة' });
  }

  let correct = 0;
  const total = exam.questions.length;
  const graded = answers.map(a => {
    const q = exam.questions.find(q => q.id === a.questionId);
    const isCorrect = q && q.answer && a.answer && q.answer.trim().toLowerCase() === a.answer.trim().toLowerCase();
    if (isCorrect) correct++;
    return { questionId: a.questionId, answer: a.answer, correct: !!isCorrect };
  });

  const submissions = loadSubmissions();
  submissions.push({
    id: uuidv4().slice(0, 8),
    examId: req.params.id,
    studentName: studentName || 'طالب مجهول',
    answers: graded,
    score: correct, total,
    percentage: Math.round((correct / total) * 100),
    submittedAt: new Date().toISOString()
  });
  saveSubmissions(submissions);
  res.json({ success: true, percentage: Math.round((correct / total) * 100) });
});

app.get('/api/exams/:id/submissions', isAuth, (req, res) => {
  const exam = loadExams().find(e => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: 'الامتحان غير موجود' });
  if (exam.userId !== req.session.userId) return res.status(403).json({ error: 'غير مصرح' });
  res.json(loadSubmissions().filter(s => s.examId === req.params.id));
});

app.get('/settings/ads', isAuth, (req, res) => {
  res.render('ads-settings', { user: getAuthUser(req), saved: false });
});

const AD_POSITIONS = ['top-page','after-nav','before-form','in-form','after-submit','bottom-page','dashboard-top','dashboard-side','exam-top','exam-between','exam-after','auth-bottom'];

app.post('/settings/ads', isAuth, (req, res) => {
  const positions = {};
  AD_POSITIONS.forEach(p => {
    positions[p] = {
      type: req.body[p + 'Type'] || 'placeholder',
      code: req.body[p + 'Code'] || '',
      label: req.body[p + 'Label'] || 'إعلان'
    };
  });
  fs.writeFileSync(ADS_FILE, JSON.stringify({ enabled: req.body.enabled === 'on', positions }, null, 2), 'utf-8');
  res.render('ads-settings', { user: getAuthUser(req), saved: true });
});

app.listen(PORT, () => {
  console.log(`✓ مولد الامتحانات شغال على http://localhost:${PORT}`);
});
