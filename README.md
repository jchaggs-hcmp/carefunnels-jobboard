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

## CareFunnels application forms (applicants go straight into the client's sub-account)

Each agency can use **its own CareFunnels form** for the apply step instead of the built-in form:

1. In the client's CareFunnels sub-account, go to **Sites → Forms → (form) → Integrate → Embed** and copy the embed code. The form's share link also works.
2. In this admin, go to **Agency settings → CareFunnels application form**, paste it and save. The field shows the detected form ID straight away, or an error if the paste isn't a valid form.
3. *(Optional)* Paste a different form on an individual job, for example a CNA-specific form. Jobs without one use the agency's form.

Every job's apply step and the general application then show that form, so submissions create or update contacts in the client's sub-account and trigger its workflows.

**Recording which job someone applied for.** The widget adds these values to the form URL. Add **Hidden** fields to the CareFunnels form with matching **Query Keys**, and they'll be saved on the contact:

`job_title` · `job_id` · `job_location` · `job_category` · `job_url` · `application_source` · `utm_source` · `utm_medium` · `utm_campaign` · `utm_term` · `utm_content` · `gclid` · `fbclid`

How it works: the pasted HTML is never shown to visitors as-is. The server pulls out and checks the form URL (https only), the form ID and the `data-*` layout attributes, then the widget builds its own iframe from those. The iframe is placed in the page's normal DOM through a `<slot>`, so CareFunnels' `form_embed.js` can find it to auto-size it and track it. If no CareFunnels form is set, the built-in form and webhook are used.

## Client careers domains (job URLs on the client's own domain)

Each agency can have its careers site on **its own subdomain**, such as `careers.sunrisehomecare.com`:

| Page | URL |
|---|---|
| Careers home | `https://careers.sunrisehomecare.com/` |
| Job page | `https://careers.sunrisehomecare.com/jobs/caregiver-personal-care-aide` |
| Sitemap (submit in the client's Search Console) | `https://careers.sunrisehomecare.com/sitemap.xml` |
| Indeed / job board feed | `https://careers.sunrisehomecare.com/feed.xml` |

**Setup for each client:**
1. In Admin, go to **Agency settings → Careers domain** and enter `careers.<theirdomain>.com`.
2. Ask whoever manages the client's domain to add the DNS record shown on **Install on website**: `CNAME  careers → <your platform domain>`. On Cloudflare, set it to *DNS only*.
3. That's it. HTTPS is issued automatically, and the platform re-checks pending domains every 10 minutes. The domain shows **live** once the record works, or click **Check now**.

**What changes when the domain goes live:**
- Google for Jobs data, the Indeed feed, the sitemap and every job link switch to the client's domain.
- Old platform URLs (`/careers/<slug>/…`, `/feeds/…`, `/sitemaps/…`) 301-redirect there, so nothing breaks.
- Copies of the widget embedded on the client's main website stop adding Google for Jobs data, so Google sees exactly one posting per job, on the careers domain.
- Until the domain is verified, links stay on the platform URL. Google and Indeed are never handed a domain that doesn't work yet.
- The admin panel can't be reached on client domains. They only serve the careers site, the widget and the public API.

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
| `DOMAIN_TARGET` | host of `BASE_URL` | What client CNAME records point to |

### Deploy (recommended: one VPS with Docker)

Client careers domains need a certificate for every client hostname, so the recommended setup is a small VPS (DigitalOcean, Hetzner, Lightsail and so on, about $6–12/month) running `deploy/docker-compose.yml`. It runs the app plus **Caddy**, which issues free Let's Encrypt certificates on demand. Caddy asks the app (`/internal/tls-allowed`) first, and only gets a yes for domains saved on an agency.

1. Point `jobs.yourdomain.com` (an A record) at the server's IP.
2. Copy and edit the environment file:

```bash
cp deploy/.env.example deploy/.env
```

3. Start it:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Back up the `jobdata` volume, which holds the database and resumes.

Managed hosts (Render, Railway, Fly.io) also work, but you'd add every client domain in their dashboard by hand, and some cap how many custom domains you can have.

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
