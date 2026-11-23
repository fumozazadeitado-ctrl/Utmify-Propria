'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, getSettings, setSetting, DEFAULT_SETTINGS } = require('./lib/db');
const meta = require('./lib/meta');
const { PLATFORMS, normalizeOrder } = require('./lib/parsers');
const { upsertOrder, sendPurchaseToCapi } = require('./lib/orders');
const metrics = require('./lib/metrics');
const demo = require('./lib/demo');
const marca = require('./lib/marca');

const PORT = Number(process.env.PORT) || Number(marca.porta) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------- utilidades ----------
const randomToken = (n = 24) => crypto.randomBytes(n).toString('hex');
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}
function send(res, code, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(body);
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.status = code; } }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 5e6) { reject(new HttpError(413, 'Payload muito grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = req.headers['content-type'] || '';
      if (!raw) return resolve({});
      try {
        if (type.includes('application/x-www-form-urlencoded')) return resolve(formToObject(raw));
        return resolve(JSON.parse(raw));
      } catch {
        try { return resolve(formToObject(raw)); } catch { return resolve({ raw }); }
      }
    });
    req.on('error', reject);
  });
}
// a[b][c]=1 -> { a: { b: { c: '1' } } }
function formToObject(raw) {
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    const keys = k.split(/[[\]]+/).filter(Boolean);
    let o = out;
    keys.forEach((key, i) => { if (i === keys.length - 1) o[key] = v; else o = o[key] = (typeof o[key] === 'object' ? o[key] : {}); });
  }
  return out;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function currentUser(req) {
  const t = cookies(req).sid;
  if (!t) return null;
  const s = db.prepare('SELECT u.id, u.name, u.email, u.api_token, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(t);
  if (!s || s.expires < Date.now()) return null;
  return s;
}
function baseUrl(req, userId) {
  const s = userId ? getSettings(userId) : {};
  if (s.public_url) return s.public_url.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
function localToday(userId) {
  const off = Number(getSettings(userId).tz_offset) || -3;
  return new Date(Date.now() + off * 3600e3).toISOString().slice(0, 10);
}
function period(q, userId) {
  const today = localToday(userId);
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = re.test(q.get('from') || '') ? q.get('from') : today;
  const to = re.test(q.get('to') || '') ? q.get('to') : from;
  return from <= to ? { from, to } : { from: to, to: from };
}

// ---------- rotas ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false });
};

// Autenticacao
route('POST', '/api/auth/register', async (req, res, { body }) => {
  const { name, email, password } = body;
  if (!name || !email || !password || password.length < 6) throw new HttpError(400, 'Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.');
  if (!marca.cadastro_aberto && db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new HttpError(403, 'O cadastro está fechado neste painel. Para liberar, mude cadastro_aberto para true no marca.json.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.toLowerCase())) throw new HttpError(400, 'Já existe uma conta com este e-mail.');
  const r = db.prepare('INSERT INTO users (name, email, pass_hash, api_token, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), email.toLowerCase().trim(), hashPassword(password), randomToken(20), new Date().toISOString());
  return login(res, Number(r.lastInsertRowid));
}, { auth: false });

route('POST', '/api/auth/login', async (req, res, { body }) => {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(body.email || '').toLowerCase().trim());
  if (!u || !checkPassword(String(body.password || ''), u.pass_hash)) throw new HttpError(401, 'E-mail ou senha incorretos.');
  return login(res, u.id);
}, { auth: false });

function login(res, userId) {
  const token = randomToken(32);
  const days = 30;
  db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, Date.now() + days * 86400e3);
  send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${days * 86400}` });
}

route('POST', '/api/auth/logout', async (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(cookies(req).sid || '');
  send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
}, { auth: false });

route('GET', '/api/auth/me', async (req, res, { user }) => {
  const hasUsers = !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const cadastro = !hasUsers || marca.cadastro_aberto;
  if (!user) return send(res, 200, { user: null, hasUsers, cadastro });
  send(res, 200, { user: { id: user.id, name: user.name, email: user.email }, hasUsers, cadastro });
}, { auth: false });

route('POST', '/api/user/password', async (req, res, { user, body }) => {
  const u = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id);
  if (!checkPassword(String(body.current || ''), u.pass_hash)) throw new HttpError(400, 'Senha atual incorreta.');
  if (!body.password || body.password.length < 6) throw new HttpError(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(body.password), user.id);
  send(res, 200, { ok: true });
});

route('PUT', '/api/user', async (req, res, { user, body }) => {
  if (body.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(body.name).trim(), user.id);
  send(res, 200, { ok: true });
});

route('POST', '/api/user/api-token', async (req, res, { user }) => {
  const t = randomToken(20);
  db.prepare('UPDATE users SET api_token = ? WHERE id = ?').run(t, user.id);
  send(res, 200, { api_token: t });
});

// Configuracoes
route('GET', '/api/settings', async (req, res, { user }) => {
  const s = getSettings(user.id);
  send(res, 200, { ...s, capi_token: s.capi_token ? '••••' + s.capi_token.slice(-4) : '', api_token: user.api_token, base_url: baseUrl(req, user.id), platforms: PLATFORMS });
});
route('PUT', '/api/settings', async (req, res, { user, body }) => {
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in body)) continue;
    if (k === 'capi_token' && String(body[k]).startsWith('••••')) continue;
    const v = k === 'gateway_fees' && typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k];
    setSetting(user.id, k, v);
  }
  send(res, 200, { ok: true });
});

// Dashboard e campanhas
route('GET', '/api/dashboard', async (req, res, { user, query }) => {
  send(res, 200, metrics.dashboard(user.id, { ...period(query, user.id), account: query.get('account') || 'all' }));
});
route('GET', '/api/campaigns', async (req, res, { user, query }) => {
  const level = ['account', 'campaign', 'adset', 'ad'].includes(query.get('level')) ? query.get('level') : 'campaign';
  const parents = (query.get('parents') || '').split(',').filter(Boolean);
  send(res, 200, metrics.campaigns(user.id, { ...period(query, user.id), account: query.get('account') || 'all', level, parents }));
});

// Meta Ads
route('GET', '/api/meta/profiles', async (req, res, { user }) => {
  const profiles = db.prepare('SELECT id, name, fb_user_id, created_at FROM meta_profiles WHERE user_id = ?').all(user.id);
  send(res, 200, { profiles });
});
route('POST', '/api/meta/profiles', async (req, res, { user, body }) => {
  const token = String(body.token || '').trim();
  if (!token) throw new HttpError(400, 'Informe o token de acesso.');
  let info;
  try { info = await meta.fetchProfile(token); } catch (e) { throw new HttpError(400, `Token inválido: ${e.message}`); }
  const existing = db.prepare('SELECT id FROM meta_profiles WHERE user_id = ? AND fb_user_id = ?').get(user.id, info.me.id);
  let id;
  if (existing) { db.prepare('UPDATE meta_profiles SET token = ?, name = ? WHERE id = ?').run(token, info.me.name, existing.id); id = existing.id; }
  else id = Number(db.prepare('INSERT INTO meta_profiles (user_id, name, token, fb_user_id, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, info.me.name, token, info.me.id, new Date().toISOString()).lastInsertRowid);
  meta.saveAccounts(user.id, id, info.accounts);
  send(res, 200, { ok: true, profile: { id, name: info.me.name }, accounts: info.accounts.length });
});
route('DELETE', '/api/meta/profiles/:id', async (req, res, { user, params }) => {
  db.prepare('UPDATE ad_accounts SET enabled = 0, profile_id = NULL WHERE user_id = ? AND profile_id = ?').run(user.id, params.id);
  db.prepare('DELETE FROM meta_profiles WHERE user_id = ? AND id = ?').run(user.id, params.id);
  send(res, 200, { ok: true });
});
route('GET', '/api/meta/accounts', async (req, res, { user }) => {
  const accounts = db.prepare(`SELECT a.id, a.name, a.currency, a.timezone, a.account_status, a.enabled, a.last_sync, a.last_error, a.profile_id, p.name AS profile_name
    FROM ad_accounts a LEFT JOIN meta_profiles p ON p.id = a.profile_id WHERE a.user_id = ? ORDER BY a.enabled DESC, a.name`).all(user.id);
  send(res, 200, { accounts });
});
route('PUT', '/api/meta/accounts/:id', async (req, res, { user, params, body }) => {
  db.prepare('UPDATE ad_accounts SET enabled = ? WHERE user_id = ? AND id = ?').run(body.enabled ? 1 : 0, user.id, decodeURIComponent(params.id));
  send(res, 200, { ok: true });
});
route('POST', '/api/meta/sync', async (req, res, { user, body }) => {
  const days = Math.min(90, Math.max(1, Number(body.days) || 7));
  send(res, 200, await meta.syncUser(user.id, days));
});
route('POST', '/api/meta/entity/:id/status', async (req, res, { user, params, body }) => {
  try { await meta.setStatus(user.id, params.id, body.status); } catch (e) { throw new HttpError(400, e.message); }
  send(res, 200, { ok: true });
});
route('POST', '/api/meta/entity/:id/budget', async (req, res, { user, params, body }) => {
  try { await meta.setBudget(user.id, params.id, Number(body.daily_budget)); } catch (e) { throw new HttpError(400, e.message); }
  send(res, 200, { ok: true });
});

// Vendas
function ordersQuery(user, query) {
  const { from, to } = period(query, user.id);
  const c = metrics.ctx(user.id, from, to);
  const where = ['user_id = ?', 'created_at >= ?', 'created_at < ?'];
  const params = [user.id, c.startISO, c.endISO];
  const status = query.get('status');
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
  const method = query.get('method');
  if (method && method !== 'all') { where.push('payment_method = ?'); params.push(method); }
  const q = (query.get('q') || '').trim();
  if (q) {
    where.push('(external_id LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR product_name LIKE ? OR utm_campaign LIKE ? OR utm_content LIKE ?)');
    params.push(...Array(6).fill(`%${q}%`));
  }
  return { c, sql: `FROM orders WHERE ${where.join(' AND ')}`, params };
}
route('GET', '/api/orders', async (req, res, { user, query }) => {
  const { c, sql, params } = ordersQuery(user, query);
  const page = Math.max(1, Number(query.get('page')) || 1);
  const per = 50;
  const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...params).n;
  const rows = db.prepare(`SELECT id, platform, external_id, status, payment_method, amount, gateway_fee, product_name, customer_name, customer_email, customer_phone,
    utm_source, utm_campaign, utm_medium, utm_content, utm_term, src, sck, campaign_id, adset_id, ad_id, created_at, approved_at, capi_status ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, per, (page - 1) * per);
  for (const r of rows) { r.fee = metrics.feeOf(c, r); r.net = r.amount - r.fee; }
  send(res, 200, { rows, total, page, pages: Math.max(1, Math.ceil(total / per)) });
});
route('GET', '/api/orders.csv', async (req, res, { user, query }) => {
  const { c, sql, params } = ordersQuery(user, query);
  const rows = db.prepare(`SELECT * ${sql} ORDER BY created_at DESC`).all(...params);
  const cols = ['created_at', 'platform', 'external_id', 'status', 'payment_method', 'amount', 'fee', 'net', 'product_name', 'customer_name', 'customer_email', 'customer_phone', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.join(';')];
  for (const r of rows) {
    r.fee = metrics.feeOf(c, r); r.net = r.amount - r.fee;
    lines.push(cols.map((k) => (['amount', 'fee', 'net'].includes(k) ? (r[k] / 100).toFixed(2).replace('.', ',') : esc(k === 'created_at' ? c.local(r[k]).toISOString().slice(0, 19).replace('T', ' ') : r[k]))).join(';'));
  }
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="vendas.csv"' });
  res.end('﻿' + lines.join('\n'));
});

