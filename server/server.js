'use strict';
/**
 * r6t5-docs 自托管服务（Docker 版）
 * ---------------------------------------------------------------
 * 同一份镜像两种形态：
 *   - 社区版（未输入产品密钥）：署名逐字符锁定，页脚显示推广提示
 *   - 专业版（管理员输入有效密钥后）：可编辑署名、隐藏推广提示
 * 管理员入口 /admin，密码首次启动自动生成并打印在容器日志。
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname + '/..';
const SEED_DIR = path.join(ROOT, 'public');
const ADMIN_DIR = path.join(ROOT, 'admin');
const DATA_DIR = process.env.DATA_DIR || '/data';
const SITE_DIR = path.join(DATA_DIR, 'site');
const PORT = Number(process.env.PORT || 8080);
const LICENSE_API = (process.env.LICENSE_API || 'https://lic.r6t5.dpdns.org').replace(/\/$/, '');
const SITE_HOST = (process.env.SITE_HOST || '').trim();

const CANON = {
  name: 'r6t5-docs',
  base: '本站由r6t5-docs提供支持',
  proNote: '，使用专业版、订制版可去除本标志',
  canonical: '本站由r6t5-docs提供支持，使用专业版、订制版可去除本标志',
  templateUrl: 'https://github.com/TanchiPanda/r6t5-docs-community',
};

const P = {
  site: path.join(DATA_DIR, 'site.json'),
  tree: path.join(DATA_DIR, 'tree.json'),
  license: path.join(DATA_DIR, 'license.json'),
  licenses: path.join(DATA_DIR, 'licenses.json'), // 域名/仓库授权清单
  admin: path.join(DATA_DIR, 'admin.json'),
};

// 只做“记录值对不对”的判断，不查域名是否存在
const DNS_ENDPOINT = process.env.DNS_ENDPOINT || 'https://cloudflare-dns.com/dns-query';

const sessions = new Map(); // sid -> {until}

/* ---------------- 基础工具 ---------------- */

const readJson = (p, def) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return def; }
};
const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
};

function send(res, code, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(code, h);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function sendFile(res, file, ctype) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { ok: false, error: 'not found' });
    res.writeHead(200, {
      'Content-Type': ctype,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "frame-ancestors 'self'",
    });
    res.end(buf);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function body(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); }
    });
  });
}

function host(req) {
  if (SITE_HOST) return SITE_HOST;
  const h = String(req.headers.host || 'localhost');
  return h.split(':')[0].toLowerCase();
}

/* ---------------- 初始化 ---------------- */

function bootstrap() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SITE_DIR)) {
    fs.cpSync(SEED_DIR, SITE_DIR, { recursive: true });
    console.log('[init] 已初始化站点目录:', SITE_DIR);
  }
  if (!fs.existsSync(P.site)) {
    writeJson(P.site, {
      title: 'r6t5 文档',
      repo: '用户名/仓库名',
      defaultPath: 'docs/index.md',
    });
  }
  if (!fs.existsSync(P.tree)) {
    const m = readJson(path.join(SITE_DIR, 'manifest.json'), { tree: [] });
    writeJson(P.tree, { tree: m.tree || [] });
  }
  if (!fs.existsSync(P.license)) writeJson(P.license, { mode: 'community', key: '', host: '', activatedAt: 0 });
  if (!fs.existsSync(P.licenses)) writeJson(P.licenses, { domains: [], repos: [] });
  ensureAdmin();
  syncManifest();
}

function ensureAdmin() {
  if (fs.existsSync(P.admin)) return;
  const password = process.env.ADMIN_PASSWORD || genPassword();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  writeJson(P.admin, { salt, hash, createdAt: Date.now() });
  const banner = [
    '',
    '============================================================',
    '  r6t5-docs 管理后台已初始化',
    '  地址：http://<你的域名>:<端口>/admin',
    '  初始密码：' + password,
    '  （只显示这一次，已另存到 ' + path.join(DATA_DIR, 'ADMIN_PASSWORD.txt') + '）',
    '  如需重置：删除 ' + P.admin + ' 后重启容器',
    '============================================================',
    '',
  ].join('\n');
  console.log(banner);
  try {
    fs.writeFileSync(path.join(DATA_DIR, 'ADMIN_PASSWORD.txt'), password + '\n', { mode: 0o600 });
  } catch (_) {}
}

function genPassword() {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let i = 0; i < 16; i++) s += A[crypto.randomInt(0, 32)];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
}

/* ---------------- 目录/树 ---------------- */

