const express = require("express");
const cors    = require("cors");
const app     = express();

app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","X-SideKix-Secret"],
}));
app.use(express.json());

// Handle preflight OPTIONS requests
app.options("*", cors());

// ── Auth middleware ────────────────────────────────────────────────────────────
// Every request must include header: X-SideKix-Secret: <your secret>
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

// ── Send email ─────────────────────────────────────────────────────────────────
// POST /send-email
// Body: { to, from, fromName, replyTo, subject, body, html? }
app.post("/send-email", requireSecret, async (req, res) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: "SendGrid API key not configured." });
  }

  const { to, from, fromName, replyTo, subject, body, html } = req.body;

  if (!to || !from || !subject || !body) {
    return res.status(400).json({ success: false, message: "Missing required fields: to, from, subject, body." });
  }

  // Replace template variables
  const finalBody    = body.replace(/{{email}}/g, to).replace(/{{first_name}}/g, to.split("@")[0]);
  const finalSubject = subject.replace(/{{email}}/g, to).replace(/{{first_name}}/g, to.split("@")[0]);

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from:     { email: from, name: fromName || "SideKix" },
    reply_to: { email: replyTo || from, name: fromName || "SideKix" },
    subject:  finalSubject,
    content: [{ type: "text/plain", value: finalBody }],
  };

  // Add HTML version if provided
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

// ── Webhook endpoint for Make ──────────────────────────────────────────────────
// POST /webhook
// Make sends form data here, server decides which email to fire
app.post("/webhook", requireSecret, async (req, res) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: "SendGrid API key not configured." });
  }

  const data      = req.body;
  const formType  = data.form_type; // "application" | "subscriber" | "contact" | "waitlist"
  const email     = data.email;
  const firstName = data.first_name || data.firstName || "there";
  const promoCode = data.promo_code || "";

  if (!email || !formType) {
    return res.status(400).json({ success: false, message: "Missing email or form_type." });
  }

  // Build email based on form type
  let from, fromName, subject, body;

  // Use first name or friendly fallback
  const name = firstName && firstName !== "there" ? firstName : "";
  const greeting = name ? "Hi " + name + "," : "Hi there,";

  if (formType === "application") {
    from     = "Advisors@sidekixhq.com";
    fromName = "SideKix Advisors";
    subject  = name ? "We received your SideKix application, " + name + "!" : "We received your SideKix application!";
    body     = greeting + "\n\nThanks for applying to become a SideKix Advisor! We're excited to review your application.\n\nHere's what happens next:\n- Our team will review your application within 2-3 business days\n- You'll receive an email with next steps\n- In the meantime, feel free to explore sidekixhq.com\n\nTalk soon,\nThe SideKix Team\n\n---\nTo unsubscribe: https://sidekixhq.com/unsubscribe?email=" + email + "\nSideKix - Character Limit LLC - Wilmington, NC";

  } else if (formType === "subscriber") {
    from     = "joinus@sidekixhq.com";
    fromName = "SideKix";
    subject  = name ? "Welcome to SideKix, " + name + "!" : "Welcome to SideKix!";
    body     = greeting + "\n\nWelcome to SideKix! You're now on our list.\n\nWhat you can expect:\n- Insider tips on getting the most out of the platform\n- Early access to new features and advisors\n- Exclusive member-only content\n\nReady to get started? Visit sidekixhq.com\n\nTalk soon,\nThe SideKix Team\n\n---\nTo unsubscribe: https://sidekixhq.com/unsubscribe?email=" + email + "\nSideKix - Character Limit LLC - Wilmington, NC";

  } else if (formType === "waitlist") {
    from     = "joinus@sidekixhq.com";
    fromName = "SideKix";
    subject  = name ? "You're on the SideKix waitlist, " + name + "!" : "You're on the SideKix waitlist!";
    const promoLine = promoCode ? "\n\nYour exclusive promo code: " + promoCode + "\nUse it for early access pricing when we launch." : "\n\nAs a waitlist member, you'll get early access and our best launch pricing.";
    body     = greeting + "\n\nYou're officially on the SideKix waitlist — and you're in good company.\n\nWe're building something that will change how entrepreneurs get support, and you'll be among the first to know when we launch." + promoLine + "\n\nStay tuned — big things are coming.\n\nJames\nFounder, SideKix\n\n---\nTo unsubscribe: https://sidekixhq.com/unsubscribe?email=" + email + "\nSideKix - Character Limit LLC - Wilmington, NC";

  } else if (formType === "contact") {
    from     = "joinus@sidekixhq.com";
    fromName = "SideKix";
    subject  = "Got your message — we'll be in touch soon";
    body     = greeting + "\n\nThanks for reaching out! We'll get back to you within 1 business day.\n\nTalk soon,\nThe SideKix Team\n\n---\nTo unsubscribe: https://sidekixhq.com/unsubscribe?email=" + email + "\nSideKix - Character Limit LLC - Wilmington, NC";

  } else {
    return res.status(400).json({ success: false, message: "Unknown form_type: " + formType });
  }

  try {
    // Replace template variables with actual values
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
      console.log("Webhook email sent:", formType, "->", email);
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

// ── Keep alive — ping self every 4 minutes to prevent Render free tier sleep ───
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
