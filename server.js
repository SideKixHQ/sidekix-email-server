const express = require("express");
const cors    = require("cors");
const fs      = require("fs");
const path    = require("path");
const app     = express();

app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
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

      // Notify Make for follow-up sequences
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

// ── Keep alive ─────────────────────────────────────────────────────────────────
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || "https://sidekix-email-server.onrender.com";
  setInterval(() => {
    fetch(url)
      .then(() => console.log("Keep-alive ping sent."))
      .catch(err => console.log("Keep-alive ping failed:", err.message));
  }, 4 * 60 * 1000);
}

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("SideKix email server running on port " + PORT);
  keepAlive();
});
