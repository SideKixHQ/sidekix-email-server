const express = require("express");
const cors    = require("cors");
const fs      = require("fs");
const path    = require("path");
const app     = express();

app.use(cors({
  origin: "*",
  methods: ["GET","POST","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","X-SideKix-Secret"],
}));
app.use(express.json());
app.options("*", cors());

// ── Unsubscribe list (persisted to disk) ──────────────────────────────────────
const UNSUB_FILE = path.join("/tmp", "unsubscribes.json");

function loadUnsubscribes() {
  try {
    if (fs.existsSync(UNSUB_FILE)) {
      return JSON.parse(fs.readFileSync(UNSUB_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function saveUnsubscribes(list) {
  try {
    fs.writeFileSync(UNSUB_FILE, JSON.stringify(list), "utf8");
  } catch (e) {
    console.error("Failed to save unsubscribes:", e.message);
  }
}

function isUnsubscribed(email) {
  const list = loadUnsubscribes();
  return list.some(e => e.email && e.email.toLowerCase() === email.toLowerCase());
}

function addUnsubscribe(email) {
  const list = loadUnsubscribes();
  if (!isUnsubscribed(email)) {
    list.push({ email: email.toLowerCase(), date: new Date().toISOString() });
    saveUnsubscribes(list);
  }
}

// ── Send log store ────────────────────────────────────────────────────────────
const SENDLOG_FILE = path.join("/tmp", "sendlog.json");

function loadSendLog() {
  try {
    if (fs.existsSync(SENDLOG_FILE)) {
      return JSON.parse(fs.readFileSync(SENDLOG_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function saveSendLog(list) {
  try {
    fs.writeFileSync(SENDLOG_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save send log:", e.message);
  }
}

function appendSendLog(entry) {
  const list = loadSendLog();
  list.push({
    id:          Date.now().toString() + Math.random().toString(36).slice(2,6),
    ...entry,
    time:        new Date().toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit" }),
    sent_at:     new Date().toISOString(),
    opened:      false,
    clicked:     false,
    unsubscribed:false,
  });
  // Keep last 1000 entries
  if (list.length > 1000) list.splice(0, list.length - 1000);
  saveSendLog(list);
}

// ── Contacts store (persisted to disk) ────────────────────────────────────────
const CONTACTS_FILE = path.join("/tmp", "contacts.json");

function loadContacts() {
  try {
    if (fs.existsSync(CONTACTS_FILE)) {
      return JSON.parse(fs.readFileSync(CONTACTS_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function saveContacts(list) {
  try {
    fs.writeFileSync(CONTACTS_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save contacts:", e.message);
  }
}

function upsertContact(data) {
  const list = loadContacts();
  const email = (data.email || "").toLowerCase();
  const idx = list.findIndex(c => c.email.toLowerCase() === email);
  if (idx >= 0) {
    // Update existing — always preserve review status and notes
    const existing = list[idx];
    list[idx] = {
      ...existing,
      ...data,
      email,
      // Never overwrite these with incoming form data
      review:     existing.review     || "",
      notes:      existing.notes      || "",
      archived:   existing.archived   || false,
      // Preserve resume if new submission doesn't include one
      resume_url: data.resume_url || existing.resume_url || "",
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };
  } else {
    list.push({
      id:           Date.now().toString(),
      email,
      first_name:   data.first_name  || data.firstName  || "",
      last_name:    data.last_name   || data.lastName   || "",
      phone:        data.phone       || "",
      source:       data.source      || data.form_type  || "unknown",
      status:       "active",
      review:       data.source === "application" || data.form_type === "application" ? "Pending" : "",
      tags:         data.tags        || [],
      notes:        data.notes       || "",
      expertise:    data.expertise   || "",
      // Application fields
      background:   data.background  || "",
      strengths:    data.strengths   || "",
      challenge:    data.challenge   || "",
      why_sidekix:  data.why_sidekix || "",
      linkedin:     data.linkedin    || "",
      website:      data.website     || "",
      city:         data.city        || "",
      state:        data.state       || "",
      zip_code:     data.zip_code    || "",
      social_handles: data.social_handles || "",
      years_owner:  data.years_owner || "",
      business_types: data.business_types || "",
      prev_advisor: data.prev_advisor || "",
      languages:    data.languages   || "",
      resume_url:   data.resume_url  || "",
      archived:     false,
      created_at:   new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    });
  }
  saveContacts(list);
  return list.find(c => c.email.toLowerCase() === email);
}

// ── Follow-up sequence store ──────────────────────────────────────────────────
const FOLLOWUP_FILE = path.join("/tmp", "followups.json");

function loadFollowups() {
  try {
    if (fs.existsSync(FOLLOWUP_FILE)) {
      return JSON.parse(fs.readFileSync(FOLLOWUP_FILE, "utf8"));
    }
  } catch (e) {}
  return [];
}

function saveFollowups(list) {
  try {
    fs.writeFileSync(FOLLOWUP_FILE, JSON.stringify(list), "utf8");
  } catch (e) {
    console.error("Failed to save followups:", e.message);
  }
}

function addFollowup(email, firstName, formType) {
  const list = loadFollowups();
  // Don't add duplicates
  const exists = list.some(f => f.email.toLowerCase() === email.toLowerCase());
  if (!exists) {
    list.push({
      email:      email.toLowerCase(),
      first_name: firstName,
      form_type:  formType,
      added_at:   new Date().toISOString(),
      sent_day3:  false,
      sent_day7:  false,
      sent_day14: false,
    });
    saveFollowups(list);
    console.log("Follow-up sequence started for:", email);
  }
}

async function sendFollowupEmail(email, firstName, day) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return;

  if (isUnsubscribed(email)) {
    console.log("Skipping follow-up for unsubscribed:", email);
    return;
  }

  const name     = firstName || "";
  const greeting = name ? "Hi " + name + "," : "Hi there,";
  const unsub    = "\n\n---\nUnsubscribe: https://sidekix-email-server.onrender.com/unsubscribe?email=" + encodeURIComponent(email) + "\nSideKix - Character Limit LLC - Wilmington, NC";

  let subject, body;

  if (day === 3) {
    subject = name ? name + ", still thinking about SideKix?" : "Still thinking about SideKix?";
    body    = greeting + "\n\nJust checking in — it's been a few days since you reached out.\n\nWe'd love to help you get connected with the right advisor for your business. Whether you're just starting out or looking to scale, our network is ready for you.\n\nReady to take the next step? Visit sidekixhq.com to learn more.\n\nTalk soon,\nJames\nFounder, SideKix" + unsub;
  } else if (day === 7) {
    subject = "A quick note from SideKix";
    body    = greeting + "\n\nI wanted to personally follow up and make sure you had everything you need.\n\nSideKix is built for entrepreneurs who are serious about growth — and we believe the right advisor can change everything.\n\nIf you have any questions or want to learn more about how it works, just reply to this email.\n\nAlways here,\nJames\nFounder, SideKix" + unsub;
  } else if (day === 14) {
    subject = "Last one from us, " + (name || "friend") + " — we mean it";
    body    = greeting + "\n\nThis is the last email we'll send for now.\n\nThe people who get the most out of SideKix are the ones who decided to stop going it alone. If that ever sounds like you, we'll be at sidekixhq.com.\n\nWishing you the best,\nJames\nFounder, SideKix\n\nP.S. We don't delete your info — come back anytime." + unsub;
  } else {
    return;
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from:     { email: "joinus@sidekixhq.com", name: "James at SideKix" },
        reply_to: { email: "joinus@sidekixhq.com", name: "James at SideKix" },
        subject,
        content:  [{ type: "text/plain", value: body }],
      }),
    });

    if (response.status === 202) {
      console.log("Follow-up Day " + day + " sent to:", email);
      return true;
    } else {
      const err = await response.text();
      console.error("Follow-up send error:", err);
      return false;
    }
  } catch (err) {
    console.error("Follow-up fetch error:", err.message);
    return false;
  }
}


async function runFollowupScheduler() {
  const list = loadFollowups();
  const now  = new Date();
  let updated = false;

  for (const entry of list) {
    const addedAt  = new Date(entry.added_at);
    const daysSince = (now - addedAt) / (1000 * 60 * 60 * 24);

    if (!entry.sent_day3 && daysSince >= 3) {
      const ok = await sendFollowupEmail(entry.email, entry.first_name, 3);
      if (ok) { entry.sent_day3 = true; updated = true; }
    }
    if (!entry.sent_day7 && daysSince >= 7) {
      const ok = await sendFollowupEmail(entry.email, entry.first_name, 7);
      if (ok) { entry.sent_day7 = true; updated = true; }
    }
    if (!entry.sent_day14 && daysSince >= 14) {
      const ok = await sendFollowupEmail(entry.email, entry.first_name, 14);
      if (ok) { entry.sent_day14 = true; updated = true; }
    }
  }

  if (updated) saveFollowups(list);
  console.log("Follow-up scheduler ran. Checked " + list.length + " entries.");
}

// ── Auth middleware ────────────────────────────────────────────────────────────
function requireSecret(req, res, next) {
  const secret = req.headers["x-sidekix-secret"];
  if (!secret || secret !== process.env.SIDEKIX_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  next();
}

// ── Health check ───────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "SideKix email server is running." });
});

// ── Unsubscribe endpoint (no auth — public link in emails) ─────────────────────
app.get("/unsubscribe", (req, res) => {
  const email = req.query.email || "";
  if (!email) {
    return res.status(400).send("Missing email address.");
  }

  addUnsubscribe(email);
  console.log("Unsubscribed:", email);

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed - SideKix</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', sans-serif; background: #1C1A14; color: #F0EAD6; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: #242017; border: 1px solid #3A3528; border-radius: 16px; padding: 48px 40px; max-width: 480px; width: 100%; text-align: center; }
    .check { width: 64px; height: 64px; border: 2px solid #C9A96E; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
    h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; color: #F0EAD6; }
    p { font-size: 15px; color: rgba(240,234,214,0.65); line-height: 1.6; margin-bottom: 8px; }
    .email { color: #C9A96E; }
    .home { display: inline-block; margin-top: 32px; padding: 12px 28px; background: #C9A96E; color: #1C1A14; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#C9A96E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>You're unsubscribed</h1>
    <p>We've removed <span class="email">${email}</span> from our mailing list.</p>
    <p>You won't receive any more emails from SideKix.</p>
    <a href="https://sidekixhq.com" class="home">Back to SideKix</a>
  </div>
</body>
</html>`);
});

// ── Get unsubscribe list (portal uses this to sync status) ─────────────────────
app.get("/unsubscribes", requireSecret, (req, res) => {
  const list = loadUnsubscribes();
  res.json({ success: true, unsubscribes: list });
});

// ── Manually unsubscribe from portal ──────────────────────────────────────────
app.post("/unsubscribe", requireSecret, (req, res) => {
  const email = req.body.email || "";
  if (!email) {
    return res.status(400).json({ success: false, message: "Missing email." });
  }
  addUnsubscribe(email);
  console.log("Portal unsubscribed:", email);
  res.json({ success: true, message: "Unsubscribed: " + email });
});

// ── Send email ─────────────────────────────────────────────────────────────────
app.post("/send-email", requireSecret, async (req, res) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: "SendGrid API key not configured." });
  }

  const { to, from, fromName, replyTo, subject, body, html } = req.body;

  if (!to || !from || !subject || !body) {
    return res.status(400).json({ success: false, message: "Missing required fields: to, from, subject, body." });
  }

  // Block unsubscribed emails
  if (isUnsubscribed(to)) {
    console.log("Blocked send to unsubscribed email:", to);
    return res.json({ success: false, message: "Email is unsubscribed.", unsubscribed: true });
  }

  const finalBody    = body.replace(/{{email}}/g, to).replace(/{{first_name}}/g, to.split("@")[0]);
  const finalSubject = subject.replace(/{{email}}/g, to).replace(/{{first_name}}/g, to.split("@")[0]);

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from:     { email: from, name: fromName || "SideKix" },
    reply_to: { email: replyTo || from, name: fromName || "SideKix" },
    subject:  finalSubject,
    content: [{ type: "text/plain", value: finalBody }],
  };

  if (html) {
    payload.content.push({ type: "text/html", value: html });
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 202) {
      console.log("Email sent to:", to, "| Subject:", subject);
      appendSendLog({
        first_name: to.split("@")[0],
        last_name:  "",
        email:      to,
        template:   subject.length > 40 ? subject.slice(0,40) + "…" : subject,
        subject,
        routed_to:  from,
        log_type:   from.toLowerCase().includes("advisor") ? "advisor" : "subscriber",
        status:     "delivered",
      });
      return res.json({ success: true, message: "Email sent." });
    } else {
      const errorBody = await response.text();
      console.error("SendGrid error:", response.status, errorBody);
      return res.status(500).json({ success: false, message: "SendGrid rejected the request.", detail: errorBody });
    }
  } catch (err) {
    console.error("Fetch error:", err.message);
    return res.status(500).json({ success: false, message: "Server error.", detail: err.message });
  }
});

// ── Webhook ────────────────────────────────────────────────────────────────────
app.post("/webhook", requireSecret, async (req, res) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: "SendGrid API key not configured." });
  }

  const data      = req.body;
  const formType  = data.form_type;
  const email     = data.email;
  const firstName = data.first_name || data.firstName || "there";
  const promoCode = data.promo_code || "";

  if (!email || !formType) {
    return res.status(400).json({ success: false, message: "Missing email or form_type." });
  }

  // Block unsubscribed emails
  if (isUnsubscribed(email)) {
    console.log("Blocked webhook to unsubscribed email:", email);
    return res.json({ success: false, message: "Email is unsubscribed.", unsubscribed: true });
  }

  let from, fromName, subject, body;

  const name     = firstName && firstName !== "there" ? firstName : "";
  const greeting = name ? "Hi " + name + "," : "Hi there,";
  const unsub    = "\n\n---\nUnsubscribe: https://sidekix-email-server.onrender.com/unsubscribe?email=" + encodeURIComponent(email) + "\nSideKix - Character Limit LLC - Wilmington, NC";

  if (formType === "application") {
    from     = "Advisors@sidekixhq.com";
    fromName = "SideKix Advisors";
    subject  = name ? "We received your SideKix application, " + name + "!" : "We received your SideKix application!";
    body     = greeting + "\n\nThanks for applying to become a SideKix Advisor! We're excited to review your application.\n\nHere's what happens next:\n- Our team will review your application within 2-3 business days\n- You'll receive an email with next steps\n- In the meantime, feel free to explore sidekixhq.com\n\nTalk soon,\nThe SideKix Team" + unsub;

  } else if (formType === "subscriber") {
    from     = "joinus@sidekixhq.com";
    fromName = "SideKix";
    subject  = name ? "Welcome to SideKix, " + name + "!" : "Welcome to SideKix!";
    body     = greeting + "\n\nWelcome to SideKix! You're now on our list.\n\nWhat you can expect:\n- Insider tips on getting the most out of the platform\n- Early access to new features and advisors\n- Exclusive member-only content\n\nReady to get started? Visit sidekixhq.com\n\nTalk soon,\nThe SideKix Team" + unsub;

  } else if (formType === "waitlist") {
    from     = "joinus@sidekixhq.com";
    fromName = "SideKix";
    subject  = name ? "You're on the SideKix waitlist, " + name + "!" : "You're on the SideKix waitlist!";
    const promoLine = promoCode ? "\n\nYour exclusive promo code: " + promoCode + "\nUse it for early access pricing when we launch." : "\n\nAs a waitlist member, you'll get early access and our best launch pricing.";
    body     = greeting + "\n\nYou're officially on the SideKix waitlist — and you're in good company.\n\nWe're building something that will change how entrepreneurs get support, and you'll be among the first to know when we launch." + promoLine + "\n\nStay tuned — big things are coming.\n\nJames\nFounder, SideKix" + unsub;

  } else if (formType === "contact") {
    from     = "joinus@sidekixhq.com";
    fromName = "SideKix";
    subject  = "Got your message — we'll be in touch soon";
    body     = greeting + "\n\nThanks for reaching out! We'll get back to you within 1 business day.\n\nTalk soon,\nThe SideKix Team" + unsub;

  } else {
    return res.status(400).json({ success: false, message: "Unknown form_type: " + formType });
  }

  try {
    const finalBody    = body.replace(/\{\{email\}\}/g, email).replace(/\{\{first_name\}\}/g, firstName).replace(/\{\{promo_code\}\}/g, promoCode);
    const finalSubject = subject.replace(/\{\{email\}\}/g, email).replace(/\{\{first_name\}\}/g, firstName);

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from:     { email: from, name: fromName },
        reply_to: { email: from, name: fromName },
        subject:  finalSubject,
        content:  [{ type: "text/plain", value: finalBody }],
      }),
    });

    if (response.status === 202) {
      console.log("Email sent to:", email, "| Subject:", finalSubject);

      // Save contact to persistent store
      upsertContact({
        email,
        first_name:     firstName,
        last_name:      data.last_name      || data.lastName   || "",
        phone:          data.phone          || "",
        source:         formType,
        form_type:      formType,
        expertise:      data.expertise      || "",
        background:     data.background     || "",
        strengths:      data.strengths      || "",
        challenge:      data.challenge      || "",
        why_sidekix:    data.why_sidekix    || "",
        linkedin:       data.linkedin       || "",
        website:        data.website        || "",
        city:           data.city           || "",
        state:          data.state          || "",
        zip_code:       data.zip_code       || "",
        social_handles: data.social_handles || "",
        years_owner:    data.years_owner    || "",
        business_types: data.business_types || "",
        prev_advisor:   data.prev_advisor   || "",
        languages:      data.languages      || "",
        resume_url:     data.resume_url     || "",
      });
      console.log("Contact saved:", email, "| source:", formType);

      // Append to send log
      appendSendLog({
        first_name: firstName,
        last_name:  data.last_name || data.lastName || "",
        email,
        template:   formType === "application" ? "Application Received"
                  : formType === "subscriber"  ? "Subscriber Welcome"
                  : formType === "waitlist"    ? "Waitlist Confirmation"
                  : formType === "contact"     ? "Contact Form Reply"
                  : "Email",
        subject:    finalSubject,
        routed_to:  from,
        log_type:   formType === "application" ? "advisor" : "subscriber",
        status:     "delivered",
      });

      // Add to follow-up sequence — skip advisor applicants
      if (formType !== "application") {
        addFollowup(email, firstName, formType);
      }

      // Notify Make
      const makeUrl = "https://hook.us2.make.com/2f7zckyzjj1nus3qf8h8qgiubdndgibk";
      fetch(makeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form_type:   formType,
          email:       email,
          first_name:  firstName,
          promo_code:  promoCode,
          submitted_at: new Date().toISOString(),
        }),
      }).catch(err => console.log("Make notification failed:", err.message));

      return res.json({ success: true, message: "Email sent.", formType, email });
    } else {
      const errorBody = await response.text();
      console.error("SendGrid webhook error:", response.status, errorBody);
      return res.status(500).json({ success: false, message: "SendGrid error.", detail: errorBody });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Send log endpoints ────────────────────────────────────────────────────────
app.get("/sendlog", requireSecret, (req, res) => {
  res.json({ success: true, logs: loadSendLog() });
});

app.delete("/sendlog/:id", requireSecret, (req, res) => {
  let list = loadSendLog();
  list = list.filter(e => e.id !== req.params.id);
  saveSendLog(list);
  res.json({ success: true });
});

app.delete("/sendlog", requireSecret, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ success:false, message:"ids required" });
  let list = loadSendLog();
  list = list.filter(e => !ids.includes(e.id));
  saveSendLog(list);
  res.json({ success: true, deleted: ids.length });
});

// ── Contacts CRUD ─────────────────────────────────────────────────────────────

// GET all contacts
app.get("/contacts", requireSecret, (req, res) => {
  const contacts = loadContacts();
  res.json({ success: true, contacts });
});

// POST create/upsert a contact manually
app.post("/contacts", requireSecret, (req, res) => {
  const data = req.body;
  if (!data.email) return res.status(400).json({ success: false, message: "email required" });
  const contact = upsertContact(data);
  res.json({ success: true, contact });
});

// PATCH update a contact by id
app.patch("/contacts/:id", requireSecret, (req, res) => {
  const list = loadContacts();
  const idx  = list.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ success: false, message: "Contact not found" });
  list[idx] = { ...list[idx], ...req.body, id: list[idx].id, updated_at: new Date().toISOString() };
  saveContacts(list);
  console.log("Contact updated:", list[idx].email, "| fields:", Object.keys(req.body).join(", "));
  res.json({ success: true, contact: list[idx] });
});

// DELETE a contact by id
app.delete("/contacts/:id", requireSecret, (req, res) => {
  let list = loadContacts();
  const contact = list.find(c => c.id === req.params.id);
  if (!contact) return res.status(404).json({ success: false, message: "Contact not found" });
  list = list.filter(c => c.id !== req.params.id);
  saveContacts(list);
  console.log("Contact deleted:", contact.email);
  res.json({ success: true, message: "Deleted." });
});

// PATCH bulk update (for archive/status changes on multiple)
app.patch("/contacts", requireSecret, (req, res) => {
  const { ids, updates } = req.body;
  if (!ids || !Array.isArray(ids) || !updates) {
    return res.status(400).json({ success: false, message: "ids array and updates object required" });
  }
  const list = loadContacts();
  let count = 0;
  ids.forEach(id => {
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updates, id: list[idx].id, updated_at: new Date().toISOString() };
      count++;
    }
  });
  saveContacts(list);
  res.json({ success: true, updated: count });
});

// DELETE bulk delete
app.delete("/contacts", requireSecret, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ success: false, message: "ids array required" });
  }
  let list = loadContacts();
  const before = list.length;
  list = list.filter(c => !ids.includes(c.id));
  saveContacts(list);
  console.log("Bulk deleted:", before - list.length, "contacts");
  res.json({ success: true, deleted: before - list.length });
});

// ── View follow-up list (admin) ───────────────────────────────────────────────
app.get("/followups", requireSecret, (req, res) => {
  res.json({ success: true, followups: loadFollowups() });
});

// ── Manually trigger scheduler (admin) ────────────────────────────────────────
app.post("/followups/run", requireSecret, async (req, res) => {
  await runFollowupScheduler();
  res.json({ success: true, message: "Scheduler ran." });
});

// ── Keep alive ─────────────────────────────────────────────────────────────────
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || "https://sidekix-email-server.onrender.com";
  setInterval(() => {
    fetch(url)
      .then(() => console.log("Keep-alive ping sent."))
      .catch(err => console.log("Keep-alive ping failed:", err.message));
  }, 4 * 60 * 1000);
}

// ── Follow-up scheduler — runs every 12 hours ─────────────────────────────────
function startFollowupScheduler() {
  // Run once on startup
  runFollowupScheduler();
  // Then every 12 hours
  setInterval(() => {
    runFollowupScheduler();
  }, 12 * 60 * 60 * 1000);
}

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("SideKix email server running on port " + PORT);
  keepAlive();
  startFollowupScheduler();
});
