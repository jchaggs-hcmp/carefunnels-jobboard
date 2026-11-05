'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { agencies, jobs, applications } = require('./lib/db');
const render = require('./lib/render');
const { parseFormEmbed, resolveApplyForm } = require('./lib/forms');
const U = require('./lib/urls');
const dns = require('node:dns').promises;

const { PORT, BASE_URL } = U;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'data', 'uploads');
const MAX_BODY = 8 * 1024 * 1024; // 8MB JSON (resume base64 ≈ 5MB file)
const RESUME_TYPES = { 'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'image/jpeg': '.jpg', 'image/png': '.png', 'text/plain': '.txt' };

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!ADMIN_TOKEN) console.warn('⚠  ADMIN_TOKEN is not set — super-admin login is disabled. Set ADMIN_TOKEN to create agencies.');

// ---------------- helpers ----------------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const payload = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(payload);
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function bearer(req) { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; }
const isSuper = (req) => ADMIN_TOKEN && safeEq(bearer(req), ADMIN_TOKEN);

/** Resolves the agency an admin request may act on. Super admin may act on any agency; an agency key only on its own. */
function authAgency(req, agencyId) {
  if (isSuper(req)) { const a = agencies.byId(agencyId); if (!a) throw new HttpError(404, 'Agency not found'); return a; }
  const a = agencies.byKey(bearer(req));
  if (!a) throw new HttpError(401, 'Unauthorized');
  if (agencyId != null && Number(agencyId) !== a.id) throw new HttpError(403, 'Forbidden');
  return a;
}

// naive in-memory rate limit for public apply endpoint
const hits = new Map();
function rateLimit(req, limit = 10, windowMs = 10 * 60 * 1000) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(); const rec = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  rec.push(now); hits.set(ip, rec);
  if (rec.length > limit) throw new HttpError(429, 'Too many applications from this connection. Please call us instead.');
}

const publicJob = (j, agency) => ({
  id: j.id, slug: j.slug, title: j.title, category: j.category, employment_type: j.employment_type,
  employment_type_label: render.TYPE_LABEL[j.employment_type] || null,
  city: j.city || agency.city, state: j.state || agency.state, zip: j.zip || agency.zip,
  pay_min: j.pay_min, pay_max: j.pay_max, pay_unit: j.pay_unit, pay_text: render.payText(j),
  shifts: j.shifts, summary: j.summary, posted_at: j.posted_at, valid_through: j.valid_through,
  url: U.job(agency, j),
});
const publicAgency = (a) => ({ apply_form: resolveApplyForm(a, null), slug: a.slug, name: a.name, website: a.website, logo_url: a.logo_url, brand_color: a.brand_color, phone: a.phone, city: a.city, state: a.state, about: a.about });
const adminAgency = (a, showKey) => (showKey ? a : { ...a, api_key: undefined });

/** Validates a pasted CareFunnels form embed before saving (throws 400 with a helpful message). */
function validateForm(body) {
  if (body.apply_form_embed) parseFormEmbed(body.apply_form_embed);
  if ('custom_domain' in body) body.custom_domain = U.normalizeDomain(body.custom_domain) || '';
  return body;
}
const conflict = (e) => { if (/UNIQUE/.test(e.message)) throw new HttpError(409, /custom_domain/.test(e.message) ? 'That careers domain is already used by another agency' : 'That slug is already taken'); throw e; };
const clean = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);

async function notifyWebhook(agency, app, job) {
  if (!agency.webhook_url) return;
  const payload = {
    event: 'application.created',
    agency: { slug: agency.slug, name: agency.name, notify_email: agency.notify_email },
    job: job ? { id: job.id, title: job.title, url: U.job(agency, job) } : null,
    applicant: {
      id: app.id, first_name: app.first_name, last_name: app.last_name, full_name: `${app.first_name} ${app.last_name}`,
      email: app.email, phone: app.phone, zip: app.zip, certifications: app.certifications, experience: app.experience,
      availability: app.availability, has_transport: !!app.has_transport, message: app.message, source: app.source,
      resume_url: app.resume_path ? `${BASE_URL}/api/admin/agencies/${agency.id}/applications/${app.id}/resume` : null,
      tags: ['job-applicant', job?.category].filter(Boolean),
    },
    created_at: app.created_at,
  };
  try {
    const r = await fetch(agency.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    if (!r.ok) console.error(`webhook ${agency.slug} → HTTP ${r.status}`);
  } catch (e) { console.error(`webhook ${agency.slug} failed:`, e.message); }
}

function toCsv(rows, cols) {
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\r\n');
}

// ---------------- routing ----------------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
};

