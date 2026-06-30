import http from "node:http";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_PATH =
  process.env.DATA_PATH || path.join(__dirname, "data", "walk-to-wellness.json");
const TEAM_MEMBER_LIMIT = 10;
const TEAM_FULL_MESSAGE = "This team already has 10 people, so it is full. Please join a new team.";
const ADMIN_COOKIE_NAME = "ww_admin_session";
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;

const initialState = {
  teams: [],
  registrations: [],
  activities: [],
  distanceEntries: []
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
    totals: buildTotals({ ...state, teams })
  };
}

function buildTotals(state) {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const teamTotals = new Map(state.teams.map((team) => [team.id, 0]));
  const memberTotals = new Map();

  for (const activity of state.activities) {
    const miles = Number(activity.miles) || 0;
    const teamId = teamById.has(activity.teamId) ? activity.teamId : "unassigned";
    const teamName = teamId === "unassigned" ? "Unassigned" : teamById.get(teamId).name;
    const memberKey = nameKey(activity.participantName);
    const existingMember = memberTotals.get(memberKey) || {
      name: activity.participantName,
      miles: 0
    };

    if (!teamTotals.has(teamId)) {
      teamTotals.set(teamId, 0);
    }

    teamTotals.set(teamId, teamTotals.get(teamId) + miles);
    memberTotals.set(memberKey, {
      name: existingMember.name || activity.participantName,
      miles: existingMember.miles + miles
    });

    if (teamId === "unassigned" && !teamById.has("unassigned")) {
      teamById.set("unassigned", {
        id: "unassigned",
        name: teamName,
        members: []
      });
    }
  }

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

  sendJson(response, { error: message }, status);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    const state = await loadState();
    sendJson(response, getPublicState(state));
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
            dateLabel: cleanString(day.dateLabel),
            miles: roundMiles(validateMiles(day.miles, `${cleanString(day.dayName) || "daily"} miles`))
          }))
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