function walkDocs(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) walkDocs(full, r, out);
    else if (name.endsWith('.md')) out.push({ path: 'docs/' + r, size: st.size, mtime: st.mtimeMs });
  }
  return out;
}

function listDocs() {
  const dir = path.join(SITE_DIR, 'docs');
  if (!fs.existsSync(dir)) return [];
  return walkDocs(dir, '', []).sort((a, b) => a.path.localeCompare(b.path));
}

function syncManifest() {
  const tree = readJson(P.tree, { tree: [] }).tree;
  const docs = new Set(listDocs().map((d) => d.path));
  const used = new Set();
  const clean = tree.map((g) => ({
    title: g.title,
    children: (g.children || []).filter((c) => {
      if (!docs.has(c.path)) return false;
      used.add(c.path);
      return true;
    }),
  }));
  const rest = [...docs].filter((p) => !used.has(p));
  if (rest.length) clean.push({ title: '未分类', children: rest.map((p) => ({ title: docTitle(p), path: p })) });
  writeJson(path.join(SITE_DIR, 'manifest.json'), { tree: clean });
  return clean;
}

function docTitle(p) {
  try {
    const txt = fs.readFileSync(path.join(SITE_DIR, p), 'utf8');
    const h1 = txt.match(/^\s*#\s+(.+)$/m);
    return h1 ? h1[1].trim() : path.basename(p, '.md');
  } catch (_) { return path.basename(p, '.md'); }
}

/* ---------------- 站点配置 ---------------- */

/* ---------------- 域名 / 仓库授权（DNS TXT 证明） ---------------- */

const licStore = () => readJson(P.licenses, { domains: [], repos: [] });

function normHost(h) {
  return String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

function hostCovered(host) {
  const h = normHost(host);
  if (!h) return false;
  return licStore().domains.some((d) => d.status === 'verified' && (h === d.host || h.endsWith('.' + d.host)));
}

async function fetchTxt(name) {
  try {
    const url = DNS_ENDPOINT + '?name=' + encodeURIComponent(name) + '&type=TXT';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.Answer || [])
      .filter((a) => a.type === 16 || a.type === 'TXT')
      .map((a) => String(a.data).replace(/\\"/g, '"').replace(/^"/, '').replace(/"$/, ''));
  } catch (_) { return []; }
}

async function verifyDomainToken(host, token) {
  const expect = 'r6t5-verify=' + token;
  for (const n of ['_r6t5-verify.' + host, host]) {
    const txts = await fetchTxt(n);
    if (txts.some((x) => x.trim() === expect)) return true;
  }
  return false;
}

function proReasons(host) {
  const lic = readJson(P.license, {});
  const reasons = [];
  if (lic.mode === 'pro') reasons.push('密钥');
  const l = licStore();
  if (host ? hostCovered(host) : l.domains.some((d) => d.status === 'verified')) reasons.push('域名');
  if (l.repos.length) reasons.push('仓库');
  return reasons;
}

function isPro(host) {
  // 三种授权来源：产品密钥 / 已验证域名（当前 host 匹配其本身或子域）/ 授权仓库
  return proReasons(host).length > 0;
}

function siteConfig(host) {
  const s = readJson(P.site, {});
  const canon = CANON;
  const att = isPro(host)
    ? Object.assign({}, canon, s.attribution || {})
    : Object.assign({}, canon); // 社区版：无论存了什么，都强制用标准署名
  return {
    title: s.title || 'r6t5 文档',
    repo: s.repo || '用户名/仓库名',
    defaultPath: s.defaultPath || 'docs/index.md',
    attribution: att,
    pro: isPro(host),
  };
}

function renderIndex(host) {
  const cfg = siteConfig(host);
  let html = fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
  const inject = '<script>window.R6T5=' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';</script>\n</head>';
  html = html.replace('</head>', inject);
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + cfg.title.replace(/</g, '&lt;') + '</title>');
  return html;
}

/* ---------------- 登录 ---------------- */

function makeSid() {
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { until: Date.now() + 12 * 3600 * 1000 });
  return sid;
}

function getSid(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/r6t5sid=([a-f0-9]{64})/);
  return m ? m[1] : '';
}

function authed(req) {
  const sid = getSid(req);
  const s = sessions.get(sid);
  if (!s) return false;
  if (s.until < Date.now()) { sessions.delete(sid); return false; }
  return true;
}

function checkPassword(pw) {
  const a = readJson(P.admin, {});
  if (!a.salt) return false;
  const h = crypto.createHash('sha256').update(a.salt + String(pw || '')).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(a.hash, 'hex'));
  } catch (_) { return false; }
}