// ---- static ----
const STATIC = { '/embed.js': ['public/embed.js', 'application/javascript; charset=utf-8'], '/admin': ['public/admin.html', 'text/html; charset=utf-8'], '/': ['public/index.html', 'text/html; charset=utf-8'] };
for (const [p, [file, type]] of Object.entries(STATIC)) {
  route('GET', p === '/' ? '/' : p, (req, res) => send(res, 200, fs.readFileSync(path.join(__dirname, file)), type, { ...cors, 'Cache-Control': p === '/embed.js' ? 'public, max-age=300' : 'no-cache' }));
}
route('GET', '/healthz', (req, res) => send(res, 200, { ok: true, agency: agencies.byDomain(U.hostOf(req))?.slug || null }));

// ---- public JSON API (used by the embed widget) ----
route('GET', '/api/public/:agency', (req, res, p) => {
  const a = agencies.bySlug(p.agency); if (!a) throw new HttpError(404, 'Agency not found');
  const list = jobs.list(a.id, { status: 'public' });
  send(res, 200, { agency: publicAgency(a), jobs: list.map((j) => publicJob(j, a)) }, undefined, { ...cors, 'Cache-Control': 'public, max-age=60' });
});

route('GET', '/api/public/:agency/jobs/:job', (req, res, p) => {
  const a = agencies.bySlug(p.agency); if (!a) throw new HttpError(404, 'Agency not found');
  const j = jobs.get(a.id, p.job); if (!j || j.status === 'draft') throw new HttpError(404, 'Job not found');
  send(res, 200, {
    agency: publicAgency(a),
    job: { ...publicJob(j, a), is_open: j.status === 'open', description_html: render.fullDescriptionHtml(j, a), apply_form: resolveApplyForm(a, j) },
    jsonld: j.status === 'open' && !U.live(a) ? render.jobPostingJsonLd(j, a) : null, // with a live careers domain, Google gets it there only
  }, undefined, { ...cors, 'Cache-Control': 'public, max-age=60' });
});

route('POST', '/api/public/:agency/apply', async (req, res, p) => {
  const a = agencies.bySlug(p.agency); if (!a) throw new HttpError(404, 'Agency not found');
  const b = await readJson(req);
  if (b.website_url) return send(res, 200, { ok: true }, undefined, cors); // honeypot: silently drop bots
  rateLimit(req);
  const job = b.job_id ? jobs.get(a.id, b.job_id) : null;
  if (b.job_id && (!job || job.status !== 'open')) throw new HttpError(400, 'This position is no longer accepting applications.');
  const first = clean(b.first_name, 80), last = clean(b.last_name, 80), phone = clean(b.phone, 40), email = clean(b.email, 160);
  if (!first || !last || !phone) throw new HttpError(400, 'First name, last name and phone are required.');
  if (phone.replace(/\D/g, '').length < 10) throw new HttpError(400, 'Please enter a valid phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');

  let resume_name = null, resume_path = null;
  if (b.resume && b.resume.data) {
    const ext = RESUME_TYPES[b.resume.type];
    if (!ext) throw new HttpError(400, 'Resume must be a PDF, Word document, image or text file.');
    const buf = Buffer.from(String(b.resume.data).replace(/^data:[^,]*,/, ''), 'base64');
    if (buf.length > 5 * 1024 * 1024) throw new HttpError(400, 'Resume must be under 5MB.');
    const dir = path.join(UPLOAD_DIR, String(a.id)); fs.mkdirSync(dir, { recursive: true });
    resume_path = path.join(String(a.id), crypto.randomUUID() + ext);
    fs.writeFileSync(path.join(UPLOAD_DIR, resume_path), buf);
    resume_name = clean(b.resume.name, 160) || 'resume' + ext;
  }
  const list = (v) => (Array.isArray(v) ? v.map((x) => clean(x, 40)).filter(Boolean).join(', ') : clean(v, 300));
  const app = applications.create({
    agency_id: a.id, job_id: job?.id ?? null, first_name: first, last_name: last, email, phone,
    zip: clean(b.zip, 10), certifications: list(b.certifications), experience: clean(b.experience, 40),
    availability: list(b.availability), has_transport: b.has_transport == null ? null : b.has_transport ? 1 : 0,
    message: clean(b.message, 4000), resume_name, resume_path, source: clean(b.source, 500),
  });
  notifyWebhook(a, app, job); // fire and forget
  send(res, 201, { ok: true, id: app.id }, undefined, cors);
});

