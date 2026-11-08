'use strict';
// CareFunnels (GoHighLevel / LeadConnector) API client for the "Job" custom object.
// Auth: a Private Integration token per sub-account, scopes objects/record.readonly + objects/record.write
// (+ objects/schema.readonly for the connection test).

const API = (process.env.CF_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/$/, '');
const VERSION = '2021-07-28';

class CFError extends Error {}

async function call(token, method, path, body) {
  let r;
  try {
    r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) { throw new CFError(`Could not reach CareFunnels (${e.message})`); }
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 200) }; }
  if (!r.ok) {
    const msg = data.message || data.error || data.msg || text.slice(0, 200);
    if (r.status === 401 || r.status === 403) throw new CFError(`CareFunnels rejected the token (${r.status}): ${msg}. Check the Private Integration token and its scopes.`);
    if (r.status === 404) throw new CFError(`CareFunnels says not found (404): ${msg}. Check the sub-account ID and that the Job object key is right.`);
    throw new CFError(`CareFunnels error ${r.status}: ${msg}`);
  }
  return data;
}

/** All records of the Job object in a sub-account (pages of 100). */
async function listJobRecords({ token, locationId, objectKey }) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const d = await call(token, 'POST', `/objects/${encodeURIComponent(objectKey)}/records/search`, { locationId, page, pageLimit: 100 });
    const recs = d.records || [];
    out.push(...recs);
    if (recs.length < 100 || (d.total != null && out.length >= d.total)) break;
  }
  return out;
}

async function updateRecord({ token, locationId, objectKey }, id, properties) {
  return call(token, 'PUT', `/objects/${encodeURIComponent(objectKey)}/records/${encodeURIComponent(id)}?locationId=${encodeURIComponent(locationId)}`, { properties });
}

/** Connection test: reads the object schema so we can report missing fields early. */
async function getSchema({ token, locationId, objectKey }) {
  return call(token, 'GET', `/objects/${encodeURIComponent(objectKey)}?locationId=${encodeURIComponent(locationId)}&fetchProperties=true`);
}

// ---------------- record → job mapping ----------------
// Field keys of the Job object (the part after "custom_objects.jobs."). Keep in sync with docs/carefunnels-job-object.md.
const FIELDS = {
  title: 'job_title', status: 'status', category: 'category', employment_type: 'employment_type',
  city: 'city', state: 'state', zip: 'zip', pay_min: 'pay_min', pay_max: 'pay_max', pay_unit: 'pay_per',
  shifts: 'shifts', summary: 'summary', description: 'description', requirements: 'requirements', benefits: 'benefits',
  valid_through: 'expires_on', apply_form_embed: 'application_form', live_url: 'live_job_url',
};

/** CareFunnels values can be strings, numbers, arrays (multi-select) or {value}/{label} objects. */
function val(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(val).filter((x) => x != null && x !== '');
  if (typeof v === 'object') return val(v.value ?? v.label ?? v.name ?? null);
  const s = String(v).trim();
  return s === '' ? null : s;
}
const text = (v) => { const x = val(v); return Array.isArray(x) ? x.join(', ') : x; };
const num = (v) => { const x = text(v); if (x == null) return null; const n = parseFloat(String(x).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const norm = (v) => String(text(v) || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Option keys like "per_diem"/"Per diem"/"PER-DIEM" → human label ("Per diem"). */
const KNOWN = { cna: 'CNA', hha: 'HHA', pca: 'PCA', lpn: 'LPN', rn: 'RN', prn: 'PRN', cma: 'CMA', live_in: 'Live-in', live_in_caregiver: 'Live-in Caregiver', office: 'Office / Admin', office_admin: 'Office / Admin' };
const label = (v) => {
  const x = text(v); if (!x || !/^[a-z0-9_]+$/.test(x)) return x;
  return KNOWN[x] || x.split('_').map((w) => KNOWN[w] || w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const STATUS = { open: 'open', active: 'open', published: 'open', live: 'open', filled: 'closed', closed: 'closed', hired: 'closed', draft: 'draft', paused: 'draft', on_hold: 'draft' };
const TYPES = { full_time: 'FULL_TIME', fulltime: 'FULL_TIME', part_time: 'PART_TIME', parttime: 'PART_TIME', per_diem: 'PER_DIEM', prn: 'PER_DIEM', contract: 'CONTRACTOR', contractor: 'CONTRACTOR', temporary: 'TEMPORARY', temp: 'TEMPORARY' };
const UNITS = { hour: 'HOUR', hourly: 'HOUR', hr: 'HOUR', day: 'DAY', daily: 'DAY', week: 'WEEK', weekly: 'WEEK', month: 'MONTH', monthly: 'MONTH', year: 'YEAR', yearly: 'YEAR', annual: 'YEAR', salary: 'YEAR' };

function toDate(v) {
  const x = text(v); if (!x) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(x)) return x.slice(0, 10);
  const n = Number(x); const d = Number.isFinite(n) && n > 1e11 ? new Date(n) : new Date(x);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

/** Maps one CareFunnels Job record to our job fields. Returns { job, problems[] }. */
function recordToJob(rec) {
  const p = rec.properties || {};
  const g = (k) => p[FIELDS[k]];
  const problems = [];
  const title = text(g('title'));
  if (!title) problems.push('Job Title is empty');
  const statusRaw = norm(g('status'));
  const status = STATUS[statusRaw] || (statusRaw ? null : 'open');
  if (!status) problems.push(`Unknown Status "${text(g('status'))}" (use Open, Draft or Filled)`);
  const shifts = val(g('shifts'));
  const job = {
    title: title || '(untitled job)',
    status: status || 'draft',
    category: label(g('category')),
    employment_type: TYPES[norm(g('employment_type'))] || null,
    city: text(g('city')), state: text(g('state')), zip: text(g('zip')),
    pay_min: num(g('pay_min')), pay_max: num(g('pay_max')),
    pay_unit: UNITS[norm(g('pay_unit'))] || 'HOUR',
    shifts: Array.isArray(shifts) ? shifts.map(label).join(', ') : label(shifts),
    summary: text(g('summary')), description: text(g('description')),
    requirements: text(g('requirements')), benefits: text(g('benefits')),
    valid_through: toDate(g('valid_through')),
    apply_form_embed: text(g('apply_form_embed')),
  };
  if (problems.length) job.status = 'draft'; // never publish a broken record
  return { job, problems, liveUrl: text(g('live_url')) };
}

module.exports = { listJobRecords, updateRecord, getSchema, recordToJob, FIELDS, CFError };
