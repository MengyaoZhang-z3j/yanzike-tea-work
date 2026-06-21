const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'submissions.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const TASK_LABELS = {
  task1: '任务一：自然密码',
  task2: '任务二：科技密码',
  task3: '任务三：产业密码',
  task4: '任务四：发展密码'
};
const TASK_MAX = { task1: 30, task2: 25, task3: 10, task4: 20 };

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}
function readRecords() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8') || '[]';
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_err) {
    return [];
  }
}
function writeRecords(list) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(Array.isArray(list) ? list : [], null, 2), 'utf8');
}
function clean(v, fallback = '') {
  return String(v ?? fallback).trim() || fallback;
}
function clampScore(score, max) {
  const s = Number(score);
  const m = Number(max);
  if (!Number.isFinite(s)) return 0;
  if (!Number.isFinite(m) || m <= 0) return Math.max(0, s);
  return Math.max(0, Math.min(m, s));
}
function buildIssues(taskId, score, max) {
  const pct = max ? score / max : 0;
  const issues = [];
  if (taskId === 'task1') {
    if (score < 30) issues.push('自然条件提取不完整，容易漏掉地形、气候、土壤等关键条件');
    if (score < 22) issues.push('自然条件与茶叶生长影响之间的因果表达不够清楚');
    if (score < 15) issues.push('材料信息转化为地理语言的能力较弱');
  } else if (taskId === 'task2') {
    if (score < 25) issues.push('科技措施与生态效益、品质提升之间的对应关系不够准确');
    if (score < 17) issues.push('对套种绿肥、智慧监测等技术作用理解不够完整');
    if (score < 12) issues.push('生态农业中“科技—生态—效益”的逻辑链表达较弱');
  } else if (taskId === 'task3') {
    if (score < 10) issues.push('社会经济因素与材料证据之间的匹配还需加强');
    if (score < 7) issues.push('对政策、市场、交通、旅游文化等产业发展因素理解不够完整');
  } else if (taskId === 'task4') {
    if (score < 20) issues.push('生态、科技与可持续发展方案之间的综合表达还需加强');
    if (score < 14) issues.push('方案设计中对实施效果或注意事项说明不够充分');
  }
  if (!issues.length && pct >= 0.85) issues.push('整体完成较好，能较好理解本任务核心内容');
  return issues;
}
function normalizeTaskId(body = {}) {
  let taskId = clean(body.taskId || body.task || body.task_id || '');
  // 兼容任务二旧版“整份作业记录”：没有 taskId，但有 finalScore / task2 / optional 等字段
  if (!TASK_MAX[taskId]) {
    if (body.finalScore !== undefined || body.task2 || body.optional || body.t1 || body.t3) taskId = 'task2';
  }
  return TASK_MAX[taskId] ? taskId : '';
}
function isBlankStudent(name, cls, group) {
  const n = clean(name), c = clean(cls), g = clean(group);
  return !n || n === '未填写姓名' || n === '未命名学生' || !c || c === '未填写班级' || c === '未填写' || !g || g === '未填写小组' || g === '未填写';
}
function normalizeRecord(body = {}) {
  const student = body.student || {};
  const taskId = normalizeTaskId(body);
  if (!taskId) return null;
  const max = Number(body.max ?? TASK_MAX[taskId] ?? 0);
  const score = clampScore(body.score ?? body.finalScore ?? 0, max);
  const name = clean(body.name || body.studentName || student.name, '未填写姓名');
  // 兼容旧字段 class，避免同一学生因为 class/cls 字段不同被拆成多组
  const cls = clean(body.cls || body.class || body.className || body.studentClass || student.cls || student.class || student.className, '未填写班级');
  const group = clean(body.group || body.studentGroup || student.group, '未填写小组');

  // 未填写完整身份的信息不进入教师端，避免“空学生/空小组”占位记录
  if (isBlankStudent(name, cls, group)) return null;

  // 只有真实提交记录才进入服务器。未完成的即时进度、空记录不保存。
  if (body.done === false && !(Number(body.score) > 0 || Number(body.finalScore) > 0)) return null;
  // 任务四包含第1小题临时分和AI等待时的临时数字；服务器只保存最终提交产生的总分。
  if (taskId === 'task4' && !(body.done !== false && body.final === true)) return null;

  const key = [name, cls, group, taskId].join('|');
  const issues = Array.isArray(body.issues) && body.issues.length ? body.issues : buildIssues(taskId, score, max);
  const now = new Date().toISOString();
  return {
    ...body,
    key,
    name,
    cls,
    group,
    taskId,
    taskTitle: body.taskTitle || TASK_LABELS[taskId] || taskId,
    score,
    max,
    done: body.done !== false,
    time: body.time || new Date().toLocaleString('zh-CN', { hour12: false }),
    issues,
    createdAt: body.createdAt || now,
    updatedAt: now
  };
}
function validStoredRecord(r) {
  if (!(r && TASK_MAX[r.taskId] && !isBlankStudent(r.name, r.cls || r.class || r.className, r.group) && Number.isFinite(Number(r.score)))) return false;
  // 任务四旧的临时分记录不再显示，避免教师端分数在临时分和最终分之间跳动。
  if (r.taskId === 'task4' && r.final !== true) return false;
  return true;
}
function publicRecords() {
  const map = new Map();
  for (const r of readRecords()) {
    if (!validStoredRecord(r)) continue;
    const cls = clean(r.cls || r.class || r.className, '未填写班级');
    const key = [clean(r.name), cls, clean(r.group), r.taskId].join('|');
    const nr = { ...r, cls, key };
    const old = map.get(key);
    if (!old || String(nr.updatedAt || nr.createdAt || nr.time || '') >= String(old.updatedAt || old.createdAt || old.time || '')) {
      map.set(key, nr);
    }
  }
  return Array.from(map.values()).sort((a, b) => String(b.updatedAt || b.createdAt || b.time || '').localeCompare(String(a.updatedAt || a.createdAt || a.time || '')));
}
function upsertRecords(incoming) {
  const list = publicRecords();
  const map = new Map();
  for (const r of list) {
    if (r && r.key) map.set(r.key, r);
  }
  const records = Array.isArray(incoming) ? incoming : [incoming];
  const saved = [];
  const ignored = [];
  for (const raw of records) {
    const rec = normalizeRecord(raw || {});
    if (!rec) { ignored.push(raw); continue; }
    const old = map.get(rec.key) || {};
    const merged = { ...old, ...rec, createdAt: old.createdAt || rec.createdAt, updatedAt: rec.updatedAt };
    map.set(rec.key, merged);
    saved.push(merged);
  }
  const arr = Array.from(map.values()).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  writeRecords(arr);
  return { records: arr, saved, ignored };
}