// ---- hosted career site + feeds ----
// Platform-host URLs. Once an agency's own careers domain is live these 301 to it, so there is one canonical copy.
const redirect = (res, to) => { res.writeHead(301, { Location: to, 'Cache-Control': 'public, max-age=3600' }); res.end(); };
const html = 'text/html; charset=utf-8', xml = 'application/xml; charset=utf-8';
const findPublicJob = (a, slug) => { const j = jobs.get(a.id, slug); if (!j || j.status === 'draft') throw new HttpError(404, 'Not found'); return j; };
const pages = {
  home: (res, a) => send(res, 200, render.careerIndexPage(a, jobs.list(a.id, { status: 'public' })), html),
  job: (res, a, slug) => send(res, 200, render.careerJobPage(a, findPublicJob(a, slug)), html),
  feed: (res, a) => send(res, 200, render.xmlFeed(a, jobs.list(a.id, { status: 'public' })), xml),
  sitemap: (res, a) => send(res, 200, render.sitemap(a, jobs.list(a.id, { status: 'public' })), xml),
};
const agencyOr404 = (slug) => { const a = agencies.bySlug(slug); if (!a) throw new HttpError(404, 'Not found'); return a; };
route('GET', '/careers/:agency', (req, res, p) => { const a = agencyOr404(p.agency); U.live(a) ? redirect(res, U.home(a)) : pages.home(res, a); });
route('GET', '/careers/:agency/:job', (req, res, p) => { const a = agencyOr404(p.agency); if (U.live(a)) return redirect(res, U.job(a, findPublicJob(a, p.job))); pages.job(res, a, p.job); });
route('GET', '/feeds/:agency.xml', (req, res, p) => { const a = agencyOr404(p.agency); U.live(a) ? redirect(res, U.feed(a)) : pages.feed(res, a); });
route('GET', '/sitemaps/:agency.xml', (req, res, p) => { const a = agencyOr404(p.agency); U.live(a) ? redirect(res, U.sitemap(a)) : pages.sitemap(res, a); });
route('GET', '/robots.txt', (req, res) => send(res, 200, 'User-agent: *\nDisallow: /admin\nDisallow: /api/\n', 'text/plain; charset=utf-8'));

// Caddy on-demand TLS asks this before issuing a certificate: only for domains that belong to an agency.
route('GET', '/internal/tls-allowed', (req, res, p, url) => {
  const d = String(url.searchParams.get('domain') || '').toLowerCase();
  send(res, d === U.BASE_HOST || agencies.byDomain(d) ? 200 : 404, d ? 'ok' : 'missing domain', 'text/plain');
});

