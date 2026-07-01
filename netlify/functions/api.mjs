import crypto from "node:crypto";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
const TEAM_MEMBER_LIMIT = 10;
const TEAM_FULL_MESSAGE = "This team already has 10 people, so it is full. Please join a new team.";
const MESSAGE_IMAGE_DATA_LIMIT = 1_600_000;
const MESSAGE_REACTION_EMOJIS = ["👍", "❤️", "👏", "🎉", "😊", "💪"];
const ADMIN_COOKIE_NAME = "ww_admin_session";
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;

export async function handler(event) {
  try {
    const method = event.httpMethod || event.requestContext?.http?.method || "GET";
    const pathname = getApiPath(event.path || new URL(event.rawUrl || "https://site.local/api/state").pathname);

    if (method === "GET" && pathname === "/api/state") {
      return json(await loadPublicState());
    }

    if (method === "GET" && pathname === "/api/admin/session") {
      const session = getAdminSession(event);
      return json({
        authenticated: Boolean(session),
        configured: isAdminConfigured(),
        username: session?.username || null
      });
    }

    if (method === "POST" && pathname === "/api/admin/login") {
      const body = readJson(event);
      const config = assertAdminConfigured();
      const username = cleanString(body.username) || "admin";
      const password = cleanString(body.password);

      if (!safeTextEqual(username, config.username) || !safeTextEqual(password, config.password)) {
        throw validationError("Admin username or password is incorrect.", 401);
      }

      return json({
        authenticated: true,
        username: config.username
      }, 200, {
        "set-cookie": getAdminCookie(createAdminToken(config.username))
      });
    }

    if (method === "POST" && pathname === "/api/admin/logout") {
      return json({ authenticated: false }, 200, {
        "set-cookie": getClearAdminCookie()
      });
    }

    if (pathname.startsWith("/api/admin/")) {
      requireAdmin(event);

      const adminTeamMatch = pathname.match(/^\/api\/admin\/teams\/([^/]+)$/);
      const adminMemberMatch = pathname.match(/^\/api\/admin\/teams\/([^/]+)\/members\/([^/]+)$/);
      const adminTeamMemberCollectionMatch = pathname.match(/^\/api\/admin\/teams\/([^/]+)\/members$/);

      if (adminTeamMatch && method === "PATCH") {
        const teamId = decodeURIComponent(adminTeamMatch[1]);
        const body = readJson(event);
        const name = cleanString(body.name);
        const currentState = await loadPublicState();

        if (!currentState.teams.some((team) => team.id === teamId)) {
          throw validationError("Team was not found.", 404);
        }

        if (!name) {
          throw validationError("Team name is required.");
        }

        if (currentState.teams.some((team) => team.id !== teamId && nameKey(team.name) === nameKey(name))) {
          throw validationError("That team name already exists.");
        }

        await supabaseFetch(`teams?id=${eqParam(teamId)}`, {
          method: "PATCH",
          body: JSON.stringify({ name })
        });
        await supabaseFetch(`distance_entries?team_id=${eqParam(teamId)}`, {
          method: "PATCH",
          body: JSON.stringify({ team_name: name })
        });

        return json(await loadPublicState());
      }

      if (adminTeamMatch && method === "DELETE") {
        const teamId = decodeURIComponent(adminTeamMatch[1]);
        const currentState = await loadPublicState();

        if (!currentState.teams.some((team) => team.id === teamId)) {
          throw validationError("Team was not found.", 404);
        }

        await supabaseFetch(`distance_entries?team_id=${eqParam(teamId)}`, { method: "DELETE" });
        await supabaseFetch(`activities?team_id=${eqParam(teamId)}`, { method: "DELETE" });
        await supabaseFetch(`teams?id=${eqParam(teamId)}`, { method: "DELETE" });

        return json(await loadPublicState());
      }

      if (adminTeamMemberCollectionMatch && method === "POST") {
        const teamId = decodeURIComponent(adminTeamMemberCollectionMatch[1]);
        const body = readJson(event);
        const fullName = cleanString(body.fullName);
        const currentState = await loadPublicState();
        const team = currentState.teams.find((entry) => entry.id === teamId);

        if (!fullName) {
          throw validationError("Team member name is required.");
        }

        if (!team) {
          throw validationError("Team was not found.", 404);
        }

        const exists = team.members.some((member) => nameKey(member.fullName) === nameKey(fullName));

        if (!exists && team.members.length >= TEAM_MEMBER_LIMIT) {
          throw validationError(TEAM_FULL_MESSAGE);
        }

        if (!exists) {
          await supabaseFetch("team_members", {
            method: "POST",
            body: JSON.stringify({
              team_id: teamId,
              full_name: fullName
            })
          });
        }

        return json(await loadPublicState(), 201);
      }

      if (adminMemberMatch && method === "PATCH") {
        const teamId = decodeURIComponent(adminMemberMatch[1]);
        const memberId = decodeURIComponent(adminMemberMatch[2]);
        const body = readJson(event);
        const fullName = cleanString(body.fullName);
        const currentState = await loadPublicState();
        const team = currentState.teams.find((entry) => entry.id === teamId);

        if (!fullName) {
          throw validationError("Team member name is required.");
        }

        if (!team) {
          throw validationError("Team was not found.", 404);
        }

        if (!team.members.some((member) => member.id === memberId)) {
          throw validationError("Team member was not found.", 404);
        }

        if (team.members.some((member) => member.id !== memberId && nameKey(member.fullName) === nameKey(fullName))) {
          throw validationError("That member is already on this team.");
        }

        await supabaseFetch(`team_members?id=${eqParam(memberId)}`, {
          method: "PATCH",
          body: JSON.stringify({ full_name: fullName })
        });
        await supabaseFetch(`distance_entries?member_id=${eqParam(memberId)}`, {
          method: "PATCH",
          body: JSON.stringify({ member_name: fullName })
        });

        return json(await loadPublicState());
      }

      if (adminMemberMatch && method === "DELETE") {
        const teamId = decodeURIComponent(adminMemberMatch[1]);
        const memberId = decodeURIComponent(adminMemberMatch[2]);
        const currentState = await loadPublicState();
        const team = currentState.teams.find((entry) => entry.id === teamId);

        if (!team) {
          throw validationError("Team was not found.", 404);
        }

        if (!team.members.some((member) => member.id === memberId)) {
          throw validationError("Team member was not found.", 404);
        }

        await supabaseFetch(`distance_entries?member_id=${eqParam(memberId)}`, { method: "DELETE" });
        await supabaseFetch(`team_members?id=${eqParam(memberId)}`, { method: "DELETE" });

        return json(await loadPublicState());
      }
    }

    if (method === "POST" && pathname === "/api/registrations") {
      const body = readJson(event);
      const firstName = cleanString(body.firstName);
      const lastName = cleanString(body.lastName);
      const programName = cleanString(body.programName);
      const officeSite = cleanString(body.officeSite);

      if (!firstName || !lastName || !programName || !officeSite) {
        throw validationError("First name, last name, program name, and office building site are required.");
      }

      await supabaseFetch("registrations", {
        method: "POST",
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          program_name: programName,
          office_site: officeSite
        })
      });

      return json(await loadPublicState(), 201);
    }

    if (method === "POST" && pathname === "/api/teams") {
      const body = readJson(event);
      const name = cleanString(body.name);
      const memberNames = splitMemberNames(body.memberNames);
      const currentState = await loadPublicState();

      if (!name) {
        throw validationError("Team name is required.");
      }

      if (currentState.teams.some((team) => nameKey(team.name) === nameKey(name))) {
        throw validationError("That team name already exists.");
      }

      const uniqueMembers = [...new Map(memberNames.map((member) => [nameKey(member), member])).values()];

      if (uniqueMembers.length > TEAM_MEMBER_LIMIT) {
        throw validationError(`Teams can have a maximum of ${TEAM_MEMBER_LIMIT} people. Please move additional members to a new team.`);
      }

      const [team] = await supabaseFetch("teams", {
        method: "POST",
        body: JSON.stringify({ name }),
        returnRepresentation: true
      });

      if (uniqueMembers.length) {
        await supabaseFetch("team_members", {
          method: "POST",
          body: JSON.stringify(
            uniqueMembers.map((fullName) => ({
              team_id: team.id,
              full_name: fullName
            }))
          )
        });
      }

      return json(await loadPublicState(), 201);
    }

    if (method === "POST" && pathname === "/api/messages") {
      const body = readJson(event);
      const authorName = cleanString(body.authorName);
      const parentMessageId = cleanString(body.parentMessageId);
      const teamId = cleanString(body.teamId);
      const messageText = cleanMessageText(body.messageText);
      const imageData = validateMessageImage(body.imageData);
      const imageName = cleanString(body.imageName);
      const currentState = await loadPublicState();
      const parentMessage = parentMessageId
        ? currentState.messages.find((entry) => entry.id === parentMessageId)
        : null;
      const team = teamId ? currentState.teams.find((entry) => entry.id === teamId) : null;

      if (!authorName || !messageText) {
        throw validationError("Name and message are required.");
      }

      if (authorName.length > 80) {
        throw validationError("Please keep your name under 80 characters.");
      }

      if (messageText.length > 600) {
        throw validationError("Please keep your message under 600 characters.");
      }

      if (parentMessageId && !parentMessage) {
        throw validationError("The post you are replying to was not found.", 404);
      }

      try {
        const messagePayload = {
          author_name: authorName,
          team_id: team?.id || null,
          team_name: team?.name || "",
          message_text: messageText,
          image_data: imageData || null,
          image_name: imageName
        };

        if (parentMessageId) {
          messagePayload.parent_message_id = parentMessage.id;
        }

        await supabaseFetch("messages", {
          method: "POST",
          body: JSON.stringify(messagePayload)
        });
      } catch (error) {
        if (isMissingMessageSchemaError(error)) {
          throw validationError("Messaging is not set up in Supabase yet. Run the latest schema update, then try again.", 500);
        }

        throw error;
      }

      return json(await loadPublicState(), 201);
    }

    const reactionMatch = pathname.match(/^\/api\/messages\/([^/]+)\/reactions$/);

    if (method === "POST" && reactionMatch) {
      const messageId = decodeURIComponent(reactionMatch[1]);
      const body = readJson(event);
      const emoji = validateMessageReaction(body.emoji);
      const currentState = await loadPublicState();

      if (!currentState.messages.some((entry) => entry.id === messageId)) {
        throw validationError("Message was not found.", 404);
      }

      try {
        await supabaseFetch("message_reactions", {
          method: "POST",
          body: JSON.stringify({
            message_id: messageId,
            reaction_emoji: emoji
          })
        });
      } catch (error) {
        if (isMissingMessageSchemaError(error)) {
          throw validationError("Message reactions are not set up in Supabase yet. Run the latest schema update, then try again.", 500);
        }

        throw error;
      }

      return json(await loadPublicState(), 201);
    }

    const joinMatch = pathname.match(/^\/api\/teams\/([^/]+)\/members$/);

    if (method === "POST" && joinMatch) {
      const teamId = decodeURIComponent(joinMatch[1]);
      const body = readJson(event);
      const fullName = cleanString(body.fullName);
      const currentState = await loadPublicState();
      const team = currentState.teams.find((entry) => entry.id === teamId);

      if (!fullName) {
        throw validationError("Name is required to join a team.");
      }

      if (!team) {
        throw validationError("Team was not found.", 404);
      }

      const exists = team.members.some((member) => nameKey(member.fullName) === nameKey(fullName));

      if (!exists && team.members.length >= TEAM_MEMBER_LIMIT) {
        throw validationError(TEAM_FULL_MESSAGE);
      }

      if (!exists) {
        await supabaseFetch("team_members", {
          method: "POST",
          body: JSON.stringify({
            team_id: teamId,
            full_name: fullName
          })
        });
      }

      return json(await loadPublicState(), 201);
    }

    if (method === "POST" && pathname === "/api/activities") {
      const body = readJson(event);
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

      const currentState = await loadPublicState();
      const team = findTeamByMemberName(currentState, participantName);

      await supabaseFetch("activities", {
        method: "POST",
        body: JSON.stringify({
          participant_name: participantName,
          miles: roundMiles(miles),
          activity_type: activityType,
          duration,
          activity_date: activityDate,
          team_id: team?.id || null
        })
      });

      return json(await loadPublicState(), 201);
    }

    if (method === "POST" && pathname === "/api/distance") {
      const body = readJson(event);
      const teamId = cleanString(body.teamId);
      const memberId = cleanString(body.memberId);
      const entryMode = cleanString(body.entryMode) === "weekly" ? "weekly" : "daily";
      const duplicateAction = getDuplicateAction(body.duplicateAction);
      const weekNumber = Number(body.weekNumber);
      const currentState = await loadPublicState();
      const team = currentState.teams.find((entry) => entry.id === teamId);

      if (!teamId || !memberId || !Number.isInteger(weekNumber) || weekNumber < 1) {
        throw validationError("Team, team member, entry type, and challenge week are required.");
      }

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
        currentState.distanceEntries,
        memberId,
        entryMode,
        weekNumber,
        dailyMiles
      );

      if (duplicate && !duplicateAction) {
        throw duplicateDistanceError(duplicate);
      }

      if (duplicateAction === "override") {
        await applySupabaseDistanceOverride(
          currentState.distanceEntries,
          memberId,
          entryMode,
          weekNumber,
          dailyMiles
        );
      }

      await supabaseFetch("distance_entries", {
        method: "POST",
        body: JSON.stringify({
          team_id: teamId,
          team_name: team.name,
          member_id: memberId,
          member_name: member.fullName,
          entry_mode: entryMode,
          week_number: weekNumber,
          daily_miles: dailyMiles,
          weekly_miles: weeklyMiles,
          total_miles: totalMiles
        })
      });

      return json(await loadPublicState(), 201);
    }

    return json({ error: "Not found." }, 404);
  } catch (error) {
    return json(
      {
        error: error.status === 500 ? "Something went wrong." : error.message,
        ...(error.payload || {})
      },
      error.status || 500
    );
  }
}

