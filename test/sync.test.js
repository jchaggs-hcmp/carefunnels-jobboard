'use strict';
// End-to-end test of the CareFunnels → hub → WordPress sync, against local stand-ins for both APIs.
// Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// ---- stand-in CareFunnels API ----
const cfState = { records: [], updates: [], fail: false, auth: null };
const cfServer = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    cfState.auth = req.headers.authorization;
    if (cfState.fail) { res.writeHead(500); return res.end('{"message":"boom"}'); }
    if (req.method === 'POST' && req.url === '/objects/custom_objects.jobs/records/search') {
      const b = JSON.parse(body); cfState.lastSearch = b;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ records: cfState.records, total: cfState.records.length }));
    }
    const m = req.url.match(/^\/objects\/custom_objects\.jobs\/records\/([^?]+)\?locationId=(.+)$/);
    if (req.method === 'PUT' && m) { cfState.updates.push({ id: m[1], locationId: m[2], body: JSON.parse(body) }); res.writeHead(200); return res.end('{"record":{}}'); }
    res.writeHead(404); res.end('{}');
  });
});

// ---- stand-in WordPress + CareFunnels Job Sync plugin ----
const wpState = { posts: new Map(), calls: [], next: 500 };
const wpServer = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from('jason:abcd efgh ijkl mnop').toString('base64');
    if (!ok) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"code":"rest_not_logged_in","message":"bad login"}'); }
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    wpState.calls.push(`${req.method} ${req.url}`);
    if (req.url === '/wp-json/hcjobs/v1/status') return send({ ok: true, wpjm_active: true, wpjm_version: '2.4.0' });
    if (req.method === 'POST' && req.url === '/wp-json/hcjobs/v1/jobs') {
      const p = JSON.parse(body); const existing = wpState.posts.get(p.external_id);
      const id = existing ? existing.id : wpState.next++;
      wpState.posts.set(p.external_id, { id, ...p, trashed: false });
      return send({ post_id: id, url: `https://sunrise.test/job/${p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`, status: p.status });
    }
    const m = req.url.match(/^\/wp-json\/hcjobs\/v1\/jobs\/(.+)$/);
    if (req.method === 'DELETE' && m) { const p = wpState.posts.get(m[1]); if (p) p.trashed = true; return send({ ok: true }); }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"code":"rest_no_route"}');
  });
});

const rec = (id, props) => ({ id, properties: props, updatedAt: new Date().toISOString() });

