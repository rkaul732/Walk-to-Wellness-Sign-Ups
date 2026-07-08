import { readFile } from "node:fs/promises";

const LOCAL_CONTACTS_PATH = new URL("./data/participant-contacts.json", import.meta.url);
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM_EMAIL = "Walk to Wellness System <noreply@bhhwalktowellness.com>";
const EMAIL_BATCH_LIMIT = 50;

export async function loadLocalParticipantContacts(logger = console) {
  try {
    const raw = await readFile(LOCAL_CONTACTS_PATH, "utf8");
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
        messageText,
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

async function sendMentionEmail({ apiKey, contact, authorName, messageText, siteUrl }) {
  const from = cleanString(process.env.WALK_EMAIL_FROM) || DEFAULT_FROM_EMAIL;
  const sender = cleanString(authorName) || "A teammate";
  const messageUrl = getMessageUrl(siteUrl);
  const excerpt = getMessageExcerpt(messageText);
  const subject = `${sender} tagged you in Walk to Wellness`;
  const text = [
    `Hi ${contact.fullName},`,
    "",
    `${sender} tagged you on the Walk to Wellness message board.`,
    excerpt ? `Message: "${excerpt}"` : "",
    messageUrl ? `Open the message board: ${messageUrl}` : "Open the Walk to Wellness site to view the message board.",
    "",
    "Walk to Wellness System"
  ].filter(Boolean).join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17283a;">
      <p>Hi ${escapeHtml(contact.fullName)},</p>
      <p><strong>${escapeHtml(sender)}</strong> tagged you on the Walk to Wellness message board.</p>
      ${excerpt ? `<blockquote style="border-left:4px solid #caeef2;margin:18px 0;padding:8px 14px;color:#34495e;">${escapeHtml(excerpt)}</blockquote>` : ""}
      ${messageUrl ? `<p><a href="${escapeHtml(messageUrl)}" style="color:#2d6f9f;font-weight:bold;">Open the message board</a></p>` : ""}
      <p style="color:#66707a;font-size:13px;">Walk to Wellness System</p>
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

function getMessageExcerpt(messageText) {
  const text = cleanString(messageText);
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
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
