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

const initialState = {
  teams: [],
  registrations: [],
  activities: []
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

function addMemberToTeam(team, fullName) {
  const memberName = cleanString(fullName);

  if (!memberName) {
    throw validationError("Team member name is required.");
  }

  const exists = team.members.some((member) => nameKey(member.fullName) === nameKey(memberName));

  if (!exists) {
    team.members.push({
      id: crypto.randomUUID(),
      fullName: memberName,
      joinedAt: new Date().toISOString()
    });
  }

  return !exists;
}

function findTeamByMemberName(state, participantName) {
  const normalized = nameKey(participantName);

  return (
    state.teams.find((team) =>
      team.members.some((member) => nameKey(member.fullName) === normalized)
    ) || null
  );
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

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
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

    if (!name) {
      throw validationError("Team name is required.");
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

      for (const memberName of memberNames) {
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