function getApiPath(pathname) {
  if (pathname.startsWith("/.netlify/functions/api")) {
    return `/api${pathname.replace("/.netlify/functions/api", "")}`;
  }

  return pathname;
}

function readJson(event) {
  try {
    if (!event.body) {
      return {};
    }

    const body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;

    return JSON.parse(body);
  } catch {
    throw validationError("Please submit valid form data.");
  }
}

async function loadPublicState() {
  const [teamRows, memberRows, registrationRows, activityRows, distanceRows, messageRows, reactionRows] = await Promise.all([
    supabaseFetch("teams?select=id,name,created_at&order=name.asc"),
    supabaseFetch("team_members?select=id,team_id,full_name,joined_at&order=joined_at.asc"),
    supabaseFetch("registrations?select=id,first_name,last_name,program_name,office_site,created_at&order=created_at.desc"),
    supabaseFetch("activities?select=id,participant_name,miles,activity_type,duration,activity_date,team_id,created_at&order=created_at.desc"),
    supabaseFetch("distance_entries?select=id,team_id,team_name,member_id,member_name,entry_mode,week_number,daily_miles,weekly_miles,total_miles,created_at&order=created_at.desc"),
    loadMessageRows(),
    loadMessageReactionRows()
  ]);

  const membersByTeam = new Map();

  for (const row of memberRows) {
    const member = {
      id: row.id,
      fullName: row.full_name,
      joinedAt: row.joined_at
    };

    membersByTeam.set(row.team_id, [...(membersByTeam.get(row.team_id) || []), member]);
  }

  const state = {
    teams: teamRows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      members: membersByTeam.get(row.id) || []
    })),
    registrations: registrationRows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      programName: row.program_name,
      officeSite: row.office_site,
      createdAt: row.created_at
    })),
    activities: activityRows.map((row) => ({
      id: row.id,
      participantName: row.participant_name,
      miles: Number(row.miles) || 0,
      activityType: row.activity_type,
      duration: row.duration || "",
      activityDate: row.activity_date,
      teamId: row.team_id,
      createdAt: row.created_at
    })),
    distanceEntries: distanceRows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      teamName: row.team_name,
      memberId: row.member_id,
      memberName: row.member_name,
      entryMode: row.entry_mode,
      weekNumber: Number(row.week_number) || 1,
      dailyMiles: Array.isArray(row.daily_miles) ? row.daily_miles : [],
      weeklyMiles: Number(row.weekly_miles) || 0,
      totalMiles: Number(row.total_miles) || 0,
      createdAt: row.created_at
    })),
    messages: messageRows.map((row) => ({
      id: row.id,
      authorName: row.author_name,
      parentMessageId: row.parent_message_id || null,
      teamId: row.team_id,
      teamName: row.team_name || "",
      messageText: row.message_text,
      imageData: row.image_data || "",
      imageName: row.image_name || "",
      createdAt: row.created_at
    })),
    messageReactions: reactionRows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      emoji: row.reaction_emoji,
      createdAt: row.created_at
    }))
  };

  return getPublicState(state);
}

