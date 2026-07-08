import http from "node:http";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLocalParticipantContacts,
  sendMentionNotifications
} from "./mention-notifications.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_PATH =
  process.env.DATA_PATH || path.join(__dirname, "data", "walk-to-wellness.json");
const TEAM_MEMBER_LIMIT = 10;
const TEAM_FULL_MESSAGE = "This team already has 10 people, so it is full. Please join a new team.";
const MESSAGE_IMAGE_DATA_LIMIT = 1_600_000;
const MESSAGE_REACTION_EMOJIS = ["👍", "❤️", "👏", "🎉", "😊", "💪"];
const ADMIN_COOKIE_NAME = "ww_admin_session";
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;

const initialState = {
  teams: [],
  registrations: [],
  activities: [],
  distanceEntries: [],
  messages: [],
  messageReactions: []
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

let updateQueue = Promise.resolve();

async function ensureDataFile() {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });

  if (!existsSync(DATA_PATH)) {
    await writeFile(DATA_PATH, JSON.stringify(initialState, null, 2));
  }
}

async function loadState() {
  await ensureDataFile();
  const raw = await readFile(DATA_PATH, "utf8");
  return normalizeState(JSON.parse(raw));
}

async function saveState(state) {
  const next = normalizeState(state);
  const tmpPath = `${DATA_PATH}.tmp`;

  await writeFile(tmpPath, JSON.stringify(next, null, 2));
  await rename(tmpPath, DATA_PATH);
}

async function updateState(mutator) {
  const run = updateQueue.then(async () => {
    const state = await loadState();
    const result = mutator(state);

    await saveState(state);
    return { state, result };
  });

  updateQueue = run.catch(() => {});
  return run;
}

function normalizeState(state) {
  const source = state && typeof state === "object" ? state : initialState;

  return {
    teams: Array.isArray(source.teams) ? source.teams.map(normalizeTeam) : [],
    registrations: Array.isArray(source.registrations)
      ? source.registrations.map(normalizeRegistration)
      : [],
    activities: Array.isArray(source.activities)
      ? source.activities.map(normalizeActivity)
      : [],
    distanceEntries: Array.isArray(source.distanceEntries)
      ? source.distanceEntries.map(normalizeDistanceEntry)
      : [],
    messages: Array.isArray(source.messages)
      ? source.messages.map(normalizeMessage)
      : [],
    messageReactions: Array.isArray(source.messageReactions)
      ? source.messageReactions.map(normalizeMessageReaction)
      : []
  };
}

function normalizeTeam(team) {
  return {
    id: cleanString(team.id) || crypto.randomUUID(),
    name: cleanString(team.name),
    createdAt: cleanString(team.createdAt) || new Date().toISOString(),
    members: Array.isArray(team.members) ? team.members.map(normalizeMember) : []
  };
}

function normalizeMember(member) {
  return {
    id: cleanString(member.id) || crypto.randomUUID(),
    fullName: cleanString(member.fullName),
    joinedAt: cleanString(member.joinedAt) || new Date().toISOString()
  };
}

function normalizeRegistration(registration) {
  return {
    id: cleanString(registration.id) || crypto.randomUUID(),
    firstName: cleanString(registration.firstName),
    lastName: cleanString(registration.lastName),
    programName: cleanString(registration.programName),
    officeSite: cleanString(registration.officeSite),
    createdAt: cleanString(registration.createdAt) || new Date().toISOString()
  };
}

function normalizeActivity(activity) {
  return {
    id: cleanString(activity.id) || crypto.randomUUID(),
    participantName: cleanString(activity.participantName),
    miles: Number(activity.miles) || 0,
    activityType: cleanString(activity.activityType),
    duration: cleanString(activity.duration),
    activityDate: cleanString(activity.activityDate),
    teamId: cleanString(activity.teamId) || null,
    createdAt: cleanString(activity.createdAt) || new Date().toISOString()
  };
}

function normalizeDistanceEntry(entry) {
  const dailyMiles = Array.isArray(entry.dailyMiles)
    ? entry.dailyMiles.map((day) => ({
        dayIndex: Number(day.dayIndex) || 0,
        dayName: cleanString(day.dayName),
        isoDate: cleanString(day.isoDate),
        dateLabel: cleanString(day.dateLabel),
        miles: roundMiles(day.miles)
      }))
    : [];

  return {
    id: cleanString(entry.id) || crypto.randomUUID(),
    teamId: cleanString(entry.teamId),
    teamName: cleanString(entry.teamName),
    memberId: cleanString(entry.memberId),
    memberName: cleanString(entry.memberName),
    entryMode: cleanString(entry.entryMode) === "weekly" ? "weekly" : "daily",
    weekNumber: Number(entry.weekNumber) || 1,
    dailyMiles,
    weeklyMiles: roundMiles(entry.weeklyMiles),
    totalMiles: roundMiles(entry.totalMiles),
    createdAt: cleanString(entry.createdAt) || new Date().toISOString()
  };
}

