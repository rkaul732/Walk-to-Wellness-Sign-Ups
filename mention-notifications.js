import { readFile } from "node:fs/promises";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = "Walk to Wellness System <noreply@bhhwalktowellness.com>";
const EMAIL_BATCH_LIMIT = 50;

export async function loadLocalParticipantContacts(logger = console) {
  try {
    const localContactsPath = new URL("./data/participant-contacts.json", import.meta.url);
    const raw = await readFile(localContactsPath, "utf8");
    return normalizeParticipantContacts(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      logger.warn?.(`Could not read local participant contacts: ${error.message}`);
    }

    return [];
  }
}

export function normalizeParticipantContacts(rows) {
  if (!Array.isArray(rows)) return [];

  const seen = new Set();
  const contacts = [];

  for (const row of rows) {
    const fullName = cleanString(row.fullName || row.full_name || row.name);
    const email = cleanString(row.email).toLowerCase();
    const active = row.active !== false;

    if (!active || !fullName || !isEmail(email)) continue;

    const key = `${nameKey(fullName)}|${email}`;
    if (seen.has(key)) continue;

    seen.add(key);
    contacts.push({ fullName, email });
  }

  return contacts.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function findMentionedContacts(messageText, contacts) {
  const text = String(messageText || "");
  const mentionedByEmail = new Map();

  for (const contact of normalizeParticipantContacts(contacts)) {
    if (isMentioned(text, contact.fullName)) {
      mentionedByEmail.set(contact.email, contact);
    }
  }

  return [...mentionedByEmail.values()];
}

export async function sendMentionNotifications({
  authorName,
  messageText,
  contacts,
  siteUrl,
  logger = console
}) {
  const mentionedContacts = findMentionedContacts(messageText, contacts).slice(0, EMAIL_BATCH_LIMIT);

  if (!mentionedContacts.length) {
    return { mentioned: 0, sent: 0, skipped: 0, errors: [] };
  }

  const apiKey = cleanString(process.env.RESEND_API_KEY);

  if (!apiKey) {
    logger.warn?.("RESEND_API_KEY is not configured; mention emails were not sent.");
    return {
      mentioned: mentionedContacts.length,
      sent: 0,
      skipped: mentionedContacts.length,
      errors: ["RESEND_API_KEY is not configured."]
    };
  }

  const errors = [];
  let sent = 0;

  for (const contact of mentionedContacts) {
    try {
      await sendMentionEmail({
        apiKey,
        contact,
        authorName,
        siteUrl
      });
      sent += 1;
    } catch (error) {
      errors.push(`${contact.email}: ${error.message}`);
      logger.error?.(`Could not send mention email to ${contact.email}: ${error.message}`);
    }
  }

  return {
    mentioned: mentionedContacts.length,
    sent,
    skipped: mentionedContacts.length - sent,
    errors
  };
}

async function sendMentionEmail({ apiKey, contact, authorName, siteUrl }) {
  const from = cleanString(process.env.WALK_EMAIL_FROM) || DEFAULT_FROM_EMAIL;
  const sender = cleanString(authorName) || "A teammate";
  const messageUrl = getMessageUrl(siteUrl);
  const subject = `${sender} tagged you on Walk to Wellness`;
  const messageLinkText = messageUrl || "the Walk to Wellness Message Board";
  const text = [
    `Hi, ${contact.fullName}!`,
    "",
    `${sender} tagged you in a post on the Walk to Wellness Message Board! Check it out by clicking here: ${messageLinkText}`,
    "",
    "Happy walking!",
    "HR"
  ].filter(Boolean).join("\n");
  const html = `
    <div style="margin:0;padding:28px;background:#fffdf8;font-family:Inter,Arial,sans-serif;color:#182f43;line-height:1.55;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e0d8;border-radius:14px;overflow:hidden;box-shadow:0 12px 28px rgba(24,47,67,0.08);">
        <div style="height:12px;background:linear-gradient(90deg,#e3a0cd 0%,#fffec9 100%);"></div>
        <div style="padding:30px 30px 26px;">
          <p style="margin:0 0 8px;color:#376f98;font-size:13px;font-weight:800;letter-spacing:0;text-transform:uppercase;">Walk to Wellness</p>
          <h1 style="margin:0 0 22px;color:#182f43;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.12;font-weight:800;">You were tagged!</h1>
          <p style="margin:0 0 18px;font-size:18px;font-weight:800;">Hi, ${escapeHtml(contact.fullName)}!</p>
          <p style="margin:0 0 24px;font-size:16px;">
            <strong>${escapeHtml(sender)}</strong> tagged you in a post on the Walk to Wellness Message Board!
            ${messageUrl ? `Check it out by <a href="${escapeHtml(messageUrl)}" style="color:#376f98;font-weight:900;text-decoration:underline;">clicking here</a>.` : "Check it out on the Walk to Wellness Message Board."}
          </p>
          ${messageUrl ? `<p style="margin:0 0 26px;"><a href="${escapeHtml(messageUrl)}" style="display:inline-block;padding:13px 20px;color:#182f43;background:linear-gradient(90deg,#e3a0cd 0%,#fffec9 100%);border:2px solid #182f43;border-radius:8px;font-weight:900;text-decoration:none;">Open Message Board</a></p>` : ""}
          <div style="margin-top:24px;padding:16px 18px;background:linear-gradient(90deg,rgba(248,230,231,0.765) 0%,rgba(202,238,242,0.765) 100%);border-radius:8px;">
            <p style="margin:0 0 4px;font-size:16px;font-weight:800;">Happy walking!</p>
            <p style="margin:0;color:#66707a;font-size:15px;font-weight:800;">HR</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": "walk-to-wellness/1.0"
    },
    body: JSON.stringify({
      from,
      to: [contact.email],
      subject,
      text,
      html
    })
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Resend returned ${response.status}: ${responseText || response.statusText}`);
  }
}

function isMentioned(text, fullName) {
  const parts = cleanString(fullName).split(" ").filter(Boolean);

  if (parts.length < 2) return false;

  const namePattern = parts.map(escapeRegExp).join("\\s+");
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_@])@${namePattern}(?=$|[^\\p{L}\\p{N}_-])`, "iu");
  return pattern.test(text);
}

function getMessageUrl(siteUrl) {
  const cleanUrl = cleanString(siteUrl).replace(/\/$/, "");
  return cleanUrl ? `${cleanUrl}/#messages` : "";
}

function cleanString(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function nameKey(value) {
  return cleanString(value).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
