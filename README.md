# Home Care Job Board

A multi-agency career site and job board. You host it once, and every home care agency client gets a job board on **their own website** from a two-line embed snippet. They also get a hosted, SEO-ready careers page, a Google for Jobs listing, and an Indeed/ZipRecruiter feed.

It has no dependencies: Node 22.13+ and the built-in SQLite. There's no build step and no `npm install`.

## What each agency gets

| Feature | How |
|---|---|
| Job board on their site | `<div id="hc-jobs" data-agency="slug"></div><script src="https://HOST/embed.js" defer></script>`. Works on WordPress, Wix, Squarespace, GoHighLevel/CareFunnels, Webflow, Duda and plain HTML. Shadow DOM keeps the site's CSS from breaking it, and the reverse. |
| "We're hiring" homepage teaser | Same snippet plus `data-limit="3" data-link="/careers"` |
| WordPress plugin | `wordpress/hc-jobs/`, shortcode `[hc_jobs]` |
| Hosted career site | `https://HOST/careers/<slug>` and `/careers/<slug>/<job>`. Server-rendered, with JobPosting JSON-LD and OG tags. You can point a `careers.agency.com` subdomain at it. |
| Google for Jobs | JobPosting structured data on hosted pages, and injected by the widget on embedded job pages. Sitemap at `/sitemaps/<slug>.xml`. |
| Job board syndication | Indeed-format XML feed at `/feeds/<slug>.xml` |
| Caregiver-friendly apply form | Mobile-first and about 2 minutes. Resume optional, with certifications (CNA/HHA/PCA…), availability and transportation. Includes a honeypot and a rate limit. |
| Applicant tracking (light) | Admin panel with stages (new → contacted → interview → hired/rejected), notes, resume download and CSV export |
| CRM hand-off | Every application is POSTed as JSON to the agency's webhook (GoHighLevel inbound webhook, Zapier or Make) so it can trigger SMS/email follow-up |
| Conversion tracking | Pushes `hc_job_application` to `dataLayer` (GTM/GA4) and fires the Meta Pixel `SubmitApplication` event |

## Run it

```bash
ADMIN_TOKEN=change-me BASE_URL=http://localhost:3000 npm start
```

```bash
npm run seed   # optional demo agency "sunrise-home-care"
```

- `http://localhost:3000/` is a demo "agency website" with the widget embedded
- `http://localhost:3000/admin` is the admin panel. Sign in with `ADMIN_TOKEN` (platform admin, sees all agencies) or with an agency's access key (that agency only).
- `http://localhost:3000/careers/sunrise-home-care` is the hosted career site

### Environment variables

| Var | Default | |
|---|---|---|
| `ADMIN_TOKEN` | — | Platform super-admin token. Required to create agencies. |
| `BASE_URL` | `http://localhost:PORT` | Public URL. Used in embed snippets, canonical URLs, JSON-LD and feeds. |
| `PORT` | 3000 | |
| `DB_PATH` | `data/jobs.db` | SQLite file |
| `UPLOAD_DIR` | `data/uploads` | Resume storage |

### Deploy

Any host that runs Node or Docker and has a persistent disk works: Render, Railway, Fly.io or a VPS.

```bash
docker build -t hc-jobs .
```

```bash
docker run -p 3000:3000 -v hcjobs:/data -e ADMIN_TOKEN=... -e BASE_URL=https://jobs.yourdomain.com hc-jobs
```

Put it behind HTTPS (the host's TLS, or Caddy/nginx). Back up `/data`.

## Onboarding a new agency (about 5 minutes)

1. Go to Admin → **+ New agency**. Enter the name, logo, brand color, address and the webhook URL from their CRM.
2. **Jobs** → post their openings. Use **Duplicate** for similar roles.
3. **Install on website** → copy the snippet onto their Careers page.
4. Submit the sitemap in their Google Search Console, and the XML feed to Indeed and other job boards.
5. Give them their access key (in **Agency settings**) if they'll manage jobs themselves.

## Webhook payload

```json
{
  "event": "application.created",
  "agency": { "slug": "sunrise-home-care", "name": "Sunrise Home Care", "notify_email": "hr@agency.com" },
  "job": { "id": 2, "title": "Certified Nursing Assistant (CNA)", "url": "https://…" },
  "applicant": { "first_name": "Maria", "last_name": "Lopez", "full_name": "Maria Lopez", "phone": "…", "email": "…",
                 "zip": "43215", "certifications": "CNA, CPR / First Aid", "availability": "Weekends",
                 "has_transport": true, "experience": "1–2", "message": "…", "source": "https://agency.com/careers?job=…",
                 "resume_url": "https://HOST/api/admin/…/resume", "tags": ["job-applicant", "CNA"] },
  "created_at": "2026-11-03 22:19:07"
}
```

`resume_url` needs the agency key as a Bearer token, so resumes aren't publicly readable.

## API

Public (CORS open):
- `GET /api/public/:agency` returns the agency and its open jobs
- `GET /api/public/:agency/jobs/:idOrSlug` returns the job, its description HTML and JSON-LD
- `POST /api/public/:agency/apply` (JSON; `resume: {name,type,data(base64)}` is optional)

Admin (`Authorization: Bearer <ADMIN_TOKEN | agency key>`):
- `/api/admin/me`
- `/api/admin/agencies[/:id]`
- `/api/admin/agencies/:id/jobs[/:job]`
- `/api/admin/agencies/:id/applications[/:app]`
- `/api/admin/agencies/:id/applications.csv`

## Not built yet / next steps

- **Email notifications** are sent through the webhook (a GHL, Zapier or Make automation), not directly. Adding SMTP or Resend is about 20 lines if you want it built in.
- **Separate login per agency staff member.** Today it's one shared key per agency.
- **Native ATS integrations** (WorkForce, HHAeXchange, AxisCare, WellSky…) aren't built. The webhook is the integration point.
- The rate limiter is in memory. For multi-instance deploys, use a shared store.