app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'yanzike-full-task1-task2-task3-task4', serverCollection: true });
});

// 教师端读取所有学生、所有设备提交的数据
app.get('/api/submissions', (_req, res) => {
  res.json(publicRecords());
});

// 学生提交任一任务后统一写入服务器；同一学生同一任务会更新，不会重复堆叠
app.post('/api/submissions', (req, res) => {
  try {
    const payload = req.body && Array.isArray(req.body.records) ? req.body.records : req.body;
    const result = upsertRecords(payload);
    res.json({ ok: true, count: result.records.length, saved: result.saved });
  } catch (err) {
    res.status(500).json({ ok: false, error: '保存提交数据失败', detail: err.message });
  }
});
app.post('/api/submissions/upsert', (req, res) => {
  try {
    const payload = req.body && Array.isArray(req.body.records) ? req.body.records : req.body;
    const result = upsertRecords(payload);
    res.json({ ok: true, count: result.records.length, saved: result.saved });
  } catch (err) {
    res.status(500).json({ ok: false, error: '保存提交数据失败', detail: err.message });
  }
});
// 兼容任务三旧接口
app.post('/api/submit', (req, res) => {
  try {
    const result = upsertRecords(req.body || {});
    res.json({ ok: true, count: result.records.length, record: result.saved[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: '保存提交数据失败', detail: err.message });
  }
});
// 兼容部分旧版演示数据写入接口
app.post('/api/submissions/seed', (req, res) => {
  try {
    const result = upsertRecords((req.body && req.body.records) || []);
    res.json({ ok: true, count: result.records.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: '写入数据失败', detail: err.message });
  }
});
app.delete('/api/submissions', (req, res) => {
  const taskId = req.query.taskId;
  const name = req.query.name;
  const cls = req.query.cls;
  const group = req.query.group;
  if (taskId || name || cls || group) {
    const rest = publicRecords().filter(r => {
      if (taskId && r.taskId !== taskId) return true;
      if (name && r.name !== name) return true;
      if (cls && r.cls !== cls) return true;
      if (group && r.group !== group) return true;
      return false;
    });
    writeRecords(rest);
    return res.json({ ok: true, count: rest.length });
  }
  writeRecords([]);
  res.json({ ok: true });
});
app.post('/api/clear', (req, res) => {
  const key = req.query.key || (req.body && req.body.key);
  if (key && key !== '12345' && key !== process.env.TEACHER_KEY) {
    return res.status(403).json({ ok: false, error: '教师口令错误' });
  }
  writeRecords([]);
  res.json({ ok: true });
});

app.post('/api/task2-optional-ai-score', async (req, res) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok: false, fallback: true, error: 'DeepSeek API Key 未配置，已启用本地规则兜底评分。' });
    }

    const {
      product = '',
      otherProduct = '',
      checked = [],
      custom = '',
      text = '',
      localScore = 0
    } = req.body || {};

    const prompt = `你是一名初中地理作业评价助手。请评价“任务二选做题：迁移提升”。

题目：学生选择一种家乡农产品或农业场景，并为它设计“生态+科技”农业发展方案。页面提供的可选措施包括：套种绿肥作物、减少化肥农药、保护生物多样性、使用智慧监测设备、发展生态品牌、发展研学或乡村旅游；学生也可以在“其他补充措施”中手动填写自己的做法。

满分5分，评分标准：
1. 能选择一种具体家乡农产品或农业场景，0-1分；
2. 方案中能体现生态措施，如套种绿肥、减少化肥农药、保护生物多样性、生态品牌、研学或乡村旅游等，0-1分；
3. 方案中能体现科技措施或智慧管理，如智慧监测、智慧灌溉、病虫害预警、手机查看数据、数字平台、节水设施等，0-1分；
4. 农业方案描述较详细，能说清楚具体做法、实施过程或应用场景，0-1分；
5. 表述合理，能说明方案带来的生态、经济、品质提升或农民增收等效果，0-1分。

请按0-5分评分，允许整数分。评价要鼓励学生，并指出可以补充的方向。不要因为文字不长而过度扣分，只要勾选、补充内容和方案表达能体现相应要点，也可以给分。

学生作答：
农产品或农业场景：${product || otherProduct}
勾选措施：${Array.isArray(checked) ? checked.join('、') : String(checked || '')}
其他补充措施：${custom}
方案表达：${text}
本地规则初评分：${localScore}/5，可作为参考。

必须只返回JSON，不要输出其他文字。JSON格式：
{
  "score": 0,
  "level": "优秀/良好/合格/待提升",
  "comment": "给学生的一句话评价",
  "suggestion": "具体改进建议",
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"]
}`;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是严谨、鼓励性的初中地理作业评分助手，只输出JSON。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        stream: false
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ ok: false, fallback: true, error: 'DeepSeek 调用失败，已启用本地规则兜底评分。', detail: data });
    }

    let content = data?.choices?.[0]?.message?.content || '{}';
    let result;
    try {
      result = JSON.parse(content);
    } catch (_err) {
      const match = String(content).match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : {};
    }

    let score = Math.round(Number(result.score || 0));
    score = Math.max(0, Math.min(5, score));

    res.json({
      ok: true,
      source: 'DeepSeek AI',
      score,
      level: result.level || (score >= 5 ? '优秀' : score >= 4 ? '良好' : score >= 3 ? '合格' : '待提升'),
      comment: result.comment || 'AI已完成评价。',
      suggestion: result.suggestion || '可以继续补充生态措施和科技应用的具体做法。',
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : []
    });
  } catch (err) {
    res.status(500).json({ ok: false, fallback: true, error: 'AI评分异常，已启用本地规则兜底评分。', detail: err.message });
  }
});