/* ---------------- 密钥校验 ---------------- */

async function activateKey(key) {
  const raw = String(key || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (raw.length !== 15) throw new Error('密钥应为 15 位');
  const host = SITE_HOST || 'localhost';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(LICENSE_API + '/api/license/redeem-host', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: raw, host }),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || ('授权服务返回 HTTP ' + r.status));
    writeJson(P.license, { mode: 'pro', key: raw, host, activatedAt: Date.now() });
    return { host: host, product: d.product || 'docs-pro' };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('授权服务连接超时（检查网络或 LICENSE_API）');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/* ---------------- 版权/署名完整性校验 ---------------- */

const PROTECTED = [
  { rel: 'site/index.html', seed: 'public/index.html', label: '站点模板（含署名守卫）' },
  { rel: 'site/LICENSE', seed: 'public/LICENSE', label: '授权条款 LICENSE' },
];

const hashCache = new Map();
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileStatus(rel, seedRel) {
  const full = path.join(DATA_DIR, rel);
  const seed = path.join(ROOT, seedRel);
  if (!fs.existsSync(full)) return { rel: rel, ok: false, reason: '文件缺失' };
  const st = fs.statSync(full);
  const key = rel;
  const c = hashCache.get(key);
  if (c && c.mtime === st.mtimeMs && c.size === st.size) return c.val;
  let val;
  try {
    const a = sha256File(full);
    const b = sha256File(seed);
    val = a === b ? { rel: rel, ok: true } : { rel: rel, ok: false, reason: '内容被修改' };
  } catch (e) {
    val = { rel: rel, ok: false, reason: '无法读取' };
  }
  hashCache.set(key, { mtime: st.mtimeMs, size: st.size, val: val });
  return val;
}

// 署名配置是否被改（只比对“存在且不一致”的字段）
function attributionTampered() {
  const s = readJson(P.site, {});
  const att = s.attribution;
  if (!att || typeof att !== 'object') return null;
  for (const k of ['name', 'base', 'proNote', 'canonical', 'templateUrl']) {
    if (typeof att[k] === 'string' && att[k] !== CANON[k]) return k + '：' + att[k];
  }
  return null;
}

function integrityProblems() {
  const out = [];
  for (const f of PROTECTED) {
    const st = fileStatus(f.rel, f.seed);
    if (!st.ok) out.push(f.label + '（' + f.rel + '）' + st.reason);
  }
  const attDiff = attributionTampered();
  if (attDiff) out.push('页脚署名被改写（' + attDiff + '）');
  return out;
}

/* ---------------- 路径安全 ---------------- */

function safeDocPath(p) {
  const norm = String(p || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!norm.startsWith('docs/') || !norm.endsWith('.md')) return null;
  if (norm.includes('..')) return null;
  return path.join(SITE_DIR, norm);
}

/* ---------------- API ---------------- */

