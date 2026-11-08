# CareFunnels "Jobs" custom object

Jobs are entered in each client's CareFunnels sub-account as records of a **Jobs** custom object. The hub reads them and publishes them to the client's WordPress site (WP Job Manager).

Build the object once in a test sub-account, then add it to your **snapshot** so every client gets it.

## 1. Create the object (CareFunnels UI)

**Settings → Objects → + Add Custom Object**

| Setting | Value |
|---|---|
| Singular name | `Job` |
| Plural name | `Jobs` |
| Object key | `custom_objects.jobs` |
| Primary display field | `Job Title` (key `job_title`) |

> The connected API can add fields but can't create the object itself, so this step is done by hand. Once the object exists, Claude can add the fields below through the API.

## 2. Fields

The **field key** (the last part, after `custom_objects.jobs.`) must match exactly. Labels can be anything.

| Label | Field key | Type | Options (key → label) |
|---|---|---|---|
| Job Title | `job_title` | Text (primary) | |
| Status | `status` | Dropdown (single) | `open` Open · `draft` Draft · `filled` Filled |
| Category | `category` | Dropdown (single) | `caregiver` Caregiver · `companion` Companion · `cna` CNA · `hha` HHA · `lpn` LPN · `rn` RN · `live_in_caregiver` Live-in Caregiver · `office` Office / Admin |
| Employment Type | `employment_type` | Dropdown (single) | `full_time` Full-time · `part_time` Part-time · `per_diem` Per diem · `contract` Contract |
| City | `city` | Text | Blank = agency's city |
| State | `state` | Text | 2 letters |
| ZIP | `zip` | Text | |
| Pay Min | `pay_min` | Number | e.g. `16` |
| Pay Max | `pay_max` | Number | e.g. `19` |
| Pay Per | `pay_per` | Dropdown (single) | `hour` Hour · `day` Day · `week` Week · `year` Year |
| Shifts | `shifts` | Dropdown (multiple) | `days` Days · `evenings` Evenings · `overnights` Overnights · `weekends` Weekends · `live_in` Live-in |
| Summary | `summary` | Text | One line, shown in job lists |
| Description | `description` | Multi-line text | Blank line = new paragraph; lines starting with `- ` = bullets |
| Requirements | `requirements` | Multi-line text | Same formatting |
| Benefits | `benefits` | Multi-line text | Same formatting |
| Expires On | `expires_on` | Date | Optional; the job is taken down automatically after this date |
| Application Form | `application_form` | Text | Optional: a CareFunnels form link, only if this job uses a different form from the agency default |
| Live Job URL | `live_job_url` | Text | **Filled in by the hub.** The job's page on the client's website. |

## 3. Private Integration token (one per sub-account)

**Settings → Private Integrations → Create new integration**

- Name: `Job Sync`
- Scopes: `objects/record.readonly`, `objects/record.write`, `objects/schema.readonly`

Paste the token into the hub at **Admin → CareFunnels → WordPress → Private Integration token**. Don't send it by email or chat.

## 4. Optional: instant sync workflow

Without this the hub checks for changes every 5 minutes (`SYNC_INTERVAL_MINUTES`). For instant updates:

- **Trigger:** Jobs, record created / record updated (and deleted, if available)
- **Action:** Webhook (POST) to the URL shown in **Admin → CareFunnels → WordPress**

## How statuses map to the website

| CareFunnels Status | WordPress (WP Job Manager) |
|---|---|
| Open | Published |
| Draft | Not published. If it was published before, it goes back to draft. |
| Filled | Expired and marked filled (off the job list and out of Google for Jobs) |
| Record deleted | Moved to the trash |
| Expires On has passed | Expired |
| Missing title or an unknown status | Held back as a draft and listed under **Held back** in the hub's sync report |