// Integracoes (webhooks)
route('GET', '/api/integrations', async (req, res, { user }) => {
  const base = baseUrl(req, user.id);
  const rows = db.prepare('SELECT * FROM integrations WHERE user_id = ? ORDER BY id DESC').all(user.id)
    .map((r) => ({ ...r, url: `${base}/webhook/${r.token}`, platform_name: PLATFORMS[r.platform] || r.platform }));
  send(res, 200, { integrations: rows, platforms: PLATFORMS });
});
route('POST', '/api/integrations', async (req, res, { user, body }) => {
  if (!PLATFORMS[body.platform]) throw new HttpError(400, 'Plataforma inválida.');
  db.prepare('INSERT INTO integrations (user_id, platform, name, token, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, body.platform, String(body.name || PLATFORMS[body.platform]).trim(), randomToken(16), new Date().toISOString());
  send(res, 200, { ok: true });
});
route('DELETE', '/api/integrations/:id', async (req, res, { user, params }) => {
  db.prepare('DELETE FROM integrations WHERE user_id = ? AND id = ?').run(user.id, params.id);
  send(res, 200, { ok: true });
});

// Produtos (custos) e despesas
route('GET', '/api/products', async (req, res, { user }) => {
  const rows = db.prepare(`SELECT o.product_name AS name, COUNT(*) AS sales, COALESCE(p.cost, 0) AS cost FROM orders o
    LEFT JOIN products p ON p.user_id = o.user_id AND p.name = o.product_name WHERE o.user_id = ? AND o.status = 'approved' GROUP BY o.product_name
    UNION SELECT name, 0, cost FROM products WHERE user_id = ? AND name NOT IN (SELECT product_name FROM orders WHERE user_id = ? AND status = 'approved' AND product_name IS NOT NULL)
    ORDER BY sales DESC`).all(user.id, user.id, user.id);
  send(res, 200, { products: rows });
});
route('PUT', '/api/products', async (req, res, { user, body }) => {
  const stmt = db.prepare('INSERT INTO products (user_id, name, cost) VALUES (?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET cost = excluded.cost');
  for (const p of body.products || []) if (p.name) stmt.run(user.id, String(p.name), Math.max(0, Math.round(Number(p.cost) || 0)));
  send(res, 200, { ok: true });
});
route('GET', '/api/expenses', async (req, res, { user }) => {
  send(res, 200, { expenses: db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC LIMIT 500').all(user.id) });
});
route('POST', '/api/expenses', async (req, res, { user, body }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !body.description || !(Number(body.amount) > 0)) throw new HttpError(400, 'Preencha data, descrição e valor.');
  db.prepare('INSERT INTO expenses (user_id, date, description, amount) VALUES (?, ?, ?, ?)').run(user.id, body.date, String(body.description), Math.round(Number(body.amount)));
  send(res, 200, { ok: true });
});
route('DELETE', '/api/expenses/:id', async (req, res, { user, params }) => {
  db.prepare('DELETE FROM expenses WHERE user_id = ? AND id = ?').run(user.id, params.id);
  send(res, 200, { ok: true });
});

// Dados de demonstracao
route('POST', '/api/demo/load', async (req, res, { user }) => send(res, 200, demo.loadDemo(user.id)));
route('POST', '/api/demo/clear', async (req, res, { user }) => { demo.clearDemo(user.id); send(res, 200, { ok: true }); });

// Webhook das plataformas: POST /webhook/:token
route('POST', '/webhook/:token', async (req, res, { params, body }) => {
  const integ = db.prepare('SELECT * FROM integrations WHERE token = ?').get(params.token);
  if (!integ) throw new HttpError(404, 'Integração não encontrada.');
  const o = normalizeOrder(integ.platform, body);
  if (!o.external_id) {
    // eventos de teste/ping das plataformas
    db.prepare('UPDATE integrations SET last_event = ?, events = events + 1 WHERE id = ?').run(new Date().toISOString(), integ.id);
    return send(res, 200, { ok: true, ignored: 'sem id de pedido' });
  }
  const { order, becameApproved } = upsertOrder(integ.user_id, integ.platform, o, integ.id, body);
  db.prepare('UPDATE integrations SET last_event = ?, events = events + 1 WHERE id = ?').run(new Date().toISOString(), integ.id);
  if (becameApproved) sendPurchaseToCapi(integ.user_id, order).catch(() => {});
  send(res, 200, { ok: true, order_id: order.id, status: order.status });
}, { auth: false });
route('GET', '/webhook/:token', async (req, res, { params }) => {
  const integ = db.prepare('SELECT id FROM integrations WHERE token = ?').get(params.token);
  send(res, integ ? 200 : 404, { ok: !!integ });
}, { auth: false });

// API publica de pedidos: POST /api/v1/orders  (header x-api-token)
route('POST', '/api/v1/orders', async (req, res, { body }) => {
  const token = req.headers['x-api-token'];
  const u = token && db.prepare('SELECT id FROM users WHERE api_token = ?').get(String(token));
  if (!u) throw new HttpError(401, 'x-api-token inválido.');
  const o = normalizeOrder('api', body);
  const platform = String(body.platform || 'api').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'api';
  const { order, becameApproved } = upsertOrder(u.id, platform, o, null, body);
  if (becameApproved) sendPurchaseToCapi(u.id, order).catch(() => {});
  send(res, 200, { ok: true, order_id: order.id, status: order.status });
}, { auth: false });

// ---------- servidor ----------
// index.html com o nome e as cores do marca.json
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function indexHtml() {
  const favicon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='${marca.cor_principal}'/><path d='M8 21l5-6 4 4 7-9' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>`)}`;
  const publico = { nome: marca.nome, slogan: marca.slogan, titulo_login: marca.titulo_login, texto_login: marca.texto_login, cor: marca.cor_principal, cor2: marca.cor_secundaria, id: marca.id };
  return fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replaceAll('{{NOME}}', escHtml(marca.nome))
    .replaceAll('{{FAVICON}}', favicon)
    .replaceAll('{{CORES}}', `:root{--blue:${marca.cor_principal};--blue2:${marca.cor_clara};--brand2:${marca.cor_secundaria}}`)
    .replaceAll('{{MARCA_JSON}}', JSON.stringify(publico).replace(/</g, '\\u003c'));
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Proibido');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  const ext = path.extname(file);
  if (file === path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    return res.end(indexHtml());
  }
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (pathname === '/utms.js') Object.assign(headers, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' });
  else headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-api-token', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
    return res.end();
  }
  const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
  if (!r) {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    return send(res, 404, { error: 'Rota não encontrada' });
  }
  try {
    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    const user = currentUser(req);
    if (r.auth && !user) throw new HttpError(401, 'Faça login para continuar.');
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    await r.handler(req, res, { user, params, body, query: url.searchParams });
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Erro interno' });
  }
});

// Sincroniza o Meta automaticamente a cada 15 minutos
setInterval(async () => {
  const users = db.prepare("SELECT DISTINCT user_id FROM ad_accounts WHERE enabled = 1 AND id NOT LIKE 'act_demo%'").all();
  for (const u of users) await meta.syncUser(u.user_id, 2).catch((e) => console.error('sync', e.message));
}, 15 * 60 * 1000);
// Limpa sessoes expiradas
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 3600e3);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  A porta ${PORT} ja esta em uso. O ${marca.nome} provavelmente ja esta aberto em outra janela: acesse http://localhost:${PORT}\n`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`\n  ${marca.nome} rodando em http://localhost:${PORT}\n`);
});