test('CareFunnels → WordPress sync', async (t) => {
  await new Promise((r) => cfServer.listen(0, r)); await new Promise((r) => wpServer.listen(0, r));
  process.env.DB_PATH = ':memory:';
  process.env.CF_API_BASE = `http://127.0.0.1:${cfServer.address().port}`;
  process.env.SECRET_KEY = 'test-secret';
  const { agencies, jobs } = require('../lib/db');
  const sync = require('../lib/sync');
  const a = agencies.create({
    name: 'Sunrise Home Care', city: 'Columbus', state: 'OH', website: 'https://sunrise.test',
    carefunnels_location_id: 'LOC123', cf_token: 'pit-abc',
    wp_url: `http://127.0.0.1:${wpServer.address().port}`, wp_user: 'jason', wp_app_password: 'abcd efgh ijkl mnop',
    apply_form_embed: 'https://link.carefunnels.com/widget/form/FORM1',
  });
  t.after(() => { cfServer.close(); wpServer.close(); });

  await t.test('connection test', async () => {
    const c = await sync.testConnections(agencies.byId(a.id));
    assert.equal(c.wordpress.ok, true);
    assert.equal(c.wordpress.wpjm_version, '2.4.0');
  });

  await t.test('new CareFunnels jobs are published to WordPress and the live URL is written back', async () => {
    cfState.records = [
      rec('r1', { job_title: 'Caregiver', status: 'open', category: 'caregiver', employment_type: 'part_time', pay_min: '16', pay_max: 19, pay_per: 'hour', shifts: ['weekends', 'evenings'], description: 'Help seniors.\n\n- Meals\n- Companionship' }),
      rec('r2', { job_title: 'CNA', status: { value: 'open' }, employment_type: 'Full-time', city: 'Dublin', pay_min: 21, expires_on: '2099-01-31' }),
      rec('r3', { job_title: 'Office Manager', status: 'draft' }),
    ];
    const r = await sync.syncAgency(a.id);
    assert.deepEqual(r.errors, []);
    assert.equal(r.records, 3); assert.equal(r.created, 3); assert.equal(r.pushed, 2, 'draft that was never published stays off WordPress');
    assert.equal(cfState.auth, 'Bearer pit-abc'); assert.equal(cfState.lastSearch.locationId, 'LOC123');
    const p1 = wpState.posts.get('r1');
    assert.equal(p1.status, 'publish'); assert.equal(p1.location, 'Columbus, OH'); assert.equal(p1.job_type, 'Part Time');
    assert.equal(p1.salary_min, 16); assert.equal(p1.salary_max, 19); assert.equal(p1.category, 'Caregiver');
    assert.match(p1.content_html, /<strong>Pay:<\/strong> \$16 – \$19\/hr/); assert.match(p1.content_html, /<li>Meals<\/li>/);
    assert.match(p1.content_html, /Weekends, Evenings/);
    assert.equal(p1.form.src, 'https://link.carefunnels.com/widget/form/FORM1');
    assert.match(p1.apply_url, /job_title=Caregiver/);
    assert.equal(wpState.posts.get('r2').location, 'Dublin, OH'); assert.equal(wpState.posts.get('r2').expires, '2099-01-31');
    const j1 = jobs.byExternal(a.id, 'r1');
    assert.equal(j1.wp_url, 'https://sunrise.test/job/caregiver/');
    assert.deepEqual(cfState.updates.map((u) => [u.id, u.locationId, u.body.properties.live_job_url]).sort(), [
      ['r1', 'LOC123', 'https://sunrise.test/job/caregiver/'], ['r2', 'LOC123', 'https://sunrise.test/job/cna/'],
    ]);
  });

  await t.test('nothing changed → nothing is sent again', async () => {
    const before = wpState.calls.length, beforeCf = cfState.updates.length;
    const r = await sync.syncAgency(a.id);
    assert.equal(r.pushed, 0); assert.equal(r.unchanged, 2);
    assert.equal(wpState.calls.length, before); assert.equal(cfState.updates.length, beforeCf);
  });

  await t.test('edit, mark filled, delete in CareFunnels', async () => {
    cfState.records = [
      rec('r1', { job_title: 'Caregiver', status: 'open', employment_type: 'part_time', pay_min: 17, pay_max: 20, pay_per: 'hour' }), // pay raised
      rec('r2', { job_title: 'CNA', status: 'filled' }),                                                                              // filled
      rec('r3', { job_title: 'Office Manager', status: 'draft' }),
    ]; // (nothing deleted yet)
    let r = await sync.syncAgency(a.id);
    assert.deepEqual(r.errors, []);
    assert.equal(wpState.posts.get('r1').salary_min, 17);
    assert.equal(wpState.posts.get('r2').status, 'expired'); assert.equal(wpState.posts.get('r2').filled, true);
    cfState.records = cfState.records.filter((x) => x.id !== 'r1'); // record deleted in CareFunnels
    r = await sync.syncAgency(a.id);
    assert.equal(r.removed, 1); assert.equal(wpState.posts.get('r1').trashed, true); assert.equal(jobs.byExternal(a.id, 'r1'), undefined);
  });

  await t.test('a broken record is held back as a draft and reported', async () => {
    cfState.records.push(rec('r4', { job_title: 'LPN', status: 'maybe' }));
    const r = await sync.syncAgency(a.id);
    assert.equal(r.problems.length, 1); assert.match(r.problems[0].problems[0], /Unknown Status "maybe"/);
    assert.equal(wpState.posts.has('r4'), false);
  });

  await t.test('if CareFunnels is down, nothing is removed from WordPress', async () => {
    cfState.fail = true;
    const r = await sync.syncAgency(a.id);
    cfState.fail = false;
    assert.equal(r.carefunnels, 'error'); assert.equal(r.removed, 0);
    assert.equal(wpState.posts.get('r2').trashed, false);
    assert.ok(jobs.byExternal(a.id, 'r2'));
  });

  await t.test('wrong WordPress password is reported clearly and stops the run', async () => {
    agencies.update(a.id, { wp_app_password: 'wrong pass' });
    cfState.records.push(rec('r5', { job_title: 'HHA', status: 'open' }));
    const r = await sync.syncAgency(a.id);
    assert.equal(r.wordpress, 'error'); assert.match(r.errors[0], /refused the login \(401\)/);
    agencies.update(a.id, { wp_app_password: 'abcd efgh ijkl mnop' });
    const r2 = await sync.syncAgency(a.id);
    assert.deepEqual(r2.errors, []); assert.equal(wpState.posts.get('r5').status, 'publish');
  });

  await t.test('credentials are stored encrypted and never returned by the admin API shape', () => {
    const raw = agencies.byId(a.id);
    assert.match(raw.cf_token, /^enc:v1:/); assert.match(raw.wp_app_password, /^enc:v1:/);
  });
});