async function api(req, res, url) {
  const p = url.pathname;

  if (p === '/api/admin/login' && req.method === 'POST') {
    const b = await body(req);
    if (!checkPassword(b.password)) return send(res, 401, { ok: false, error: '密码错误' });
    const sid = makeSid();
    return send(res, 200, { ok: true }, {
      'Set-Cookie': 'r6t5sid=' + sid + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200',
    });
  }

  if (p === '/api/admin/logout' && req.method === 'POST') {
    sessions.delete(getSid(req));
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'r6t5sid=; Path=/; Max-Age=0' });
  }

  if (p === '/api/admin/state') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const h = SITE_HOST || host(req);
    const cfg = siteConfig(h);
    const lic = readJson(P.license, {});
    return send(res, 200, {
      ok: true, pro: isPro(h), host: h, license: lic,
      licenses: licStore(), reasons: proReasons(h),
      site: readJson(P.site, {}), attribution: cfg.attribution, canonical: CANON,
      tree: readJson(P.tree, { tree: [] }).tree,
    });
  }

  if (p === '/api/admin/domain/add' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const h = normHost(b.host);
    if (!h || !/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) return send(res, 400, { ok: false, error: '域名格式不正确' });
    const l = licStore();
    if (l.domains.some((d) => d.host === h)) return send(res, 409, { ok: false, error: '该域名已在列表中' });
    const token = crypto.randomBytes(24).toString('hex');
    l.domains.push({ host: h, token: token, status: 'pending', addedAt: Date.now(), verifiedAt: 0 });
    writeJson(P.licenses, l);
    return send(res, 200, {
      ok: true, host: h, token: token,
      recordName: '_r6t5-verify.' + h,
      recordValue: 'r6t5-verify=' + token,
    });
  }

  if (p === '/api/admin/domain/verify' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const h = normHost(b.host);
    const l = licStore();
    const d = l.domains.find((x) => x.host === h);
    if (!d) return send(res, 404, { ok: false, error: '域名不在列表中' });
    if (d.status === 'verified') return send(res, 200, { ok: true, already: true });
    const ok2 = await verifyDomainToken(d.host, d.token);
    if (!ok2) {
      return send(res, 400, {
        ok: false,
        error: '未查到匹配的 TXT 记录（DNS 可能延迟 1–10 分钟）。只比对记录值，不检查域名是否存在。',
        recordName: '_r6t5-verify.' + d.host,
        recordValue: 'r6t5-verify=' + d.token,
      });
    }
    d.status = 'verified';
    d.verifiedAt = Date.now();
    writeJson(P.licenses, l);
    return send(res, 200, { ok: true, host: d.host });
  }

  if (p === '/api/admin/domain/remove' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const l = licStore();
    const h = normHost(b.host);
    l.domains = l.domains.filter((d) => d.host !== h);
    writeJson(P.licenses, l);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/repo/add' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const repo = String(b.repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/^\/+|\/+$/g, '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return send(res, 400, { ok: false, error: '格式应为 owner/repo' });
    const l = licStore();
    if (l.repos.some((r) => r.repo.toLowerCase() === repo.toLowerCase())) return send(res, 409, { ok: false, error: '该仓库已在列表中' });
    l.repos.push({ repo: repo, addedAt: Date.now() });
    writeJson(P.licenses, l);
    return send(res, 200, { ok: true, repo: repo });
  }

  if (p === '/api/admin/repo/remove' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const l = licStore();
    l.repos = l.repos.filter((r) => r.repo !== b.repo);
    writeJson(P.licenses, l);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/key' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    try {
      const r = await activateKey(b.key);
      return send(res, 200, { ok: true, pro: true, host: r.host, product: r.product });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message || '激活失败' });
    }
  }

  if (p === '/api/admin/site' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const s = readJson(P.site, {});
    if (typeof b.title === 'string') s.title = b.title.trim().slice(0, 80) || 'r6t5 文档';
    if (typeof b.repo === 'string') s.repo = b.repo.trim().slice(0, 120);
    if (typeof b.defaultPath === 'string') s.defaultPath = b.defaultPath.trim();
    let attrIgnored = false;
    if (b.attribution && typeof b.attribution === 'object') {
      if (!isPro(SITE_HOST || host(req))) {
        attrIgnored = true; // 社区版：忽略署名修改，其余设置照常保存
      } else {
      const att = Object.assign({}, CANON, s.attribution || {});
      for (const k of ['name', 'base', 'proNote', 'canonical', 'templateUrl']) {
        if (typeof b.attribution[k] === 'string') att[k] = b.attribution[k].slice(0, 300);
      }
      s.attribution = att;
      }
    }
    writeJson(P.site, s);
    return send(res, 200, { ok: true, attrIgnored: attrIgnored });
  }

  if (p === '/api/admin/files') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    return send(res, 200, { ok: true, files: listDocs() });
  }

  if (p === '/api/admin/file' && req.method === 'GET') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const full = safeDocPath(url.searchParams.get('path'));
    if (!full) return send(res, 400, { ok: false, error: '非法路径' });
    try {
      return send(res, 200, { ok: true, path: url.searchParams.get('path'), content: fs.readFileSync(full, 'utf8') });
    } catch (_) { return send(res, 404, { ok: false, error: '文件不存在' }); }
  }

  if (p === '/api/admin/file' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const full = safeDocPath(b.path);
    if (!full) return send(res, 400, { ok: false, error: '非法路径' });
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(b.content || ''), 'utf8');
    syncManifest();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/file/create' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const full = safeDocPath(b.path);
    if (!full) return send(res, 400, { ok: false, error: '路径必须以 docs/ 开头并以 .md 结尾' });
    if (fs.existsSync(full)) return send(res, 409, { ok: false, error: '文件已存在' });
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const title = String(b.title || path.basename(b.path, '.md')).trim();
    fs.writeFileSync(full, '# ' + title + '\n\n', 'utf8');
    const tree = readJson(P.tree, { tree: [] }).tree;
    if (!tree.some((g) => (g.children || []).some((c) => c.path === b.path))) {
      if (!tree.length) tree.push({ title: '文档', children: [] });
      tree[tree.length - 1].children.push({ title: title, path: b.path });
    }
    writeJson(P.tree, { tree: tree });
    syncManifest();
    return send(res, 200, { ok: true, path: b.path });
  }

  if (p === '/api/admin/file/delete' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    const full = safeDocPath(b.path);
    if (!full) return send(res, 400, { ok: false, error: '非法路径' });
    try { fs.unlinkSync(full); } catch (_) {}
    const tree = readJson(P.tree, { tree: [] }).tree;
    tree.forEach((g) => { g.children = (g.children || []).filter((c) => c.path !== b.path); });
    writeJson(P.tree, { tree: tree });
    syncManifest();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/admin/tree' && req.method === 'POST') {
    if (!authed(req)) return send(res, 401, { ok: false, error: '未登录' });
    const b = await body(req);
    if (!Array.isArray(b.tree)) return send(res, 400, { ok: false, error: 'tree 必须是数组' });
    const docs = new Set(listDocs().map((d) => d.path));
    const tree = b.tree.slice(0, 200).map((g) => ({
      title: String(g.title || '未命名分组').slice(0, 60),
      children: (g.children || []).slice(0, 300).filter((c) => docs.has(c.path))
        .map((c) => ({ title: String(c.title || docTitle(c.path)).slice(0, 80), path: c.path })),
    }));
    writeJson(P.tree, { tree: tree });
    syncManifest();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { ok: false, error: 'unknown api' });
}