async function loadMessageRows() {
  try {
    return await supabaseFetch("messages?select=id,author_name,parent_message_id,team_id,team_name,message_text,image_data,image_name,created_at&order=created_at.desc");
  } catch (error) {
    if (isMissingMessageSchemaError(error)) {
      return [];
    }

    throw error;
  }
}

async function loadMessageReactionRows() {
  try {
    return await supabaseFetch("message_reactions?select=id,message_id,reaction_emoji,created_at&order=created_at.desc");
  } catch (error) {
    if (isMissingMessageSchemaError(error)) {
      return [];
    }

    throw error;
  }
}

function isMissingMessageSchemaError(error) {
  return /(messages|message_reactions|parent_message_id|reaction_emoji)/i.test(error.message || "")
    && /(schema cache|does not exist|not find|relation|column)/i.test(error.message || "");
}

async function supabaseFetch(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw validationError("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY in Netlify.", 500);
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseKey,
      authorization: `Bearer ${supabaseKey}`,
      "content-type": "application/json",
      prefer: options.returnRepresentation ? "return=representation" : "return=minimal",
      ...(options.headers || {})
    },
    body: options.body
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.message || payload?.hint || "Supabase request failed.";
    throw validationError(message, response.status >= 500 ? 500 : 400);
  }

  return payload || [];
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