function normalizeMessage(message) {
  return {
    id: cleanString(message.id) || crypto.randomUUID(),
    authorName: cleanString(message.authorName),
    parentMessageId: cleanString(message.parentMessageId) || null,
    teamId: cleanString(message.teamId) || null,
    teamName: cleanString(message.teamName),
    messageText: cleanMessageText(message.messageText),
    imageData: cleanString(message.imageData),
    imageName: cleanString(message.imageName),
    createdAt: cleanString(message.createdAt) || new Date().toISOString()
  };
}

function normalizeMessageReaction(reaction) {
  return {
    id: cleanString(reaction.id) || crypto.randomUUID(),
    messageId: cleanString(reaction.messageId),
    emoji: cleanString(reaction.emoji),
    createdAt: cleanString(reaction.createdAt) || new Date().toISOString()
  };
}

function getPublicState(state) {
  const teams = [...state.teams]
    .map((team) => ({
      ...team,
      members: [...team.members].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    teams,
    registrations: [...state.registrations].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
    activities: [...state.activities].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
    distanceEntries: [...state.distanceEntries].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    ),
    messages: buildPublicMessages(state),
    totals: buildTotals({ ...state, teams })
  };
}

function buildPublicMessages(state) {
  const reactionCounts = new Map();

  for (const reaction of state.messageReactions || []) {
    if (!MESSAGE_REACTION_EMOJIS.includes(reaction.emoji)) continue;

    const counts = reactionCounts.get(reaction.messageId) || {};
    counts[reaction.emoji] = (counts[reaction.emoji] || 0) + 1;
    reactionCounts.set(reaction.messageId, counts);
  }

  return [...(state.messages || [])]
    .map((message) => ({
      ...message,
      reactionCounts: reactionCounts.get(message.id) || {}
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function buildMentionablePeople(state, contacts = []) {
  const people = new Map();
  const hasContacts = Array.isArray(contacts) && contacts.length > 0;
  const addPerson = (fullName) => {
    const cleanName = cleanString(fullName);
    const parts = cleanName.split(" ");

    if (parts.length < 2) return;

    people.set(nameKey(cleanName), { fullName: cleanName });
  };

  for (const contact of contacts || []) {
    addPerson(contact.fullName || contact.full_name || contact.name);
  }

  if (!hasContacts) {
    for (const team of state.teams || []) {
      for (const member of team.members || []) {
        addPerson(member.fullName);
      }
    }

    for (const registration of state.registrations || []) {
      addPerson(`${registration.firstName || ""} ${registration.lastName || ""}`);
    }
  }

  return [...people.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function buildTotals(state) {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const teamTotals = new Map(state.teams.map((team) => [team.id, 0]));
  const memberTotals = new Map();

  for (const entry of state.distanceEntries || []) {
    const miles = Number(entry.totalMiles) || 0;
    const teamId = teamById.has(entry.teamId) ? entry.teamId : "unassigned";
    const memberKey = nameKey(entry.memberName);
    const existingMember = memberTotals.get(memberKey) || {
      name: entry.memberName,
      miles: 0
    };

    if (!teamTotals.has(teamId)) {
      teamTotals.set(teamId, 0);
    }

    teamTotals.set(teamId, teamTotals.get(teamId) + miles);

    if (entry.memberName) {
      memberTotals.set(memberKey, {
        name: existingMember.name || entry.memberName,
        miles: existingMember.miles + miles
      });
    }

    if (teamId === "unassigned" && !teamById.has("unassigned")) {
      teamById.set("unassigned", {
        id: "unassigned",
        name: "Unassigned",
        members: []
      });
    }
  }

  const totalMilesByTeam = [...teamTotals.entries()]
    .map(([teamId, miles]) => ({
      teamId,
      teamName: teamById.get(teamId)?.name || "Unassigned",
      miles: roundMiles(miles)
    }))
    .sort((a, b) => b.miles - a.miles || a.teamName.localeCompare(b.teamName));

  const topMembers = [...memberTotals.values()]
    .sort((a, b) => b.miles - a.miles || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((member, index) => ({
      rank: index + 1,
      name: member.name,
      miles: roundMiles(member.miles)
    }));

  return { totalMilesByTeam, topMembers };
}

function roundMiles(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function cleanString(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function getRequestSiteUrl(request) {
  const configuredUrl = cleanString(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.URL);
  const host = cleanString(request.headers.host);

  if (configuredUrl) return configuredUrl;
  if (host) return `http://${host}`;

  return `http://${HOST}:${PORT}`;
}

function cleanMessageText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function validateMessageImage(imageData) {
  const cleanData = cleanString(imageData);

  if (!cleanData) {
    return "";
  }

  if (!/^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(cleanData)) {
    throw validationError("Please upload a JPG, PNG, or WebP image.");
  }

  if (cleanData.length > MESSAGE_IMAGE_DATA_LIMIT) {
    throw validationError("Please choose a smaller photo.");
  }

  return cleanData;
}

function validateMessageReaction(value) {
  const emoji = cleanString(value);

  if (!MESSAGE_REACTION_EMOJIS.includes(emoji)) {
    throw validationError("Please choose a supported reaction.");
  }

  return emoji;
}

function nameKey(value) {
  return cleanString(value).toLocaleLowerCase();
}

function splitMemberNames(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  return String(value ?? "")
    .split(/\n|,/)
    .map(cleanString)
    .filter(Boolean);
}

function getAdminConfig() {
  return {
    username: cleanString(process.env.ADMIN_USERNAME) || "admin",
    password: cleanString(process.env.ADMIN_PASSWORD),
    secret: cleanString(process.env.ADMIN_SESSION_SECRET) || cleanString(process.env.ADMIN_PASSWORD)
  };
}

function isAdminConfigured() {
  const config = getAdminConfig();
  return Boolean(config.password && config.secret);
}

function assertAdminConfigured() {
  const config = getAdminConfig();

  if (!config.password || !config.secret) {
    throw validationError("Admin login is not configured. Add ADMIN_PASSWORD in Netlify environment variables.", 500);
  }

  return config;
}

function safeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signAdminPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createAdminToken(username) {
  const config = assertAdminConfigured();
  const payload = encodeBase64Url(JSON.stringify({
    username,
    expiresAt: Date.now() + ADMIN_SESSION_MS
  }));
  const signature = signAdminPayload(payload, config.secret);

  return `${payload}.${signature}`;
}

function verifyAdminToken(token) {
  const config = assertAdminConfigured();
  const [payload, signature] = String(token || "").split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = signAdminPayload(payload, config.secret);

  if (!safeTextEqual(signature, expected)) {
    return null;
  }

  try {
    const session = JSON.parse(decodeBase64Url(payload));

    if (!session.username || Number(session.expiresAt) < Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header || "")
      .split(";")
      .map((cookie) => cookie.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, value]) => [name, decodeURIComponent(value)])
  );
}

function getAdminSession(request) {
  if (!isAdminConfigured()) {
    return null;
  }

  const cookies = parseCookies(request.headers.cookie);
  return verifyAdminToken(cookies[ADMIN_COOKIE_NAME]);
}

function requireAdmin(request) {
  const session = getAdminSession(request);

  if (!session) {
    throw validationError("Admin login required.", 401);
  }

  return session;
}

function getAdminCookie(token) {
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ADMIN_SESSION_MS / 1000)}`;
}

function getClearAdminCookie() {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function addMemberToTeam(team, fullName) {
  const memberName = cleanString(fullName);

  if (!memberName) {
    throw validationError("Team member name is required.");
  }

  const exists = team.members.some((member) => nameKey(member.fullName) === nameKey(memberName));

  if (exists) {
    return false;
  }

  if (team.members.length >= TEAM_MEMBER_LIMIT) {
    throw validationError(TEAM_FULL_MESSAGE);
  }

  team.members.push({
    id: crypto.randomUUID(),
    fullName: memberName,
    joinedAt: new Date().toISOString()
  });

  return true;
}

function renameTeam(state, teamId, name) {
  const teamName = cleanString(name);
  const team = state.teams.find((entry) => entry.id === teamId);

  if (!team) {
    throw validationError("Team was not found.", 404);
  }

  if (!teamName) {
    throw validationError("Team name is required.");
  }

  if (state.teams.some((entry) => entry.id !== teamId && nameKey(entry.name) === nameKey(teamName))) {
    throw validationError("That team name already exists.");
  }

  team.name = teamName;

  for (const entry of state.distanceEntries || []) {
    if (entry.teamId === teamId) {
      entry.teamName = teamName;
    }
  }
}

function deleteTeam(state, teamId) {
  const team = state.teams.find((entry) => entry.id === teamId);

  if (!team) {
    throw validationError("Team was not found.", 404);
  }

  state.teams = state.teams.filter((entry) => entry.id !== teamId);
  state.activities = state.activities.filter((entry) => entry.teamId !== teamId);
  state.distanceEntries = state.distanceEntries.filter((entry) => entry.teamId !== teamId);
}

function renameMember(team, memberId, fullName, state) {
  const memberName = cleanString(fullName);
  const member = findMemberById(team, memberId);

  if (!member) {
    throw validationError("Team member was not found.", 404);
  }

  if (!memberName) {
    throw validationError("Team member name is required.");
  }

  if (team.members.some((entry) => entry.id !== memberId && nameKey(entry.fullName) === nameKey(memberName))) {
    throw validationError("That member is already on this team.");
  }

  member.fullName = memberName;

  for (const entry of state.distanceEntries || []) {
    if (entry.memberId === memberId) {
      entry.memberName = memberName;
    }
  }
}

function deleteMember(state, team, memberId) {
  const member = findMemberById(team, memberId);

  if (!member) {
    throw validationError("Team member was not found.", 404);
  }

  team.members = team.members.filter((entry) => entry.id !== memberId);
  state.distanceEntries = state.distanceEntries.filter((entry) => entry.memberId !== memberId);
}

function editDailyMileage(state, memberId, activityDate, miles) {
  const cleanMemberId = cleanString(memberId);
  const cleanDate = cleanString(activityDate);
  const correctMiles = roundMiles(validateMiles(miles, "correct miles"));
  const correctionDay = getChallengeDayByDate(cleanDate);
  const team = state.teams.find((entry) =>
    entry.members.some((member) => member.id === cleanMemberId)
  );

  if (!team) {
    throw validationError("Team member was not found.", 404);
  }

  if (!correctionDay) {
    throw validationError("Please choose a date within the challenge.");
  }

  const member = findMemberById(team, cleanMemberId);
  const weekNumber = correctionDay.weekNumber;
  const dayKey = getDistanceDayKey(weekNumber, correctionDay);
  const memberWeekEntries = state.distanceEntries.filter(
    (entry) => entry.memberId === cleanMemberId && Number(entry.weekNumber) === weekNumber
  );

  if (memberWeekEntries.some((entry) => entry.entryMode === "weekly" && Number(entry.totalMiles) > 0)) {
    throw validationError("This member has a weekly total for that week. Remove the weekly total before editing a single date.");
  }

  state.distanceEntries = state.distanceEntries.flatMap((entry) => {
    if (entry.memberId !== cleanMemberId || Number(entry.weekNumber) !== weekNumber || entry.entryMode !== "daily") {
      return [entry];
    }

    const remainingDailyMiles = (entry.dailyMiles || []).filter(
      (day) => getDistanceDayKey(entry.weekNumber, day) !== dayKey
    );
    const totalMiles = roundMiles(
      remainingDailyMiles.reduce((total, day) => total + (Number(day.miles) || 0), 0)
    );

    return totalMiles > 0
      ? [{
          ...entry,
          dailyMiles: remainingDailyMiles,
          totalMiles
        }]
      : [];
  });

  if (correctMiles > 0) {
    state.distanceEntries.push({
      id: crypto.randomUUID(),
      teamId: team.id,
      teamName: team.name,
      memberId: cleanMemberId,
      memberName: member.fullName,
      entryMode: "daily",
      weekNumber,
      dailyMiles: [{
        dayIndex: correctionDay.dayIndex,
        dayName: correctionDay.dayName,
        isoDate: correctionDay.isoDate,
        dateLabel: correctionDay.dateLabel,
        miles: correctMiles
      }],
      weeklyMiles: 0,
      totalMiles: correctMiles,
      createdAt: new Date().toISOString()
    });
  }
}

function findTeamByMemberName(state, participantName) {
  const normalized = nameKey(participantName);

  return (
    state.teams.find((team) =>
      team.members.some((member) => nameKey(member.fullName) === normalized)
    ) || null
  );
}

function findMemberById(team, memberId) {
  return team.members.find((member) => member.id === memberId) || null;
}

function validateMiles(value, label) {
  const cleanValue = String(value ?? "").trim();

  if (!/^\d+(\.\d{1,2})?$/.test(cleanValue)) {
    throw validationError(`Please enter ${label} with no more than two decimal places.`);
  }

  return Number(cleanValue);
}

function getDuplicateAction(value) {
  const action = cleanString(value).toLocaleLowerCase();
  return action === "override" || action === "add" ? action : "";
}

function duplicateDistanceError(duplicate) {
  const error = validationError(duplicate.message, 409);
  error.payload = { duplicate };
  return error;
}

function findDistanceDuplicate(entries, memberId, entryMode, weekNumber, dailyMiles) {
  const memberEntries = (entries || []).filter(
    (entry) => entry.memberId === memberId && Number(entry.weekNumber) === weekNumber
  );

  if (entryMode === "weekly") {
    const existingMiles = roundMiles(
      memberEntries.reduce((total, entry) => total + (Number(entry.totalMiles) || 0), 0)
    );

    return existingMiles > 0
      ? buildDuplicatePayload(existingMiles, getWeekLabel(weekNumber), "week")
      : null;
  }

  for (const day of dailyMiles) {
    const dayKey = getDistanceDayKey(weekNumber, day);
    let existingMiles = 0;
    let hasWeeklyOverlap = false;

    for (const entry of memberEntries) {
      if (entry.entryMode === "weekly") {
        existingMiles += Number(entry.totalMiles) || 0;
        hasWeeklyOverlap = true;
        continue;
      }

      for (const existingDay of entry.dailyMiles || []) {
        if (getDistanceDayKey(entry.weekNumber, existingDay) === dayKey) {
          existingMiles += Number(existingDay.miles) || 0;
        }
      }
    }

    if (existingMiles > 0) {
      return buildDuplicatePayload(
        roundMiles(existingMiles),
        hasWeeklyOverlap ? getWeekLabel(weekNumber) : getDistanceDayLabel(weekNumber, day),
        hasWeeklyOverlap ? "week" : "date"
      );
    }
  }

  return null;
}

function buildDuplicatePayload(existingMiles, periodLabel, periodType) {
  const periodPhrase = periodType === "week" ? `for ${periodLabel}` : `on ${periodLabel}`;
  const message = `You have previously entered ${formatMilesForMessage(existingMiles)} for this person ${periodPhrase}. Do you want to override or add the totals?`;

  return {
    existingMiles,
    periodLabel,
    periodType,
    message
  };
}

function applyDistanceOverride(state, memberId, entryMode, weekNumber, dailyMiles) {
  if (entryMode === "weekly") {
    state.distanceEntries = state.distanceEntries.filter(
      (entry) => !(entry.memberId === memberId && Number(entry.weekNumber) === weekNumber)
    );
    return;
  }

  const dayKeys = new Set(dailyMiles.map((day) => getDistanceDayKey(weekNumber, day)));

  state.distanceEntries = state.distanceEntries.flatMap((entry) => {
    if (entry.memberId !== memberId || Number(entry.weekNumber) !== weekNumber) {
      return [entry];
    }

    if (entry.entryMode === "weekly") {
      return [];
    }

    const remainingDailyMiles = (entry.dailyMiles || []).filter(
      (day) => !dayKeys.has(getDistanceDayKey(entry.weekNumber, day))
    );
    const totalMiles = roundMiles(
      remainingDailyMiles.reduce((total, day) => total + (Number(day.miles) || 0), 0)
    );

    return totalMiles > 0
      ? [{
          ...entry,
          dailyMiles: remainingDailyMiles,
          totalMiles
        }]
      : [];
  });
}

function getDistanceDayKey(weekNumber, day) {
  return cleanString(day.isoDate) || `${Number(weekNumber) || 0}:${Number(day.dayIndex) || 0}`;
}

function getDistanceDayLabel(weekNumber, day) {
  return cleanString(day.dateLabel) || getChallengeDay(weekNumber, day.dayIndex)?.dateLabel || `Week ${weekNumber}`;
}

function getWeekLabel(weekNumber) {
  const week = getChallengeWeeks().find((entry) => entry.weekNumber === Number(weekNumber));
  return week ? `Week ${week.weekNumber} (${week.rangeLabel})` : `Week ${weekNumber}`;
}

function getChallengeDay(weekNumber, dayIndex) {
  return getChallengeWeeks()
    .find((entry) => entry.weekNumber === Number(weekNumber))
    ?.days.find((day) => day.dayIndex === Number(dayIndex)) || null;
}

function getChallengeDayByDate(isoDate) {
  for (const week of getChallengeWeeks()) {
    const day = week.days.find((entry) => entry.isoDate === isoDate);

    if (day) {
      return {
        ...day,
        weekNumber: week.weekNumber
      };
    }
  }

  return null;
}

function getChallengeWeeks() {
  const year = new Date().getFullYear();
  const start = new Date(year, 6, 6);
  const end = new Date(year, 9, 18);
  const weeks = [];
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  let cursor = new Date(start);
  let weekNumber = 1;

  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const cappedEnd = weekEnd > end ? end : weekEnd;
    const days = [];

    for (let index = 0; index < 7; index += 1) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + index);

      if (dayDate <= end) {
        days.push({
          dayIndex: index,
          dayName: dayNames[index],
          isoDate: toISODate(dayDate),
          dateLabel: formatShortDate(dayDate)
        });
      }
    }

    weeks.push({
      weekNumber,
      startDate: toISODate(weekStart),
      endDate: toISODate(cappedEnd),
      rangeLabel: `${formatShortDate(weekStart)} - ${formatShortDate(cappedEnd)}`,
      days
    });

    cursor.setDate(cursor.getDate() + 7);
    weekNumber += 1;
  }

  return weeks;
}

function toISODate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatMilesForMessage(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw validationError("Please submit valid form data.");
  }
}

function sendJson(response, payload, status = 200, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  const status = Number(error.status) || 500;
  const message = status === 500 ? "Something went wrong." : error.message;

  sendJson(response, { error: message, ...(error.payload || {}) }, status);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    const state = await loadState();
    sendJson(response, getPublicState(state));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/mentionable-people") {
    const state = await loadState();
    const contacts = await loadLocalParticipantContacts(console);

    sendJson(response, {
      people: buildMentionablePeople(state, contacts),
      source: contacts.length ? "contacts" : "state"
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    const session = getAdminSession(request);
    sendJson(response, {
      authenticated: Boolean(session),
      configured: isAdminConfigured(),
      username: session?.username || null
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    const body = await readJsonBody(request);
    const config = assertAdminConfigured();
    const username = cleanString(body.username) || "admin";
    const password = cleanString(body.password);

    if (!safeTextEqual(username, config.username) || !safeTextEqual(password, config.password)) {
      throw validationError("Admin username or password is incorrect.", 401);
    }

    sendJson(response, {
      authenticated: true,
      username: config.username
    }, 200, {
      "set-cookie": getAdminCookie(createAdminToken(config.username))
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    sendJson(response, { authenticated: false }, 200, {
      "set-cookie": getClearAdminCookie()
    });
    return;
  }

  if (url.pathname.startsWith("/api/admin/")) {
    requireAdmin(request);

    const adminTeamMatch = url.pathname.match(/^\/api\/admin\/teams\/([^/]+)$/);
    const adminMemberMatch = url.pathname.match(/^\/api\/admin\/teams\/([^/]+)\/members\/([^/]+)$/);
    const adminTeamMemberCollectionMatch = url.pathname.match(/^\/api\/admin\/teams\/([^/]+)\/members$/);

    if (url.pathname === "/api/admin/mileage" && request.method === "PATCH") {
      const body = await readJsonBody(request);
      const { state } = await updateState((draft) => {
        editDailyMileage(draft, body.memberId, body.activityDate, body.miles);
      });

      sendJson(response, getPublicState(state));
      return;
    }

    if (adminTeamMatch && request.method === "PATCH") {
      const teamId = decodeURIComponent(adminTeamMatch[1]);
      const body = await readJsonBody(request);
      const { state } = await updateState((draft) => {
        renameTeam(draft, teamId, body.name);
      });

      sendJson(response, getPublicState(state));
      return;
    }

    if (adminTeamMatch && request.method === "DELETE") {
      const teamId = decodeURIComponent(adminTeamMatch[1]);
      const { state } = await updateState((draft) => {
        deleteTeam(draft, teamId);
      });

      sendJson(response, getPublicState(state));
      return;
    }

    if (adminTeamMemberCollectionMatch && request.method === "POST") {
      const teamId = decodeURIComponent(adminTeamMemberCollectionMatch[1]);
      const body = await readJsonBody(request);
      const { state } = await updateState((draft) => {
        const team = draft.teams.find((entry) => entry.id === teamId);

        if (!team) {
          throw validationError("Team was not found.", 404);
        }

        addMemberToTeam(team, body.fullName);
      });

      sendJson(response, getPublicState(state), 201);
      return;
    }

    if (adminMemberMatch && request.method === "PATCH") {
      const teamId = decodeURIComponent(adminMemberMatch[1]);
      const memberId = decodeURIComponent(adminMemberMatch[2]);
      const body = await readJsonBody(request);
      const { state } = await updateState((draft) => {
        const team = draft.teams.find((entry) => entry.id === teamId);

        if (!team) {
          throw validationError("Team was not found.", 404);
        }

        renameMember(team, memberId, body.fullName, draft);
      });

      sendJson(response, getPublicState(state));
      return;
    }

    if (adminMemberMatch && request.method === "DELETE") {
      const teamId = decodeURIComponent(adminMemberMatch[1]);
      const memberId = decodeURIComponent(adminMemberMatch[2]);
      const { state } = await updateState((draft) => {
        const team = draft.teams.find((entry) => entry.id === teamId);

        if (!team) {
          throw validationError("Team was not found.", 404);
        }

        deleteMember(draft, team, memberId);
      });

      sendJson(response, getPublicState(state));
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/registrations") {
    const body = await readJsonBody(request);
    const firstName = cleanString(body.firstName);
    const lastName = cleanString(body.lastName);
    const programName = cleanString(body.programName);
    const officeSite = cleanString(body.officeSite);

    if (!firstName || !lastName || !programName || !officeSite) {
      throw validationError("First name, last name, program name, and office building site are required.");
    }

    const { state } = await updateState((draft) => {
      draft.registrations.push({
        id: crypto.randomUUID(),
        firstName,
        lastName,
        programName,
        officeSite,
        createdAt: new Date().toISOString()
      });
    });

    sendJson(response, getPublicState(state), 201);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/teams") {
    const body = await readJsonBody(request);
    const name = cleanString(body.name);
    const memberNames = splitMemberNames(body.memberNames);
    const uniqueMemberNames = [...new Map(memberNames.map((member) => [nameKey(member), member])).values()];

    if (!name) {
      throw validationError("Team name is required.");
    }

    if (uniqueMemberNames.length > TEAM_MEMBER_LIMIT) {
      throw validationError(`Teams can have a maximum of ${TEAM_MEMBER_LIMIT} people. Please move additional members to a new team.`);
    }

    const { state } = await updateState((draft) => {
      const existingTeam = draft.teams.find((team) => nameKey(team.name) === nameKey(name));

      if (existingTeam) {
        throw validationError("That team name already exists.");
      }

      const team = {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        members: []
      };

      for (const memberName of uniqueMemberNames) {
        addMemberToTeam(team, memberName);
      }

      draft.teams.push(team);
    });

    sendJson(response, getPublicState(state), 201);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/messages") {
    const body = await readJsonBody(request);
    const authorName = cleanString(body.authorName);
    const parentMessageId = cleanString(body.parentMessageId);
    const teamId = cleanString(body.teamId);
    const messageText = cleanMessageText(body.messageText);
    const imageData = validateMessageImage(body.imageData);
    const imageName = cleanString(body.imageName);

    if (!authorName || !messageText) {
      throw validationError("Name and message are required.");
    }

    if (authorName.length > 80) {
      throw validationError("Please keep your name under 80 characters.");
    }

    if (messageText.length > 600) {
      throw validationError("Please keep your message under 600 characters.");
    }

    const { state } = await updateState((draft) => {
      const parentMessage = parentMessageId
        ? draft.messages.find((entry) => entry.id === parentMessageId)
        : null;
      const team = teamId ? draft.teams.find((entry) => entry.id === teamId) : null;

      if (parentMessageId && !parentMessage) {
        throw validationError("The post you are replying to was not found.", 404);
      }

      draft.messages = draft.messages || [];
      draft.messages.push({
        id: crypto.randomUUID(),
        authorName,
        parentMessageId: parentMessage?.id || null,
        teamId: team?.id || null,
        teamName: team?.name || "",
        messageText,
        imageData,
        imageName,
        createdAt: new Date().toISOString()
      });
    });

    const contacts = await loadLocalParticipantContacts(console);
    await sendMentionNotifications({
      authorName,
      messageText,
      contacts,
      siteUrl: getRequestSiteUrl(request),
      logger: console
    });

    sendJson(response, getPublicState(state), 201);
    return;
  }

  const reactionMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/reactions$/);

  if (request.method === "POST" && reactionMatch) {
    const messageId = decodeURIComponent(reactionMatch[1]);
    const body = await readJsonBody(request);
    const emoji = validateMessageReaction(body.emoji);

    const { state } = await updateState((draft) => {
      if (!draft.messages.some((entry) => entry.id === messageId)) {
        throw validationError("Message was not found.", 404);
      }

      draft.messageReactions = draft.messageReactions || [];
      draft.messageReactions.push({
        id: crypto.randomUUID(),
        messageId,
        emoji,
        createdAt: new Date().toISOString()
      });
    });

    sendJson(response, getPublicState(state), 201);
    return;
  }

  const joinMatch = url.pathname.match(/^\/api\/teams\/([^/]+)\/members$/);

  if (request.method === "POST" && joinMatch) {
    const teamId = decodeURIComponent(joinMatch[1]);
    const body = await readJsonBody(request);
    const fullName = cleanString(body.fullName);

    if (!fullName) {
      throw validationError("Name is required to join a team.");
    }

    const { state } = await updateState((draft) => {
      const team = draft.teams.find((entry) => entry.id === teamId);

      if (!team) {
        throw validationError("Team was not found.", 404);
      }

      addMemberToTeam(team, fullName);
    });

    sendJson(response, getPublicState(state), 201);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/activities") {
    const body = await readJsonBody(request);
    const participantName = cleanString(body.participantName);
    const miles = Number(body.miles);
    const activityType = cleanString(body.activityType);
    const duration = cleanString(body.duration);
    const activityDate = cleanString(body.activityDate);

    if (!participantName || !Number.isFinite(miles) || miles <= 0 || !activityType || !activityDate) {
      throw validationError("Name, miles walked, activity type, and activity date are required.");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
      throw validationError("Please enter a valid activity date.");
    }

    const { state } = await updateState((draft) => {
      const team = findTeamByMemberName(draft, participantName);

      draft.activities.push({
        id: crypto.randomUUID(),
        participantName,
        miles: roundMiles(miles),
        activityType,
        duration,
        activityDate,
        teamId: team?.id || null,
        createdAt: new Date().toISOString()
      });
    });

    sendJson(response, getPublicState(state), 201);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/distance") {
    const body = await readJsonBody(request);
    const teamId = cleanString(body.teamId);
    const memberId = cleanString(body.memberId);
    const entryMode = cleanString(body.entryMode) === "weekly" ? "weekly" : "daily";
    const duplicateAction = getDuplicateAction(body.duplicateAction);
    const weekNumber = Number(body.weekNumber);

    if (!teamId || !memberId || !Number.isInteger(weekNumber) || weekNumber < 1) {
      throw validationError("Team, team member, entry type, and challenge week are required.");
    }

    const { state } = await updateState((draft) => {
      const team = draft.teams.find((entry) => entry.id === teamId);

      if (!team) {
        throw validationError("Team was not found.", 404);
      }

      const member = findMemberById(team, memberId);

      if (!member) {
        throw validationError("Team member was not found.", 404);
      }

      const dailyMiles = entryMode === "daily" && Array.isArray(body.dailyMiles)
        ? body.dailyMiles.map((day) => ({
            dayIndex: Number(day.dayIndex) || 0,
            dayName: cleanString(day.dayName),
            isoDate: cleanString(day.isoDate) || getChallengeDay(weekNumber, day.dayIndex)?.isoDate || "",
            dateLabel: cleanString(day.dateLabel) || getChallengeDay(weekNumber, day.dayIndex)?.dateLabel || "",
            miles: roundMiles(validateMiles(day.miles, `${cleanString(day.dayName) || "daily"} miles`))
          })).filter((day) => day.miles > 0)
        : [];
      const weeklyMiles = entryMode === "weekly"
        ? roundMiles(validateMiles(body.weeklyMiles, "weekly miles"))
        : 0;
      const totalMiles = entryMode === "daily"
        ? roundMiles(dailyMiles.reduce((total, day) => total + day.miles, 0))
        : weeklyMiles;

      if (totalMiles <= 0) {
        throw validationError("Distance must be greater than zero.");
      }

      const duplicate = findDistanceDuplicate(
        draft.distanceEntries,
        memberId,
        entryMode,
        weekNumber,
        dailyMiles
      );

      if (duplicate && !duplicateAction) {
        throw duplicateDistanceError(duplicate);
      }

      if (duplicateAction === "override") {
        applyDistanceOverride(draft, memberId, entryMode, weekNumber, dailyMiles);
      }

      draft.distanceEntries.push({
        id: crypto.randomUUID(),
        teamId,
        teamName: team.name,
        memberId,
        memberName: member.fullName,
        entryMode,
        weekNumber,
        dailyMiles,
        weeklyMiles,
        totalMiles,
        createdAt: new Date().toISOString()
      });
    });

    sendJson(response, getPublicState(state), 201);
    return;
  }

  sendJson(response, { error: "Not found." }, 404);
}

async function serveStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, { error: "Not found." }, 404);
    return;
  }

  try {
    const file = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();

    const cacheControl = [".html", ".css", ".js"].includes(extension)
      ? "no-store"
      : "public, max-age=3600";

    response.writeHead(200, {
      "content-type": mimeTypes[extension] || "application/octet-stream",
      "cache-control": cacheControl
    });
    response.end(file);
  } catch {
    const index = await readFile(path.join(PUBLIC_DIR, "index.html"));

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(index);
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, decodeURIComponent(url.pathname));
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Walk to Wellness site running at http://${HOST}:${PORT}`);
});
