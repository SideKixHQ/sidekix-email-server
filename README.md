[README.md](https://github.com/user-attachments/files/27860744/README.md)
# SideKix Email Server

Node.js email server that connects the SideKix Team Portal and WordPress forms to SendGrid. Handles all transactional emails for sidekixhq.com.

---

## Live URL

```
https://sidekix-email-server.onrender.com
```

---

## Architecture

```
WordPress Form Submission
        ↓
sidekix_trigger_email() in functions.php
        ↓
POST /webhook  ←─── this server ───→  SendGrid API
        ↑                                   ↓
SideKix Team Portal                  Email delivered
(Send Test / Interview / Rejection)   to recipient
```

---

## Endpoints

### `GET /`
Health check. Returns `{ "status": "SideKix email server is running." }`

---

### `POST /send-email`
Sends a single email. Used by the SideKix Team Portal for Send Test, interview invitations, and rejection emails.

**Headers:**
```
Content-Type: application/json
X-SideKix-Secret: sidekix2026
```

**Body:**
```json
{
  "to":       "recipient@example.com",
  "from":     "joinus@sidekixhq.com",
  "fromName": "SideKix",
  "replyTo":  "joinus@sidekixhq.com",
  "subject":  "Your subject line",
  "body":     "Plain text email body",
  "html":     "<p>Optional HTML version</p>"
}
```

**Variable substitution** — automatically replaced before sending:
- `{{email}}` → recipient email address
- `{{first_name}}` → derived from email username if not provided

---

### `POST /webhook`
Triggered by WordPress on form submission. Sends the confirmation email to the person who submitted.

**Headers:**
```
Content-Type: application/json
X-SideKix-Secret: sidekix2026
```

**Body:**
```json
{
  "form_type":  "contact",
  "email":      "user@example.com",
  "first_name": "Jane",
  "promo_code": "LAUNCH20"
}
```

**Supported form_type values:**

| form_type | Sends from | Purpose |
|-----------|-----------|---------|
| `application` | Advisors@sidekixhq.com | Advisor application received |
| `subscriber` | joinus@sidekixhq.com | Subscriber welcome |
| `waitlist` | joinus@sidekixhq.com | Waitlist confirmation + optional promo code |
| `contact` | joinus@sidekixhq.com | Contact form confirmation |

**Variable substitution** — `{{email}}`, `{{first_name}}`, and `{{promo_code}}` are replaced in all bodies before sending.

---

## Environment Variables

Set in the Render dashboard under Environment:

| Variable | Description |
|----------|-------------|
| `SENDGRID_API_KEY` | SendGrid API key with Mail Send permission |
| `SIDEKIX_SECRET` | Shared secret to protect endpoints (default: sidekix2026) |
| `PORT` | Set automatically by Render — do not change |
| `RENDER_EXTERNAL_URL` | Set automatically by Render — used for keep-alive |

---

## Keep-Alive

The server pings itself every 4 minutes to prevent Render free tier from spinning down. Upgrade to Render Starter ($7/mo) for always-on.

---

## Authentication

Every request must include:
```
X-SideKix-Secret: sidekix2026
```

To change the secret, update `SIDEKIX_SECRET` in Render and the matching value in:
- `functions.php` on WordPress (in `sidekix_trigger_email`)
- `SERVER_SECRET` constant in the portal's `index.html`

---

## WordPress Integration

Called from `functions.php` via `sidekix_trigger_email()` after each form:

```php
sidekix_trigger_email( 'contact',     $email,   $first );
sidekix_trigger_email( 'application', $email,   $first );
sidekix_trigger_email( 'waitlist',    $email,   $name  );
sidekix_trigger_email( 'contact',     $website, $business_name );
```

---

## Sender Addresses

| Address | Used for |
|---------|----------|
| `joinus@sidekixhq.com` | Subscriber, waitlist, contact emails |
| `Advisors@sidekixhq.com` | Advisor application, interview, rejection emails |

Both verified in SendGrid under Settings → Sender Authentication.

---

## SPF Record

```
v=spf1 include:spf.em.secureserver.net include:dc-aa8e722993._spfm.sidekixhq.com include:_spf.wpcloud.com include:sendgrid.net include:_spf.google.com ~all
```

---

## Deploying Updates

1. Edit `server.js`
2. Push to `main` branch of `SideKixHQ/sidekix-email-server`
3. Render auto-deploys within 2 minutes
4. Confirm in Render logs: "Your service is live"

---

## Related Repos

| Repo | Purpose |
|------|---------|
| `SideKixHQ/sidekix-portal` | Team portal frontend — GitHub Pages |
| `SideKixHQ/sidekix-email-server` | This repo — email backend on Render |

---

## Stack

- **Runtime:** Node.js 18+
- **Framework:** Express
- **Email:** SendGrid v3 API
- **Hosting:** Render (free tier)
- **Auth:** Shared secret header