function buildTotals(state) {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const teamTotals = new Map(state.teams.map((team) => [team.id, 0]));
  const memberTotals = new Map();

  for (const entry of state.distanceEntries || []) {
    const miles = Number(entry.totalMiles) || 0;
    const teamId = teamById.has(entry.teamId) ? entry.teamId : "unassigned";
    const existingMember = memberTotals.get(nameKey(entry.memberName)) || {
      name: entry.memberName,
      miles: 0
    };

    if (!teamTotals.has(teamId)) {
      teamTotals.set(teamId, 0);
    }

    teamTotals.set(teamId, teamTotals.get(teamId) + miles);

    if (entry.memberName) {
      memberTotals.set(nameKey(entry.memberName), {
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

  return {
    totalMilesByTeam: [...teamTotals.entries()]
      .map(([teamId, miles]) => ({
        teamId,
        teamName: teamById.get(teamId)?.name || "Unassigned",
        miles: roundMiles(miles)
      }))
      .sort((a, b) => b.miles - a.miles || a.teamName.localeCompare(b.teamName)),
    topMembers: [...memberTotals.values()]
      .sort((a, b) => b.miles - a.miles || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((member, index) => ({
        rank: index + 1,
        name: member.name,
        miles: roundMiles(member.miles)
      }))
  };
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

function splitMemberNames(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  return String(value ?? "")
    .split(/\n|,/)
    .map(cleanString)
    .filter(Boolean);
}

function cleanString(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
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

async function applySupabaseDistanceOverride(entries, memberId, entryMode, weekNumber, dailyMiles) {
  const { deleteIds, patchEntries } = getDistanceOverrideChanges(
    entries,
    memberId,
    entryMode,
    weekNumber,
    dailyMiles
  );

  for (const entryId of deleteIds) {
    await supabaseFetch(`distance_entries?id=${eqParam(entryId)}`, { method: "DELETE" });
  }

  for (const entry of patchEntries) {
    await supabaseFetch(`distance_entries?id=${eqParam(entry.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        daily_miles: entry.dailyMiles,
        total_miles: entry.totalMiles
      })
    });
  }
}

function getDistanceOverrideChanges(entries, memberId, entryMode, weekNumber, dailyMiles) {
  const deleteIds = [];
  const patchEntries = [];

  if (entryMode === "weekly") {
    for (const entry of entries || []) {
      if (entry.memberId === memberId && Number(entry.weekNumber) === weekNumber) {
        deleteIds.push(entry.id);
      }
    }

    return { deleteIds, patchEntries };
  }

  const dayKeys = new Set(dailyMiles.map((day) => getDistanceDayKey(weekNumber, day)));

  for (const entry of entries || []) {
    if (entry.memberId !== memberId || Number(entry.weekNumber) !== weekNumber) {
      continue;
    }

    if (entry.entryMode === "weekly") {
      deleteIds.push(entry.id);
      continue;
    }

    const remainingDailyMiles = (entry.dailyMiles || []).filter(
      (day) => !dayKeys.has(getDistanceDayKey(entry.weekNumber, day))
    );
    const totalMiles = roundMiles(
      remainingDailyMiles.reduce((total, day) => total + (Number(day.miles) || 0), 0)
    );

    if (totalMiles > 0) {
      patchEntries.push({
        ...entry,
        dailyMiles: remainingDailyMiles,
        totalMiles
      });
    } else {
      deleteIds.push(entry.id);
    }
  }

  return { deleteIds, patchEntries };
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

function nameKey(value) {
  return cleanString(value).toLocaleLowerCase();
}

function roundMiles(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
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

function getHeader(event, name) {
  const lowerName = name.toLocaleLowerCase();
  const headers = event.headers || {};

  return headers[lowerName] || headers[name] || "";
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

function getAdminSession(event) {
  if (!isAdminConfigured()) {
    return null;
  }

  const cookies = parseCookies(getHeader(event, "cookie"));
  return verifyAdminToken(cookies[ADMIN_COOKIE_NAME]);
}

function requireAdmin(event) {
  const session = getAdminSession(event);

  if (!session) {
    throw validationError("Admin login required.", 401);
  }

  return session;
}

function getAdminCookie(token) {
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(ADMIN_SESSION_MS / 1000)}`;
}

function getClearAdminCookie() {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function eqParam(value) {
  return `eq.${encodeURIComponent(value)}`;
}

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(payload, status = 200, headers = {}) {
  return {
    statusCode: status,
    headers: {
      ...jsonHeaders,
      ...headers
    },
    body: JSON.stringify(payload)
  };
}