app.post('/api/task4-ai-score', async (req, res) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ ok: false, fallback: true, error: 'DeepSeek API Key 未配置，已启用本地规则兜底评分。' });
    }

    const {
      planChoice = '',
      planBenefit = '',
      planNotice = '',
      planText = '',
      localScore = 0
    } = req.body || {};

    const prompt = `你是一名初中地理作业评价助手。请评价“任务四第2小题：小小茶园规划师”。

题目：学生从A生态套种、B智慧茶园管理系统、C茶旅融合精品线路中选择一种方案，并补充“这样做有利于……”和“但还要注意……”，形成完整表达。

满分13分，评分建议：
1. 选择方案明确、与题目相关：0-2分；
2. 能说明有利作用，如生态保护、科技赋能、品质提升、文化传承、市场增收、茶旅融合等：0-4分；
3. 能指出注意事项，如防止过度开发、控制成本、保护生态、数据维护、尊重农民意愿、保证安全等：0-4分；
4. 表达完整，能形成“我选择……这样做有利于……但还要注意……”的完整句：0-3分。

请严格按0-13分评分，允许整数分。不要因为表述不完全一致而扣过多分，重在判断地理思维、生态意识、科技应用和可持续发展意识。

学生作答：
选择方案：${planChoice}
这样做有利于：${planBenefit}
但还要注意：${planNotice}
完整表达：${planText}

本地规则初评分：${localScore}/13，可作为参考，但你可以根据表达质量调整。

必须只返回JSON，不要输出其他文字。JSON格式：
{
  "score": 0,
  "level": "优秀/良好/合格/待提升",
  "comment": "给学生的一句话评价",
  "suggestion": "具体改进建议",
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"]
}`;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是严谨、鼓励性的初中地理作业评分助手，只输出JSON。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        stream: false
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(502).json({ ok: false, fallback: true, error: 'DeepSeek 调用失败，已启用本地规则兜底评分。', detail: data });
    }

    let content = data?.choices?.[0]?.message?.content || '{}';
    let result;
    try {
      result = JSON.parse(content);
    } catch (_err) {
      const match = String(content).match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : {};
    }

    let score = Math.round(Number(result.score || 0));
    score = Math.max(0, Math.min(13, score));

    res.json({
      ok: true,
      source: 'DeepSeek AI',
      score,
      level: result.level || (score >= 12 ? '优秀' : score >= 10 ? '良好' : score >= 7 ? '合格' : '待提升'),
      comment: result.comment || 'AI已完成评价。',
      suggestion: result.suggestion || '可以继续补充生态保护、科技应用和可持续发展方面的具体措施。',
      strengths: Array.isArray(result.strengths) ? result.strengths : [],
      weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : []
    });
  } catch (err) {
    res.status(500).json({ ok: false, fallback: true, error: 'AI评分异常，已启用本地规则兜底评分。', detail: err.message });
  }
});

app.delete('/api/submissions', (_req, res) => {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`燕子窠四任务作业已启动：http://localhost:${PORT}`);
});