/* ---------------- 路由 ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (url.pathname.startsWith('/api/')) {
    try { return await api(req, res, url); } catch (e) { return send(res, 500, { ok: false, error: e.message }); }
  }

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return sendFile(res, path.join(ADMIN_DIR, 'index.html'), MIME['.html']);
  }

  if (url.pathname === '/manifest.json') {
    return send(res, 200, { tree: syncManifest() });
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    try {
      if (!isPro(host(req))) {
        const problems = integrityProblems();
        if (problems.length) {
          res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end('<!doctype html><meta charset="utf-8"><title>服务已停止</title>'
            + '<div style="font:16px/1.8 -apple-system,sans-serif;max-width:560px;margin:12vh auto;color:#333">'
            + '<h1 style="color:#c0392b">服务已停止</h1>'
            + '<p>检测到版权/署名被修改，但本站未激活专业版，已停止对外服务。</p>'
            + '<p style="color:#666;font-size:13px">' + problems.map((x) => '· ' + x).join('<br>') + '</p>'
            + '</div>');
        }
      }
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return res.end(renderIndex(host(req)));
    } catch (e) {
      return send(res, 500, { ok: false, error: '站点尚未初始化：' + e.message });
    }
  }

  // 静态文件：只允许从 SITE_DIR 读取，防止穿越
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const full = path.resolve(SITE_DIR, rel);
  if (!full.startsWith(path.resolve(SITE_DIR))) return send(res, 403, { ok: false, error: 'forbidden' });
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, { ok: false, error: 'not found' });
  return sendFile(res, full, MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
});

bootstrap();

(function startupIntegrityGate() {
  const pro = isPro();
  let problems = [];
  try { problems = integrityProblems(); } catch (e) { problems = ['校验过程出错：' + e.message]; }
  if (problems.length && !pro) {
    console.error('');
    console.error('============================================================');
    console.error('  拒绝启动：检测到版权/署名被修改，但当前未激活专业版');
    console.error('------------------------------------------------------------');
    problems.forEach((x) => console.error('  - ' + x));
    console.error('------------------------------------------------------------');
    console.error('  处理方式：');
    console.error('   1) 恢复原始文件：rm -f ' + SITE_DIR + '/index.html ' + SITE_DIR + '/LICENSE');
    console.error('      并删除 ' + P.site + ' 中的 attribution 字段，然后重启');
    console.error('   2) 在管理后台输入 15 位产品密钥，或添加并验证域名 / 添加授权仓库');
    console.error('============================================================');
    console.error('');
    process.exit(1);
  }
  if (problems.length && pro) {
    console.warn('[warn] 专业版已激活，检测到以下署名变更（按授权允许）：' + problems.join('；'));
  }
})();

server.listen(PORT, () => {
  const lic = isPro() ? '专业版（已激活）' : '社区版（未激活，署名锁定）';
  console.log('[r6t5-docs] 服务已启动 http://0.0.0.0:' + PORT + ' · ' + lic);
});