// ---- admin API ----
route('GET', '/api/admin/me', (req, res) => {
  const platform = { domain_target: U.DOMAIN_TARGET, base_url: BASE_URL };
  if (isSuper(req)) return send(res, 200, { role: 'super', platform, agencies: agencies.all().map((a) => adminAgency(a, true)) });
  const a = authAgency(req, null);
  send(res, 200, { role: 'agency', platform, agencies: [adminAgency(a, true)] });
});
route('POST', '/api/admin/agencies', async (req, res) => {
  if (!isSuper(req)) throw new HttpError(401, 'Super admin only');
  const b = await readJson(req);
  if (!b.name) throw new HttpError(400, 'name is required');
  let created; try { created = agencies.create(validateForm(b)); } catch (e) { conflict(e); }
  send(res, 201, created); if (created.custom_domain) verifyDomain(created).catch(() => {});
});
route('PUT', '/api/admin/agencies/:id', async (req, res, p) => {
  const a = authAgency(req, p.id);
  const body = validateForm(await readJson(req));
  let updated; try { updated = agencies.update(a.id, body); } catch (e) { conflict(e); }
  send(res, 200, updated);
  if (updated.custom_domain && !updated.domain_verified_at) verifyDomain(updated).catch(() => {});
});
route('GET', '/api/admin/agencies/:id/domain-status', async (req, res, p) => send(res, 200, await verifyDomain(authAgency(req, p.id))));
route('POST', '/api/admin/agencies/:id/rotate-key', (req, res, p) => {
  if (!isSuper(req)) throw new HttpError(401, 'Super admin only');
  send(res, 200, agencies.rotateKey(authAgency(req, p.id).id));
});
route('DELETE', '/api/admin/agencies/:id', (req, res, p) => {
  if (!isSuper(req)) throw new HttpError(401, 'Super admin only');
  agencies.remove(authAgency(req, p.id).id); send(res, 200, { ok: true });
});

route('POST', '/api/admin/parse-form', async (req, res) => {
  if (!isSuper(req)) authAgency(req, null);
  send(res, 200, parseFormEmbed((await readJson(req)).embed) || {});
});
route('GET', '/api/admin/agencies/:id/jobs', (req, res, p) => send(res, 200, jobs.list(authAgency(req, p.id).id)));
route('POST', '/api/admin/agencies/:id/jobs', async (req, res, p) => send(res, 201, jobs.create(authAgency(req, p.id).id, validateForm(await readJson(req)))));
route('PUT', '/api/admin/agencies/:id/jobs/:job', async (req, res, p) => {
  const j = jobs.update(authAgency(req, p.id).id, p.job, validateForm(await readJson(req))); if (!j) throw new HttpError(404, 'Job not found'); send(res, 200, j);
});
route('DELETE', '/api/admin/agencies/:id/jobs/:job', (req, res, p) => { jobs.remove(authAgency(req, p.id).id, p.job); send(res, 200, { ok: true }); });

