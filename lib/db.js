'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'jobs.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agencies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  website       TEXT,
  logo_url      TEXT,
  brand_color   TEXT DEFAULT '#0f6cbd',
  phone         TEXT,
  street        TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  about         TEXT,          -- "Why work with us" blurb shown on the career page
  webhook_url   TEXT,          -- new applicants are POSTed here (CRM / Zapier / GoHighLevel inbound webhook)
  notify_email  TEXT,          -- included in webhook payload so an automation can email the hiring manager
  api_key       TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id       INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  slug            TEXT NOT NULL,
  category        TEXT,        -- Caregiver, CNA, HHA, LPN, RN, Office, ...
  employment_type TEXT,        -- FULL_TIME, PART_TIME, PER_DIEM, CONTRACTOR, TEMPORARY
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  pay_min         REAL,
  pay_max         REAL,
  pay_unit        TEXT DEFAULT 'HOUR', -- HOUR, DAY, WEEK, MONTH, YEAR
  shifts          TEXT,        -- free text: "Days, Nights, Weekends, Live-in"
  summary         TEXT,
  description     TEXT,        -- plain text / light markdown (blank lines = paragraphs, "- " = bullets)
  requirements    TEXT,
  benefits        TEXT,
  status          TEXT NOT NULL DEFAULT 'open', -- open | closed | draft
  posted_at       TEXT NOT NULL DEFAULT (datetime('now')),
  valid_through   TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (agency_id, slug)
);

CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agency_id       INTEGER NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT NOT NULL,
  zip             TEXT,
  certifications  TEXT,        -- comma list: CNA, HHA, PCA, CPR, LPN, RN
  experience      TEXT,        -- years
  availability    TEXT,        -- comma list
  has_transport   INTEGER,
  message         TEXT,
  resume_name     TEXT,
  resume_path     TEXT,
  source          TEXT,        -- page URL / utm_source the applicant came from
  status          TEXT NOT NULL DEFAULT 'new', -- new | contacted | interview | hired | rejected
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_agency ON jobs(agency_id, status);
CREATE INDEX IF NOT EXISTS idx_apps_agency ON applications(agency_id, created_at);
`);

const newKey = () => 'hcj_' + crypto.randomBytes(24).toString('hex');

const slugify = (s) =>
  String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'job';

const AGENCY_FIELDS = ['slug', 'name', 'website', 'logo_url', 'brand_color', 'phone', 'street', 'city', 'state', 'zip', 'about', 'webhook_url', 'notify_email'];
const JOB_FIELDS = ['title', 'category', 'employment_type', 'city', 'state', 'zip', 'pay_min', 'pay_max', 'pay_unit', 'shifts', 'summary', 'description', 'requirements', 'benefits', 'status', 'valid_through'];
const APP_UPDATE_FIELDS = ['status', 'notes'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f] === '' ? null : obj[f];
  return out;
}

// ---------- agencies ----------
const agencies = {
  all: () => db.prepare('SELECT * FROM agencies ORDER BY name').all(),
  bySlug: (slug) => db.prepare('SELECT * FROM agencies WHERE slug = ?').get(slug),
  byId: (id) => db.prepare('SELECT * FROM agencies WHERE id = ?').get(id),
  byKey: (key) => db.prepare('SELECT * FROM agencies WHERE api_key = ?').get(key),
  create(data) {
    const d = pick(data, AGENCY_FIELDS);
    d.slug = slugify(d.slug || d.name);
    d.api_key = newKey();
    const cols = Object.keys(d);
    const r = db.prepare(`INSERT INTO agencies (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => d[c]));
    return agencies.byId(r.lastInsertRowid);
  },
  update(id, data) {
    const d = pick(data, AGENCY_FIELDS);
    if (d.slug) d.slug = slugify(d.slug);
    const cols = Object.keys(d);
    if (cols.length) db.prepare(`UPDATE agencies SET ${cols.map((c) => c + ' = ?').join(',')} WHERE id = ?`).run(...cols.map((c) => d[c]), id);
    return agencies.byId(id);
  },
  rotateKey(id) {
    db.prepare('UPDATE agencies SET api_key = ? WHERE id = ?').run(newKey(), id);
    return agencies.byId(id);
  },
  remove: (id) => db.prepare('DELETE FROM agencies WHERE id = ?').run(id),
};

// ---------- jobs ----------
function uniqueJobSlug(agencyId, title, exceptId) {
  const base = slugify(title);
  let slug = base;
  for (let i = 2; db.prepare('SELECT id FROM jobs WHERE agency_id = ? AND slug = ? AND id IS NOT ?').get(agencyId, slug, exceptId ?? null); i++) slug = `${base}-${i}`;
  return slug;
}

const jobs = {
  list(agencyId, { status } = {}) {
    if (status === 'public') {
      return db.prepare(`SELECT * FROM jobs WHERE agency_id = ? AND status = 'open'
        AND (valid_through IS NULL OR valid_through >= date('now')) ORDER BY posted_at DESC`).all(agencyId);
    }
    return db.prepare('SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicant_count FROM jobs j WHERE agency_id = ? ORDER BY posted_at DESC').all(agencyId);
  },
  get: (agencyId, idOrSlug) =>
    db.prepare('SELECT * FROM jobs WHERE agency_id = ? AND (id = ? OR slug = ?)').get(agencyId, Number(idOrSlug) || -1, String(idOrSlug)),
  create(agencyId, data) {
    const d = pick(data, JOB_FIELDS);
    if (!d.title) throw Object.assign(new Error('title is required'), { status: 400 });
    d.agency_id = agencyId;
    d.slug = uniqueJobSlug(agencyId, d.title);
    const cols = Object.keys(d);
    const r = db.prepare(`INSERT INTO jobs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => d[c]));
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(r.lastInsertRowid);
  },
  update(agencyId, id, data) {
    const d = pick(data, JOB_FIELDS);
    if (d.title) d.slug = uniqueJobSlug(agencyId, d.title, Number(id));
    d.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const cols = Object.keys(d);
    db.prepare(`UPDATE jobs SET ${cols.map((c) => c + ' = ?').join(',')} WHERE id = ? AND agency_id = ?`).run(...cols.map((c) => d[c]), id, agencyId);
    return db.prepare('SELECT * FROM jobs WHERE id = ? AND agency_id = ?').get(id, agencyId);
  },
  remove: (agencyId, id) => db.prepare('DELETE FROM jobs WHERE id = ? AND agency_id = ?').run(id, agencyId),
};

// ---------- applications ----------
const applications = {
  list: (agencyId) =>
    db.prepare(`SELECT a.*, j.title AS job_title FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
      WHERE a.agency_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(agencyId),
  get: (agencyId, id) => db.prepare('SELECT * FROM applications WHERE agency_id = ? AND id = ?').get(agencyId, id),
  create(data) {
    const cols = Object.keys(data);
    const r = db.prepare(`INSERT INTO applications (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => data[c]));
    return db.prepare('SELECT * FROM applications WHERE id = ?').get(r.lastInsertRowid);
  },
  update(agencyId, id, data) {
    const d = pick(data, APP_UPDATE_FIELDS);
    const cols = Object.keys(d);
    if (cols.length) db.prepare(`UPDATE applications SET ${cols.map((c) => c + ' = ?').join(',')} WHERE id = ? AND agency_id = ?`).run(...cols.map((c) => d[c]), id, agencyId);
    return applications.get(agencyId, id);
  },
};

module.exports = { db, agencies, jobs, applications, slugify };