const APP_COLS = ['id', 'created_at', 'status', 'job_title', 'first_name', 'last_name', 'phone', 'email', 'zip', 'certifications', 'experience', 'availability', 'has_transport', 'message', 'source', 'notes'];
route('GET', '/api/admin/agencies/:id/applications', (req, res, p) => send(res, 200, applications.list(authAgency(req, p.id).id)));
route('GET', '/api/admin/agencies/:id/applications.csv', (req, res, p) => {
  const a = authAgency(req, p.id);
  send(res, 200, toCsv(applications.list(a.id), APP_COLS), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${a.slug}-applicants.csv"` });
});
route('PATCH', '/api/admin/agencies/:id/applications/:app', async (req, res, p) => {
  const r = applications.update(authAgency(req, p.id).id, p.app, await readJson(req)); if (!r) throw new HttpError(404, 'Not found'); send(res, 200, r);
});
route('GET', '/api/admin/agencies/:id/applications/:app/resume', (req, res, p) => {
  const a = authAgency(req, p.id); const app = applications.get(a.id, p.app);
  if (!app || !app.resume_path) throw new HttpError(404, 'No resume');
  const file = path.join(UPLOAD_DIR, app.resume_path);
  if (!file.startsWith(path.resolve(UPLOAD_DIR)) || !fs.existsSync(file)) throw new HttpError(404, 'No resume');
  const ext = path.extname(file); const type = Object.keys(RESUME_TYPES).find((k) => RESUME_TYPES[k] === ext) || 'application/octet-stream';
  send(res, 200, fs.readFileSync(file), type, { 'Content-Disposition': `attachment; filename="${(app.resume_name || 'resume' + ext).replace(/["\r\n]/g, '')}"` });
});

// ---------------- custom careers domains ----------------
/** Checks DNS and that https://<domain> actually reaches this server for this agency; marks the domain verified once it does. */
async function verifyDomain(a) {
  const out = { domain: a.custom_domain, target: U.DOMAIN_TARGET, dns: null, https: false, verified: !!a.domain_verified_at, careers_url: U.home(a) };
  if (!a.custom_domain) return out;
  const settle = (p) => p.then((v) => v, () => []);
  const [cname, addrs, targetAddrs] = await Promise.all([settle(dns.resolveCname(a.custom_domain)), settle(dns.resolve4(a.custom_domain)), settle(dns.resolve4(U.DOMAIN_TARGET))]);
  out.dns = {
    cname: cname[0] || null, addresses: addrs,
    points_here: cname.some((c) => c.toLowerCase().replace(/\.$/, '') === U.DOMAIN_TARGET) || addrs.some((x) => targetAddrs.includes(x)),
  };
  try {
    const r = await fetch(`${U.CUSTOM_SCHEME}://${a.custom_domain}/healthz`, { signal: AbortSignal.timeout(6000), redirect: 'manual' });
    out.https = r.ok && (await r.json()).agency === a.slug;
  } catch { out.https = false; }
  if (out.https && !a.domain_verified_at) a = agencies.setDomainVerified(a.id, true);
  out.verified = !!a.domain_verified_at; out.careers_url = U.home(a);
  return out;
}
// Re-check unverified domains every 10 minutes so they switch on by themselves once the client's DNS propagates.
function checkPendingDomains() { for (const a of agencies.all()) if (a.custom_domain && !a.domain_verified_at) verifyDomain(a).catch(() => {}); }
if (require.main === module) { setTimeout(checkPendingDomains, 5000).unref(); setInterval(checkPendingDomains, 10 * 60 * 1000).unref(); }

/** Requests arriving on an agency's own careers domain (careers.agency.com) get that agency's site at the root. */
function handleAgencyHost(a, req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let m;
  if (pathname === '/') return pages.home(res, a), true;
  if ((m = pathname.match(/^\/jobs\/([^/]+)\/?$/))) return pages.job(res, a, m[1]), true;
  if (pathname === '/sitemap.xml') return pages.sitemap(res, a), true;
  if (pathname === '/feed.xml') return pages.feed(res, a), true;
  if (pathname === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\nSitemap: ${U.CUSTOM_SCHEME}://${a.custom_domain}/sitemap.xml\n`, 'text/plain; charset=utf-8'), true;
  if ((m = pathname.match(/^\/careers\/[^/]+(?:\/([^/]+))?\/?$/))) return redirect(res, m[1] ? `/jobs/${m[1]}` : '/'), true;
  return false;
}
// On an agency domain only the public site, widget script, public API and health check are reachable — never the admin.
const AGENCY_HOST_PASSTHROUGH = /^\/(embed\.js|healthz|api\/public\/)/;

// ---------------- server ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const pathname = decodeURIComponent(url.pathname);
  const host = U.hostOf(req);
  const hostAgency = host && host !== U.BASE_HOST ? agencies.byDomain(host) : null;
  if (hostAgency) {
    try { if (handleAgencyHost(hostAgency, req, res, pathname)) return; }
    catch (e) { return send(res, e.status || 500, `<h1>${e.status === 404 ? 'Page not found' : 'Error'}</h1><p><a href="/">See open positions</a></p>`, html); }
    if (!AGENCY_HOST_PASSTHROUGH.test(pathname)) return send(res, 404, '<h1>Page not found</h1><p><a href="/">See open positions</a></p>', html);
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.re); if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    try { await r.handler(req, res, params, url); }
    catch (e) {
      const status = e.status || 500; if (status === 500) console.error(e);
      if (!res.headersSent) {
        if (pathname.startsWith('/api/')) send(res, status, { error: status === 500 ? 'Server error' : e.message }, undefined, cors);
        else send(res, status, `<h1>${status}</h1><p>${render.esc(status === 500 ? 'Server error' : e.message)}</p>`, 'text/html; charset=utf-8');
      }
    }
    return;
  }
  send(res, 404, pathname.startsWith('/api/') ? { error: 'Not found' } : '<h1>404</h1>', pathname.startsWith('/api/') ? undefined : 'text/html; charset=utf-8', cors);
});

if (require.main === module) server.listen(PORT, () => console.log(`Home care job board running at ${BASE_URL}  (admin: ${BASE_URL}/admin)`));
module.exports = server;
