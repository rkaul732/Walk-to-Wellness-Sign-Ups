const routes = {
  register: "Register for Walk to Wellness",
  "create-team": "Create a Team",
  "enter-distance": "Enter Distance",
  messages: "Messages",
  "join-team": "Join a Team",
  "step-submission": "Step Submission",
  "live-feed": "Leaderboard",
  "individual-logs": "Individual Logs",
  admin: "Admin"
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const TEAM_MEMBER_LIMIT = 10;
const TEAM_FULL_MESSAGE = "This team already has 10 people, so it is full. Please join a new team.";
const KICKOFF_MESSAGE = "Kickoff on July 6!";
const MESSAGE_IMAGE_DATA_LIMIT = 1_600_000;
const MESSAGE_IMAGE_MAX_FILE_SIZE = 8 * 1024 * 1024;
const MESSAGE_IMAGE_MAX_SIDE = 1200;
const MESSAGE_REACTION_OPTIONS = ["👍", "❤️", "👏", "🎉", "😊", "💪"];
const KICKOFF_MODAL_STORAGE_KEY = "walkToWellnessKickoffDismissed";
const MENTION_SUGGESTION_LIMIT = 8;
const weekColors = [
  "#9ec9e8",
  "#7fb3dc",
  "#4fa4d8",
  "#376f98",
  "#f58fbd",
  "#f8a0a2",
  "#ffc59e",
  "#fedc72",
  "#d9e957",
  "#b9df68",
  "#90d3c7",
  "#7cc3eb",
  "#b4a7e7",
  "#f2a5d5",
  "#ffd0d7",
  "#f7df93",
  "#caeef2",
  "#e3a0cd",
  "#fffec9",
  "#d9d9ec"
];

let state = null;
let expandedTeamId = null;
let selectedDistanceTeamId = "";
let selectedDistanceMemberId = "";
let selectedDistanceMode = "daily";
let selectedDistanceWeek = getDefaultChallengeWeek();
let selectedIndividualLogView = "total";
let selectedIndividualLogDate = getDefaultIndividualLogDate();
let replyingToMessageId = null;
let adminSession = { authenticated: false, configured: true, username: null };
let mentionablePeople = [];
let mentionablePeopleUsesStateFallback = true;
let activeMention = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("hashchange", render);
document.addEventListener("submit", handleSubmit);
document.addEventListener("click", handleClick);
document.addEventListener("input", handleInput);
document.addEventListener("change", handleChange);
document.addEventListener("keydown", handleKeydown);

async function init() {
  renderLoading();

  try {
    await refreshState();
    await refreshMentionablePeople();
    await refreshAdminSession();
    render();
    showKickoffModal();
  } catch (error) {
    renderLoadError(error);
  }
}

async function refreshState() {
  const response = await fetch("/api/state", { cache: "no-store" });
  const payload = await readJsonResponse(response);

  if (!response.ok || !Array.isArray(payload?.teams)) {
    throw new Error(payload?.error || payload?.errorMessage || "Walk to Wellness data could not load.");
  }

  state = payload;
  state.distanceEntries = state.distanceEntries || [];
  state.messages = state.messages || [];
}

async function refreshAdminSession() {
  try {
    const response = await fetch("/api/admin/session", { cache: "no-store" });
    adminSession = await response.json();
  } catch {
    adminSession = { authenticated: false, configured: false, username: null };
  }
}

async function refreshMentionablePeople() {
  try {
    const response = await fetch("/api/mentionable-people", { cache: "no-store" });
    const payload = await readJsonResponse(response);

    if (!response.ok || !Array.isArray(payload?.people)) {
      throw new Error("Mention suggestions could not load.");
    }

    mentionablePeople = normalizeMentionablePeople(payload.people);
    mentionablePeopleUsesStateFallback = payload.source !== "contacts";
  } catch {
    mentionablePeople = getStateMentionablePeople();
    mentionablePeopleUsesStateFallback = true;
  }
}

function getStateMentionablePeople() {
  const people = [];

  for (const team of state?.teams || []) {
    for (const member of team.members || []) {
      people.push({ fullName: member.fullName });
    }
  }

  for (const registration of state?.registrations || []) {
    people.push({ fullName: `${registration.firstName || ""} ${registration.lastName || ""}` });
  }

  return normalizeMentionablePeople(people);
}

function normalizeMentionablePeople(people) {
  const byName = new Map();

  for (const person of people || []) {
    const fullName = cleanString(person.fullName || person.full_name || person.name);

    if (fullName.split(" ").length < 2) continue;

    byName.set(nameKey(fullName), { fullName });
  }

  return [...byName.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function getRoute() {
  const hash = window.location.hash.replace("#", "");
  const pathRoute = window.location.pathname.replace(/^\/|\/$/g, "");

  if (routes[hash]) {
    return hash;
  }

  if (routes[pathRoute]) {
    return pathRoute;
  }

  return "register";
}

function renderLoading() {
  app.innerHTML = `<div class="loading">Loading Walk to Wellness '26</div>`;
}

function renderLoadError(error) {
  app.innerHTML = `
    <section class="page content-band">
      <div class="single-column">
        <section class="panel load-error-panel">
          <p class="eyebrow">Walk to Wellness</p>
          <h1>We could not load the site data.</h1>
          <p>${escapeHtml(error?.message || "Please refresh the page or try again in a moment.")}</p>
          <button class="primary-button" type="button" data-retry-load>Try Again</button>
        </section>
      </div>
    </section>
  `;
}

function render() {
  if (!state) {
    renderLoading();
    return;
  }

  const route = getRoute();
  updateActiveNav(route);

  if (route === "register") renderRegisterPage();
  if (route === "create-team") renderCreateTeamPage();
  if (route === "enter-distance") renderEnterDistancePage();
  if (route === "messages") renderMessagesPage();
  if (route === "join-team") renderJoinTeamPage();
  if (route === "step-submission") renderStepSubmissionPage();
  if (route === "live-feed") renderLiveFeedPage();
  if (route === "individual-logs") renderIndividualLogsPage();
  if (route === "admin") renderAdminPage();
}

function updateActiveNav(route) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
  document.querySelectorAll("[data-route-group]").forEach((item) => {
    item.classList.toggle("active", item.dataset.routeGroup.split(/\s+/).includes(route));
  });
}

function renderRegisterPage() {
  const teamCount = state.teams.length;
  const memberCount = state.teams.reduce((total, team) => total + team.members.length, 0);
  const totalMiles = getTeamWeeklyRows().reduce((total, row) => total + row.totalMiles, 0);
  const selectedTeam = state.teams.find((team) => team.id === expandedTeamId);

  app.innerHTML = `
    <section class="page">
      <section class="hero">
        <div class="hero-content">
          <p class="eyebrow">Bright Harbor Healthcare</p>
          <h1>Walk to Wellness '26</h1>
          <p class="hero-tagline">Step Into Better Health, One Walk at a Time.</p>
          <p class="kickoff-note hero-kickoff">${KICKOFF_MESSAGE}</p>
          <p>Build movement into the workday through short walks, outdoor breaks, and shared progress with your colleagues.</p>
          <div class="hero-actions">
            <a class="primary-button" href="#create-team">Register A Team</a>
            <a class="secondary-button" href="#join-team">Join a Team</a>
          </div>
        </div>
      </section>

      <section class="content-band">
        <div class="intro-grid">
          <article class="intro-card">
            <p class="eyebrow">Step Into Better Health</p>
            <h2>One walk at a time.</h2>
            <p>Walk to Wellness is a simple, inclusive challenge that encourages employees to stay active while contributing to a shared goal.</p>
          </article>
          <article class="intro-card">
            <p class="eyebrow">How it Works</p>
            <h2>Form a team, log miles, follow the leaderboard.</h2>
            <p>Teams enter distance by daily or weekly totals, and the Live Feed updates team mileage by challenge week.</p>
          </article>
        </div>
      </section>

      <section class="content-band signup-section">
        <div class="content-grid landing-team-grid">
          <section class="panel" aria-labelledby="team-list-title">
            <div class="section-header">
              <div>
                <h2 id="team-list-title">Teams</h2>
                <p>${teamCount ? "Current Walk to Wellness teams" : "No teams have been created yet"}</p>
              </div>
            </div>

            <div class="stats-row">
              ${renderStat("Teams", teamCount)}
              ${renderStat("Members", memberCount)}
              ${renderStat("Miles", formatNumber(totalMiles))}
            </div>

            ${teamCount ? renderClickableTeamList() : renderNoTeams()}

            ${
              selectedTeam
                ? `<div class="member-panel">
                    <h3>${escapeHtml(selectedTeam.name)} Members</h3>
                    ${renderMembers(selectedTeam.members)}
                  </div>`
                : ""
            }
          </section>
        </div>
      </section>

      ${renderRecapSection()}
    </section>
  `;
}

function renderRecapSection() {
  return `
    <section class="recap-section" aria-label="Walk to Wellness 2025 recap">
      <div class="section-break">
        <span></span>
        <p>Walk to Wellness '25 Recap</p>
        <span></span>
      </div>
      <div class="recap-strip">
        <div>
          <span>Miles Walked</span>
          <strong>20,783</strong>
        </div>
        <div>
          <span>Participants</span>
          <strong>113</strong>
        </div>
        <div>
          <span>Teams</span>
          <strong>7</strong>
        </div>
        <div>
          <span>Countries Traveled</span>
          <strong>5</strong>
        </div>
      </div>
    </section>
  `;
}

function renderCreateTeamPage() {
  app.innerHTML = `
    <section class="page content-band">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Create a Team</h1>
            <p>Existing team names and members appear first.</p>
            <p class="kickoff-note">${KICKOFF_MESSAGE}</p>
          </div>
        </div>

        <section class="panel team-summary-panel" aria-labelledby="existing-teams-title">
          <h2 id="existing-teams-title">Existing Teams</h2>
          ${state.teams.length ? renderCreateTeamSummaries() : renderNoTeams()}
        </section>

        <section class="form-panel create-team-form" aria-labelledby="new-team-title">
          <h2 id="new-team-title">New Team</h2>
          <form class="form-grid" data-action="create-team">
            <label>
              Team Name
              <input name="name" required>
            </label>
            <label>
              Team Member Names
              <textarea name="memberNames" placeholder="One name per line"></textarea>
            </label>
            <div class="button-row">
              <button class="primary-button" type="submit">Create Team</button>
            </div>
          </form>
        </section>
      </div>
    </section>
  `;
}

function renderEnterDistancePage() {
  const selectedTeam = state.teams.find((team) => team.id === selectedDistanceTeamId) || state.teams[0] || null;

  if (selectedTeam && selectedDistanceTeamId !== selectedTeam.id) {
    selectedDistanceTeamId = selectedTeam.id;
  }

  const selectedMembers = selectedTeam?.members || [];
  const selectedMember = selectedMembers.find((member) => member.id === selectedDistanceMemberId) || selectedMembers[0] || null;

  if (selectedMember && selectedDistanceMemberId !== selectedMember.id) {
    selectedDistanceMemberId = selectedMember.id;
  }

  const weeks = getChallengeWeeks();
  const activeWeek = weeks.find((week) => week.weekNumber === Number(selectedDistanceWeek)) || weeks[0];

  app.innerHTML = `
    <section class="page content-band">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Enter Distance</h1>
            <p>Choose a team, member, challenge week, and distance entry type.</p>
          </div>
        </div>

        <section class="form-panel distance-widget" aria-labelledby="distance-entry-title">
          <h2 id="distance-entry-title">Distance Entry</h2>
          ${
            state.teams.length
              ? `<form class="form-grid" data-action="distance">
                  <div class="form-grid two-column">
                    <label>
                      Team
                      <select name="teamId" data-distance-team required>
                        ${state.teams
                          .map(
                            (team) => `<option value="${escapeAttribute(team.id)}" ${team.id === selectedDistanceTeamId ? "selected" : ""}>${escapeHtml(team.name)}</option>`
                          )
                          .join("")}
                      </select>
                    </label>
                    <label>
                      Team Member
                      <select name="memberId" data-distance-member required ${selectedMembers.length ? "" : "disabled"}>
                        ${
                          selectedMembers.length
                            ? selectedMembers
                                .map(
                                  (member) => `<option value="${escapeAttribute(member.id)}" ${member.id === selectedDistanceMemberId ? "selected" : ""}>${escapeHtml(member.fullName)}</option>`
                                )
                                .join("")
                            : `<option value="">No members yet</option>`
                        }
                      </select>
                    </label>
                  </div>
                  <div class="form-grid two-column">
                    <label>
                      Challenge Week
                      <select name="weekNumber" data-distance-week required>
                        ${weeks
                          .map(
                            (week) => `<option value="${week.weekNumber}" ${week.weekNumber === activeWeek.weekNumber ? "selected" : ""}>Week ${week.weekNumber}: ${escapeHtml(week.rangeLabel)}</option>`
                          )
                          .join("")}
                      </select>
                    </label>
                    <label>
                      Entry Type
                      <select name="entryMode" data-distance-mode required>
                        <option value="daily" ${selectedDistanceMode === "daily" ? "selected" : ""}>Daily totals</option>
                        <option value="weekly" ${selectedDistanceMode === "weekly" ? "selected" : ""}>Weekly totals</option>
                      </select>
                    </label>
                  </div>
                  ${
                    selectedDistanceMode === "daily"
                      ? renderDailyDistanceInputs(activeWeek)
                      : renderWeeklyDistanceInput(activeWeek)
                  }
                  <div class="button-row">
                    <button class="primary-button" type="submit" ${selectedMembers.length ? "" : "disabled"}>Save Distance</button>
                  </div>
                </form>`
              : `<div class="empty-zero"><div><strong>0</strong><p>Create a team before entering distance.</p></div></div>`
          }
        </section>
      </div>
    </section>
  `;
}

function renderDailyDistanceInputs(week) {
  return `
    <fieldset class="daily-calendar">
      <legend>Daily Totals for Week ${week.weekNumber}</legend>
      <p class="muted small daily-entry-note">Enter miles for one day or multiple days. Leave days blank if you are not submitting them right now.</p>
      <div class="day-grid">
        ${week.days
          .map(
            (day) => `
              <label class="day-entry">
                <span>${escapeHtml(day.dayName)}</span>
                <small>${escapeHtml(day.dateLabel)}</small>
                <input name="daily_${day.dayIndex}" inputmode="decimal" placeholder="0" data-mile-input>
              </label>`
          )
          .join("")}
      </div>
    </fieldset>
  `;
}

function renderWeeklyDistanceInput(week) {
  return `
    <label class="weekly-entry">
      Enter Total Miles for Week ${week.weekNumber}
      <span>${escapeHtml(week.rangeLabel)}</span>
      <input name="weeklyMiles" inputmode="decimal" placeholder="0" required data-mile-input>
    </label>
  `;
}

function renderJoinTeamPage() {
  app.innerHTML = `
    <section class="page content-band">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Join a Team</h1>
            <p>${state.teams.length ? "Choose a team and add your name." : "No teams are open yet."}</p>
            <p class="kickoff-note">${KICKOFF_MESSAGE}</p>
          </div>
          <a class="secondary-button" href="#create-team">Create a Team</a>
        </div>

        ${
          state.teams.length
            ? `<div class="team-board">${state.teams.map(renderJoinTeamCard).join("")}</div>`
            : renderNoTeams()
        }
      </div>
    </section>
  `;
}

function renderStepSubmissionPage() {
  const today = new Date().toISOString().slice(0, 10);

  app.innerHTML = `
    <section class="page content-band">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Step Submission</h1>
            <p>Submit an individual activity entry for the Live Feed.</p>
          </div>
        </div>

        <section class="form-panel" aria-labelledby="activity-title">
          <h2 id="activity-title">Activity Entry</h2>
          <form class="form-grid" data-action="activity">
            <label>
              Name
              <input name="participantName" autocomplete="name" required>
            </label>
            <div class="form-grid two-column">
              <label>
                Number of Miles Walked
                <input name="miles" type="number" min="0.01" step="0.01" required>
              </label>
              <label>
                Type of Activity
                <input name="activityType" list="activity-options" required>
              </label>
            </div>
            <div class="form-grid two-column">
              <label>
                Duration of Activity
                <input name="duration" placeholder="45 minutes">
              </label>
              <label>
                Date of Activity
                <input name="activityDate" type="date" value="${today}" required>
              </label>
            </div>
            <datalist id="activity-options">
              <option value="Walking"></option>
              <option value="Running"></option>
              <option value="Cycling"></option>
              <option value="Swimming"></option>
              <option value="Strength Training"></option>
            </datalist>
            <div class="button-row">
              <button class="primary-button" type="submit">Submit</button>
            </div>
          </form>
        </section>
      </div>
    </section>
  `;
}

function renderMessagesPage() {
  const messages = state.messages || [];
  const threads = getMessageThreads();

  app.innerHTML = `
    <section class="page content-band messages-page">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Messages</h1>
            <p>Post encouragement, celebrate team wins, and share pictures from your walks.</p>
          </div>
        </div>

        <section class="form-panel message-form-panel" aria-labelledby="message-form-title">
          <h2 id="message-form-title">Post to the Wall</h2>
          <form class="form-grid" data-action="message">
            <div class="form-grid two-column">
              <label>
                Name
                <input name="authorName" autocomplete="name" maxlength="80" required>
              </label>
              <label>
                Team
                <select name="teamId">
                  <option value="">No team selected</option>
                  ${state.teams
                    .map((team) => `<option value="${escapeAttribute(team.id)}">${escapeHtml(team.name)}</option>`)
                    .join("")}
                </select>
              </label>
            </div>
            <label>
              Encouragement Message
              <span class="mention-field">
                <textarea name="messageText" maxlength="600" placeholder="Cheer someone on or share a walking highlight." required data-mention-input aria-autocomplete="list" aria-expanded="false"></textarea>
                <span class="mention-picker" data-mention-picker hidden></span>
              </span>
              <span class="field-hint">Type @ and select a name to send that person an email notification.</span>
            </label>
            <label>
              Walk Photo
              <input name="walkPhoto" type="file" accept="image/jpeg,image/png,image/webp">
            </label>
            <div class="button-row">
              <button class="primary-button" type="submit">Post Message</button>
            </div>
          </form>
        </section>

        <section class="panel message-wall-panel" aria-labelledby="message-wall-title">
          <div class="section-header compact-header">
            <div>
              <h2 id="message-wall-title">Encouragement Wall</h2>
              <p>${messages.length ? `${messages.length} ${pluralize("message", messages.length)}` : "No messages yet."}</p>
            </div>
          </div>
          ${
            threads.length
              ? `<div class="message-wall">${threads.map((message) => renderMessageCard(message)).join("")}</div>`
              : `<p class="muted">Be the first to cheer on the Walk to Wellness teams.</p>`
          }
        </section>
      </div>
    </section>
  `;
}

function renderMessageCard(message, depth = 0) {
  return `
    <article class="message-card ${depth ? "reply-card" : ""}" style="--reply-depth:${Math.min(depth, 4)}">
      <div class="message-card-header">
        <div>
          <h3>${escapeHtml(message.authorName)}</h3>
          ${message.teamName ? `<p>${escapeHtml(message.teamName)}</p>` : ""}
        </div>
        <time datetime="${escapeAttribute(message.createdAt)}">${escapeHtml(formatDateTime(message.createdAt))}</time>
      </div>
      <p class="message-text">${formatMessageText(message.messageText)}</p>
      ${
        message.imageData
          ? `<img class="message-photo" src="${escapeAttribute(message.imageData)}" alt="${escapeAttribute(message.imageName || "Walk photo")}">`
          : ""
      }
      <div class="message-actions">
        <div class="reaction-bar" aria-label="Reactions">
          ${MESSAGE_REACTION_OPTIONS.map((emoji) => renderReactionButton(message, emoji)).join("")}
        </div>
        <button class="reply-button" type="button" data-reply-toggle="${escapeAttribute(message.id)}">Reply</button>
      </div>
      ${replyingToMessageId === message.id ? renderReplyForm(message) : ""}
      ${
        message.replies?.length
          ? `<div class="message-replies">${message.replies.map((reply) => renderMessageCard(reply, depth + 1)).join("")}</div>`
          : ""
      }
    </article>
  `;
}

function renderReactionButton(message, emoji) {
  const count = Number(message.reactionCounts?.[emoji]) || 0;

  return `
    <button class="reaction-button" type="button" data-message-reaction="${escapeAttribute(message.id)}" data-emoji="${escapeAttribute(emoji)}" aria-label="${escapeAttribute(`React with ${emoji}`)}">
      <span>${escapeHtml(emoji)}</span>
      ${count ? `<strong>${formatNumber(count)}</strong>` : ""}
    </button>
  `;
}

function renderReplyForm(message) {
  return `
    <form class="reply-form" data-action="message-reply" data-parent-message-id="${escapeAttribute(message.id)}">
      <div class="form-grid two-column">
        <label>
          Name
          <input name="authorName" autocomplete="name" maxlength="80" required>
        </label>
      </div>
      <label>
        Reply
        <span class="mention-field">
          <textarea name="messageText" maxlength="600" placeholder="Write a reply..." required data-mention-input aria-autocomplete="list" aria-expanded="false"></textarea>
          <span class="mention-picker" data-mention-picker hidden></span>
        </span>
        <span class="field-hint">Type @ and select a name to send that person an email notification.</span>
      </label>
      <div class="button-row">
        <button class="primary-button" type="submit">Post Reply</button>
      </div>
    </form>
  `;
}

function getMessageThreads() {
  const byId = new Map();
  const roots = [];

  for (const message of state.messages || []) {
    byId.set(message.id, {
      ...message,
      replies: []
    });
  }

  for (const message of byId.values()) {
    const parent = message.parentMessageId ? byId.get(message.parentMessageId) : null;

    if (parent) {
      parent.replies.push(message);
    } else {
      roots.push(message);
    }
  }

  const sortReplies = (messages) => {
    messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    messages.forEach((message) => sortReplies(message.replies));
  };

  roots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  roots.forEach((message) => sortReplies(message.replies));

  return roots;
}

function renderLiveFeedPage() {
  app.innerHTML = `
    <section class="page content-band live-feed-page">
      <div class="live-feed-shell">
        <div class="section-header">
          <div>
            <h1>Leaderboard</h1>
            <p>Team mileage by challenge week.</p>
          </div>
        </div>
        <section class="panel chart-panel" aria-labelledby="team-weekly-title">
          <h2 id="team-weekly-title">Miles by Team and Week</h2>
          ${renderWeeklyStackedChart()}
        </section>
        <section class="panel top-members-panel" aria-labelledby="top-members-title">
          <h2 id="top-members-title">Top Three Members</h2>
          ${renderTopMembers()}
        </section>
      </div>
    </section>
  `;
}

function renderIndividualLogsPage() {
  const isDateView = selectedIndividualLogView === "date";
  const dateBounds = getChallengeDateBounds();
  const selectedDate = selectedIndividualLogDate || getDefaultIndividualLogDate();
  const rows = getIndividualMileageRows({
    date: isDateView ? selectedDate : ""
  });
  const totalMiles = rows.reduce((total, row) => total + row.miles, 0);
  const selectedDateLabel = isDateView ? formatSelectedLogDate(selectedDate) : "";

  app.innerHTML = `
    <section class="page content-band individual-logs-page">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Individual Logs</h1>
            <p>${isDateView ? `Everyone listed alphabetically with miles for ${escapeHtml(selectedDateLabel)}.` : "Everyone listed alphabetically with total miles walked so far."}</p>
          </div>
        </div>
        <section class="panel individual-log-panel" aria-labelledby="individual-log-title">
          <div class="section-header compact-header">
            <div>
              <h2 id="individual-log-title">Participant Mileage</h2>
              <p>${rows.length} ${pluralize("participant", rows.length)} · ${formatNumber(totalMiles)} ${isDateView ? `total ${pluralize("mile", totalMiles)} on ${escapeHtml(selectedDateLabel)}` : `total ${pluralize("mile", totalMiles)}`}</p>
            </div>
          </div>
          ${renderIndividualLogControls(dateBounds)}
          ${renderIndividualLogsTable(rows, isDateView)}
        </section>
      </div>
    </section>
  `;
}

function renderIndividualLogControls(dateBounds) {
  return `
    <div class="individual-log-controls">
      <label>
        View By
        <select data-individual-log-view>
          <option value="total" ${selectedIndividualLogView === "total" ? "selected" : ""}>By Total</option>
          <option value="date" ${selectedIndividualLogView === "date" ? "selected" : ""}>By Date</option>
        </select>
      </label>
      ${
        selectedIndividualLogView === "date"
          ? `<label>
              Select Date
              <input type="date" value="${escapeAttribute(selectedIndividualLogDate)}" min="${escapeAttribute(dateBounds.min)}" max="${escapeAttribute(dateBounds.max)}" data-individual-log-date>
            </label>`
          : ""
      }
    </div>
  `;
}

function renderIndividualLogsTable(rows, isDateView = false) {
  if (!rows.length) {
    return `<p class="muted">No team members have signed up yet.</p>`;
  }

  return `
    <div class="individual-log-table-wrap">
      <table class="individual-log-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Team</th>
            <th scope="col">${isDateView ? "Miles This Date" : "Total Miles"}</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.name)}</td>
                  <td>${escapeHtml(row.teamName)}</td>
                  <td>${formatNumber(row.miles)}</td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAdminPage() {
  app.innerHTML = `
    <section class="page content-band admin-page">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Admin</h1>
            <p>Manage teams and team members.</p>
          </div>
          ${
            adminSession.authenticated
              ? `<button class="secondary-button" type="button" data-admin-logout>Log Out</button>`
              : ""
          }
        </div>
        ${
          adminSession.authenticated
            ? renderAdminDashboard()
            : renderAdminLogin()
        }
      </div>
    </section>
  `;
}

function renderAdminLogin() {
  return `
    <section class="form-panel admin-login-panel" aria-labelledby="admin-login-title">
      <h2 id="admin-login-title">Admin Login</h2>
      ${
        adminSession.configured === false
          ? `<p class="error-note">Admin login is not configured yet. Add ADMIN_PASSWORD in Netlify environment variables, then redeploy.</p>`
          : ""
      }
      <form class="form-grid" data-action="admin-login">
        <label>
          Username
          <input name="username" autocomplete="username" value="admin" required ${adminSession.configured === false ? "disabled" : ""}>
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required ${adminSession.configured === false ? "disabled" : ""}>
        </label>
        <div class="button-row">
          <button class="primary-button" type="submit" ${adminSession.configured === false ? "disabled" : ""}>Log In</button>
        </div>
      </form>
    </section>
  `;
}

function renderAdminDashboard() {
  return `
    ${renderAdminMileageEditor()}
    <section class="panel admin-dashboard" aria-labelledby="admin-dashboard-title">
      <div class="section-header compact-header">
        <div>
          <h2 id="admin-dashboard-title">Teams</h2>
          <p>${state.teams.length ? "Rename teams, edit members, or remove accidental teams." : "No teams have been created yet."}</p>
        </div>
      </div>
      ${
        state.teams.length
          ? `<div class="admin-team-list">${state.teams.map(renderAdminTeamCard).join("")}</div>`
          : renderNoTeams()
      }
    </section>
  `;
}

function renderAdminMileageEditor() {
  const memberOptions = getAdminMemberOptions();
  const dayOptions = getChallengeDayOptions();
  const defaultDate = getDefaultAdminMileageDate(dayOptions);
  const dailyRows = getAdminDailyMileageRows();

  return `
    <section class="panel admin-mileage-panel" aria-labelledby="admin-mileage-title">
      <div class="section-header compact-header">
        <div>
          <h2 id="admin-mileage-title">Edit Miles</h2>
          <p>Correct a team member's miles for a specific date. Set miles to 0 to remove that date.</p>
        </div>
      </div>
      ${
        memberOptions.length
          ? `<form class="admin-mileage-form" data-action="admin-edit-mileage">
              <label>
                Team Member
                <select name="memberId" required>
                  ${memberOptions
                    .map((option) => `<option value="${escapeAttribute(option.memberId)}">${escapeHtml(option.memberName)} - ${escapeHtml(option.teamName)}</option>`)
                    .join("")}
                </select>
              </label>
              <label>
                Date
                <select name="activityDate" required>
                  ${dayOptions
                    .map((day) => `<option value="${escapeAttribute(day.isoDate)}" ${day.isoDate === defaultDate ? "selected" : ""}>${escapeHtml(day.dateLabel)} (${escapeHtml(day.dayName)})</option>`)
                    .join("")}
                </select>
              </label>
              <label>
                Correct Miles
                <input name="miles" inputmode="decimal" placeholder="0" required data-mile-input>
              </label>
              <button class="primary-button" type="submit">Save Miles</button>
            </form>`
          : `<p class="muted small">Add team members before editing mileage.</p>`
      }
      ${
        dailyRows.length
          ? `<div class="admin-mileage-list" aria-label="Existing daily mileage entries">
              <h3>Existing Daily Entries</h3>
              ${dailyRows.slice(0, 80).map(renderAdminMileageRow).join("")}
              ${dailyRows.length > 80 ? `<p class="muted small">Showing the latest 80 daily entries.</p>` : ""}
            </div>`
          : `<p class="muted small">No daily miles have been entered yet.</p>`
      }
    </section>
  `;
}

function renderAdminMileageRow(row) {
  return `
    <form class="admin-mileage-row" data-action="admin-edit-mileage">
      <input type="hidden" name="memberId" value="${escapeAttribute(row.memberId)}">
      <input type="hidden" name="activityDate" value="${escapeAttribute(row.isoDate)}">
      <div class="admin-mileage-row-meta">
        <strong>${escapeHtml(row.memberName)}</strong>
        <span>${escapeHtml(row.teamName)}</span>
        <span>${escapeHtml(row.dateLabel)} (${escapeHtml(row.dayName)})</span>
      </div>
      <label>
        Correct Miles
        <input name="miles" inputmode="decimal" value="${escapeAttribute(formatMilesInput(row.miles))}" required data-mile-input>
      </label>
      <button class="secondary-button" type="submit">Save Miles</button>
    </form>
  `;
}

function renderAdminTeamCard(team) {
  const isFull = team.members.length >= TEAM_MEMBER_LIMIT;

  return `
    <article class="admin-team-card">
      <div class="admin-team-card-header">
        <div>
          <h3>${escapeHtml(team.name)}</h3>
          <p>${team.members.length}/${TEAM_MEMBER_LIMIT} ${pluralize("member", team.members.length)}</p>
        </div>
        <button class="danger-button" type="button" data-admin-delete-team="${escapeAttribute(team.id)}">Delete Team</button>
      </div>

      <form class="admin-inline-form" data-action="admin-rename-team" data-team-id="${escapeAttribute(team.id)}">
        <label>
          Team Name
          <input name="name" value="${escapeAttribute(team.name)}" required>
        </label>
        <button class="secondary-button" type="submit">Save Team</button>
      </form>

      <form class="admin-inline-form" data-action="admin-add-member" data-team-id="${escapeAttribute(team.id)}">
        <label>
          Add Member
          <input name="fullName" placeholder="${isFull ? "Team is full" : "First Last"}" ${isFull ? "disabled" : "required"}>
        </label>
        <button class="primary-button" type="submit" ${isFull ? "disabled" : ""}>Add Member</button>
      </form>

      <div class="admin-member-list">
        ${
          team.members.length
            ? team.members.map((member) => renderAdminMemberRow(team, member)).join("")
            : `<p class="muted small">No team members yet.</p>`
        }
      </div>
    </article>
  `;
}

function renderAdminMemberRow(team, member) {
  return `
    <div class="admin-member-row">
      <form class="admin-inline-form" data-action="admin-rename-member" data-team-id="${escapeAttribute(team.id)}" data-member-id="${escapeAttribute(member.id)}">
        <label>
          Member
          <input name="fullName" value="${escapeAttribute(member.fullName)}" required>
        </label>
        <button class="secondary-button" type="submit">Save</button>
      </form>
      <button class="danger-button" type="button" data-admin-delete-member="${escapeAttribute(member.id)}" data-team-id="${escapeAttribute(team.id)}">Remove</button>
    </div>
  `;
}

function getAdminMemberOptions() {
  return state.teams.flatMap((team) =>
    team.members.map((member) => ({
      teamId: team.id,
      teamName: team.name,
      memberId: member.id,
      memberName: member.fullName
    }))
  ).sort((a, b) => a.memberName.localeCompare(b.memberName) || a.teamName.localeCompare(b.teamName));
}

function getChallengeDayOptions() {
  return getChallengeWeeks().flatMap((week) =>
    week.days.map((day) => ({
      ...day,
      weekNumber: week.weekNumber
    }))
  );
}

function getDefaultAdminMileageDate(dayOptions) {
  const today = toISODate(new Date());
  return dayOptions.some((day) => day.isoDate === today)
    ? today
    : dayOptions[0]?.isoDate || "";
}

function getDefaultIndividualLogDate() {
  return getDefaultAdminMileageDate(getChallengeDayOptions());
}

function getChallengeDateBounds() {
  const dayOptions = getChallengeDayOptions();

  return {
    min: dayOptions[0]?.isoDate || "",
    max: dayOptions.at(-1)?.isoDate || ""
  };
}

function formatSelectedLogDate(value) {
  const day = getChallengeDayOptions().find((entry) => entry.isoDate === value);

  return day
    ? `${day.dateLabel} (${day.dayName})`
    : value;
}

function getAdminDailyMileageRows() {
  const members = new Map();
  const rows = new Map();

  for (const team of state.teams) {
    for (const member of team.members) {
      members.set(member.id, {
        teamName: team.name,
        memberName: member.fullName
      });
    }
  }

  for (const entry of state.distanceEntries || []) {
    if (entry.entryMode !== "daily") continue;

    for (const day of entry.dailyMiles || []) {
      const isoDate = cleanString(day.isoDate);
      const miles = Number(day.miles) || 0;

      if (!entry.memberId || !isoDate || miles <= 0) continue;

      const member = members.get(entry.memberId) || {
        teamName: entry.teamName || "Unknown Team",
        memberName: entry.memberName || "Unknown Member"
      };
      const key = `${entry.memberId}:${isoDate}`;
      const existing = rows.get(key) || {
        memberId: entry.memberId,
        memberName: member.memberName,
        teamName: member.teamName,
        isoDate,
        dayName: cleanString(day.dayName),
        dateLabel: cleanString(day.dateLabel) || isoDate,
        miles: 0
      };

      existing.miles = roundMiles(existing.miles + miles);
      rows.set(key, existing);
    }
  }

  return [...rows.values()].sort((a, b) =>
    b.isoDate.localeCompare(a.isoDate) ||
    a.memberName.localeCompare(b.memberName) ||
    a.teamName.localeCompare(b.teamName)
  );
}

function renderStat(label, value) {
  return `
    <div class="stat-card">
      <strong>${escapeHtml(String(value))}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function renderNoTeams() {
  return `
    <div class="empty-zero">
      <div>
        <strong>0</strong>
        <p>Be The First Team to Sign Up!</p>
      </div>
    </div>
  `;
}

function renderClickableTeamList() {
  return `
    <ul class="team-list">
      ${state.teams
        .map(
          (team) => `
            <li>
              <button type="button" data-team-toggle="${escapeAttribute(team.id)}" aria-expanded="${team.id === expandedTeamId}">
                <span>${escapeHtml(team.name)}</span>
                <span class="team-count">${team.members.length} ${pluralize("member", team.members.length)}</span>
              </button>
            </li>`
        )
        .join("")}
    </ul>
  `;
}

function renderJoinTeamCard(team) {
  const isFull = team.members.length >= TEAM_MEMBER_LIMIT;

  return `
    <article class="team-card ${isFull ? "team-card-full" : ""}">
      <h3>
        <span>${escapeHtml(team.name)}</span>
        <span class="team-count">${team.members.length}/${TEAM_MEMBER_LIMIT} ${pluralize("member", team.members.length)}</span>
      </h3>
      ${renderMembers(team.members)}
      ${
        isFull
          ? `<button class="team-full-button" type="button" disabled>TEAM FULL</button>`
          : `<form data-action="join-team" data-team-id="${escapeAttribute(team.id)}">
              <label>
                Name
                <input name="fullName" autocomplete="name" required>
              </label>
              <button class="primary-button" type="submit">Join This Team</button>
            </form>`
      }
    </article>
  `;
}

function renderCreateTeamSummaries() {
  return `
    <ul class="team-summary-list">
      ${state.teams
        .map(
          (team) => `
            <li class="team-summary">
              <div>
                <h3>${escapeHtml(team.name)}</h3>
                ${renderMembers(team.members)}
              </div>
              <span class="team-count">${team.members.length} ${pluralize("member", team.members.length)}</span>
            </li>`
        )
        .join("")}
    </ul>
  `;
}

function renderMembers(members) {
  if (!members.length) {
    return `<p class="muted small">No team members yet.</p>`;
  }

  return `
    <ul class="member-list">
      ${members.map((member) => `<li>${escapeHtml(member.fullName)}</li>`).join("")}
    </ul>
  `;
}

function renderWeeklyStackedChart() {
  const rows = getTeamWeeklyRows();

  if (!rows.length || rows.every((row) => row.totalMiles === 0)) {
    return `<p class="muted">No distance entries yet.</p>`;
  }

  const axisMax = getAxisMax(Math.max(...rows.map((row) => row.totalMiles), 1));
  const ticks = getAxisTicks(axisMax);
  const weeksWithData = getChallengeWeeks().filter((week) =>
    rows.some((row) => (row.weekTotals[week.weekNumber] || 0) > 0)
  );
  const legendWeeks = weeksWithData.length ? weeksWithData : getChallengeWeeks().slice(0, 9);
  const latest = getLatestUpdateLabel();

  return `
    <div class="weekly-chart">
      <div class="week-legend" aria-label="Challenge weeks">
        ${legendWeeks
          .map(
            (week) => `
              <span>
                <i style="background:${getWeekColor(week.weekNumber)}"></i>
                Week ${week.weekNumber}
              </span>`
          )
          .join("")}
      </div>
      <div class="stacked-chart" style="--axis-max:${axisMax}">
        ${rows
          .map(
            (row) => `
              <div class="stacked-row">
                <div class="stacked-label">${escapeHtml(row.teamName)} (${row.memberCount})</div>
                <div class="stacked-track">
                  ${getChallengeWeeks()
                    .map((week) => {
                      const miles = row.weekTotals[week.weekNumber] || 0;
                      const width = (miles / axisMax) * 100;

                      return miles > 0
                        ? `<span class="stacked-segment" title="Week ${week.weekNumber}: ${formatNumber(miles)} miles" style="width:${width}%; background:${getWeekColor(week.weekNumber)}"></span>`
                        : "";
                    })
                    .join("")}
                </div>
                <div class="stacked-total">${formatNumber(row.totalMiles)}</div>
              </div>`
          )
          .join("")}
        <div class="axis-row">
          <span></span>
          <div class="axis-line">
            ${ticks.map((tick) => `<span style="left:${(tick / axisMax) * 100}%">${formatNumber(tick)}</span>`).join("")}
          </div>
          <span></span>
        </div>
        <div class="axis-title">Miles</div>
      </div>
      <p class="last-updated">Last Updated: ${escapeHtml(latest)}</p>
    </div>
  `;
}

function renderTopMembers() {
  const members = getTopMembers();

  if (!members.length) {
    return `<p class="muted">No member mileage has been submitted yet.</p>`;
  }

  return `
    <ol class="rank-list">
      ${members
        .map(
          (member) => `
            <li class="rank-row">
              <span class="rank-number">${member.rank}</span>
              <strong>${escapeHtml(member.name)}</strong>
              <span class="bar-value">${formatNumber(member.miles)}</span>
            </li>`
        )
        .join("")}
    </ol>
  `;
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;

  event.preventDefault();

  const action = form.dataset.action;
  const formData = Object.fromEntries(new FormData(form).entries());

  try {
    if (action === "register") {
      await postJson("/api/registrations", formData);
      showToast("Registration saved.");
    }

    if (action === "create-team") {
      const memberNames = splitEntryNames(formData.memberNames);

      if (memberNames.length > TEAM_MEMBER_LIMIT) {
        showToast(`Teams can have a maximum of ${TEAM_MEMBER_LIMIT} people. Please move additional members to a new team.`, "error");
        return;
      }

      await postJson("/api/teams", formData);
      showToast("Team created.");
    }

    if (action === "join-team") {
      const team = state.teams.find((entry) => entry.id === form.dataset.teamId);

      if (team && team.members.length >= TEAM_MEMBER_LIMIT) {
        showToast(TEAM_FULL_MESSAGE, "error");
        return;
      }

      await postJson(`/api/teams/${encodeURIComponent(form.dataset.teamId)}/members`, formData);
      showToast("Team member added.");
    }

    if (action === "activity") {
      await postJson("/api/activities", formData);
      showToast("Step submission saved.");
    }

    if (action === "distance") {
      await submitDistance(form, formData);
      showToast("Distance saved.");
    }

    if (action === "message") {
      await submitMessage(form);
      showToast("Message posted.");
    }

    if (action === "message-reply") {
      await submitMessage(form);
      replyingToMessageId = null;
      showToast("Reply posted.");
    }

    if (action === "admin-login") {
      adminSession = await postJson("/api/admin/login", formData);
      showToast("Admin login successful.");
    }

    if (action === "admin-rename-team") {
      await requestJson(`/api/admin/teams/${encodeURIComponent(form.dataset.teamId)}`, {
        method: "PATCH",
        body: { name: formData.name }
      });
      showToast("Team updated.");
    }

    if (action === "admin-add-member") {
      await requestJson(`/api/admin/teams/${encodeURIComponent(form.dataset.teamId)}/members`, {
        method: "POST",
        body: { fullName: formData.fullName }
      });
      showToast("Member added.");
    }

    if (action === "admin-rename-member") {
      await requestJson(`/api/admin/teams/${encodeURIComponent(form.dataset.teamId)}/members/${encodeURIComponent(form.dataset.memberId)}`, {
        method: "PATCH",
        body: { fullName: formData.fullName }
      });
      showToast("Member updated.");
    }

    if (action === "admin-edit-mileage") {
      assertMiles(formData.miles, "correct miles");
      await requestJson("/api/admin/mileage", {
        method: "PATCH",
        body: {
          memberId: formData.memberId,
          activityDate: formData.activityDate,
          miles: Number(formData.miles)
        }
      });
      showToast("Miles updated.");
    }

    await refreshState();
    await refreshAdminSession();
    form.reset();
    render();
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  }
}

async function submitDistance(form, formData) {
  const entryMode = formData.entryMode;
  const body = {
    teamId: formData.teamId,
    memberId: formData.memberId,
    entryMode,
    weekNumber: Number(formData.weekNumber)
  };

  if (entryMode === "daily") {
    const dailyMiles = getChallengeWeeks()
      .find((week) => week.weekNumber === body.weekNumber)
      .days.map((day) => {
        const value = cleanString(formData[`daily_${day.dayIndex}`]);

        if (!value) {
          return null;
        }

        assertMiles(value, `${day.dayName} miles`);
        return {
          dayIndex: day.dayIndex,
          dayName: day.dayName,
          isoDate: day.isoDate,
          dateLabel: day.dateLabel,
          miles: Number(value)
        };
      })
      .filter((day) => day && day.miles > 0);

    if (!dailyMiles.length) {
      throw new Error("Please enter miles greater than zero for at least one day.");
    }

    body.dailyMiles = dailyMiles;
  } else {
    assertMiles(formData.weeklyMiles, "weekly miles");
    body.weeklyMiles = Number(formData.weeklyMiles);
  }

  try {
    await postJson("/api/distance", body);
  } catch (error) {
    if (error.status !== 409 || !error.payload?.duplicate) {
      throw error;
    }

    const duplicateAction = await showDuplicateDistanceModal(error.payload.duplicate);
    await postJson("/api/distance", {
      ...body,
      duplicateAction
    });
  }
}

async function submitMessage(form) {
  const formData = new FormData(form);
  const walkPhoto = formData.get("walkPhoto");
  const body = {
    authorName: formData.get("authorName"),
    parentMessageId: form.dataset.parentMessageId || "",
    teamId: formData.get("teamId"),
    messageText: formData.get("messageText"),
    imageData: "",
    imageName: ""
  };

  if (walkPhoto instanceof File && walkPhoto.size > 0) {
    const image = await prepareMessageImage(walkPhoto);
    body.imageData = image.imageData;
    body.imageName = image.imageName;
  }

  await postJson("/api/messages", body);
}

async function prepareMessageImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Please upload a JPG, PNG, or WebP image.");
  }

  if (file.size > MESSAGE_IMAGE_MAX_FILE_SIZE) {
    throw new Error("Please choose a photo smaller than 8 MB.");
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MESSAGE_IMAGE_MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.82;
  let imageData = canvas.toDataURL("image/jpeg", quality);

  while (imageData.length > MESSAGE_IMAGE_DATA_LIMIT && quality > 0.46) {
    quality -= 0.12;
    imageData = canvas.toDataURL("image/jpeg", quality);
  }

  if (imageData.length > MESSAGE_IMAGE_DATA_LIMIT) {
    throw new Error("Please choose a smaller photo.");
  }

  return {
    imageData,
    imageName: file.name
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Please choose a different photo."));
    };
    image.src = url;
  });
}

function showDuplicateDistanceModal(duplicate) {
  return new Promise((resolve) => {
    const existingModal = document.querySelector(".modal-backdrop");
    existingModal?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <section class="choice-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-distance-title">
        <h2 id="duplicate-distance-title">Duplicate Distance Entry</h2>
        <p>${escapeHtml(duplicate.message || "You have previously entered miles for this person on this date. Do you want to override or add the totals?")}</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" data-duplicate-action="override">Override</button>
          <button class="primary-button" type="button" data-duplicate-action="add">Add Totals</button>
        </div>
      </section>
    `;

    const finish = (action) => {
      backdrop.remove();
      resolve(action);
    };

    backdrop.addEventListener("click", (event) => {
      const button = event.target.closest("[data-duplicate-action]");
      if (!button) return;
      finish(button.dataset.duplicateAction);
    });

    document.body.append(backdrop);
    backdrop.querySelector("[data-duplicate-action]")?.focus();
  });
}

function showKickoffModal() {
  if (isKickoffModalDismissed() || document.querySelector("[data-kickoff-modal]")) {
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop kickoff-modal-backdrop";
  backdrop.dataset.kickoffModal = "true";
  backdrop.innerHTML = `
    <section class="kickoff-modal" role="dialog" aria-modal="true" aria-labelledby="kickoff-modal-title">
      <button class="kickoff-modal-close" type="button" aria-label="Close announcement" data-kickoff-close>&times;</button>
      <p class="eyebrow">Walk to Wellness</p>
      <h2 id="kickoff-modal-title">The Walk to Wellness Challenge Kicked off July 6!</h2>
      <p>Not a member of a team yet? No worries! You're welcome to join at any point during the competition.</p>
      <div class="kickoff-modal-actions">
        <a class="secondary-button" href="#register" data-kickoff-link>Check It Out</a>
        <a class="primary-button" href="#create-team" data-kickoff-link>Create a Team</a>
        <a class="secondary-button" href="#join-team" data-kickoff-link>Join a Team</a>
      </div>
      <p class="kickoff-modal-subtext">Contact Rebecca Kaul for Extra Info</p>
    </section>
  `;

  document.body.append(backdrop);
  window.setTimeout(() => {
    backdrop.querySelector("[data-kickoff-close]")?.focus();
  }, 0);
}

function dismissKickoffModal() {
  setKickoffModalDismissed();
  document.querySelector("[data-kickoff-modal]")?.remove();
}

function isKickoffModalDismissed() {
  try {
    return sessionStorage.getItem(KICKOFF_MODAL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function setKickoffModalDismissed() {
  try {
    sessionStorage.setItem(KICKOFF_MODAL_STORAGE_KEY, "true");
  } catch {
    // Ignore storage errors so the close button still works.
  }
}

function handleInput(event) {
  if (!event.target.matches("[data-mention-input]")) return;

  updateMentionPicker(event.target);
}

function handleClick(event) {
  const mentionOption = event.target.closest("[data-mention-option]");
  const kickoffCloseButton = event.target.closest("[data-kickoff-close]");
  const kickoffLink = event.target.closest("[data-kickoff-link]");
  const kickoffBackdrop = event.target.matches("[data-kickoff-modal]") ? event.target : null;
  const navDropdownLink = event.target.closest("[data-nav-dropdown-link]");
  const toggle = event.target.closest("[data-team-toggle]");
  const replyToggle = event.target.closest("[data-reply-toggle]");
  const reactionButton = event.target.closest("[data-message-reaction]");
  const logoutButton = event.target.closest("[data-admin-logout]");
  const deleteTeamButton = event.target.closest("[data-admin-delete-team]");
  const deleteMemberButton = event.target.closest("[data-admin-delete-member]");

  if (mentionOption) {
    selectMentionOption(Number(mentionOption.dataset.mentionOption) || 0);
    return;
  }

  if (!event.target.closest(".mention-field")) {
    hideMentionPicker();
  }

  if (event.target.closest("[data-retry-load]")) {
    init();
    return;
  }

  if (kickoffCloseButton || kickoffLink || kickoffBackdrop) {
    dismissKickoffModal();
    return;
  }

  if (navDropdownLink) {
    navDropdownLink.closest("details")?.removeAttribute("open");
  }

  if (reactionButton) {
    handleMessageReaction(reactionButton.dataset.messageReaction, reactionButton.dataset.emoji);
    return;
  }

  if (replyToggle) {
    replyingToMessageId = replyingToMessageId === replyToggle.dataset.replyToggle
      ? null
      : replyToggle.dataset.replyToggle;
    render();
    return;
  }

  if (logoutButton) {
    handleAdminLogout();
    return;
  }

  if (deleteTeamButton) {
    handleAdminDeleteTeam(deleteTeamButton.dataset.adminDeleteTeam);
    return;
  }

  if (deleteMemberButton) {
    handleAdminDeleteMember(deleteMemberButton.dataset.teamId, deleteMemberButton.dataset.adminDeleteMember);
    return;
  }

  if (!toggle) return;

  expandedTeamId = expandedTeamId === toggle.dataset.teamToggle ? null : toggle.dataset.teamToggle;
  render();
}

function handleKeydown(event) {
  if (handleMentionKeydown(event)) {
    return;
  }

  if (event.key === "Escape" && document.querySelector("[data-kickoff-modal]")) {
    dismissKickoffModal();
  }

  if (event.key === "Escape") {
    document.querySelectorAll(".nav-dropdown[open]").forEach((dropdown) => {
      dropdown.removeAttribute("open");
    });
  }
}

function updateMentionPicker(input) {
  const mention = getActiveMention(input);

  if (!mention) {
    hideMentionPicker(input);
    return;
  }

  const matches = getMentionMatches(mention.query);

  if (!matches.length) {
    hideMentionPicker(input);
    return;
  }

  activeMention = {
    ...mention,
    input,
    matches,
    selectedIndex: Math.min(activeMention?.selectedIndex || 0, matches.length - 1)
  };

  renderMentionPicker();
}

function getActiveMention(input) {
  const cursor = input.selectionStart;
  const beforeCursor = input.value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");

  if (atIndex < 0) return null;

  const prefix = atIndex > 0 ? beforeCursor[atIndex - 1] : "";

  if (prefix && /[\w@]/.test(prefix)) return null;

  const query = beforeCursor.slice(atIndex + 1);

  if (query.includes("\n") || query.length > 80 || /[,!?:;()[\]{}]/.test(query)) {
    return null;
  }

  return {
    start: atIndex,
    end: cursor,
    query
  };
}

function getMentionMatches(query) {
  const cleanQuery = nameKey(query);

  if (!mentionablePeople.length) return [];

  if (!cleanQuery) {
    return mentionablePeople.slice(0, MENTION_SUGGESTION_LIMIT);
  }

  return mentionablePeople
    .filter((person) => {
      const personKey = nameKey(person.fullName);
      return personKey.includes(cleanQuery)
        || cleanQuery.split(" ").every((part) => personKey.split(" ").some((namePart) => namePart.startsWith(part)));
    })
    .slice(0, MENTION_SUGGESTION_LIMIT);
}

function renderMentionPicker() {
  const field = activeMention?.input?.closest(".mention-field");
  const picker = field?.querySelector("[data-mention-picker]");

  if (!picker || !activeMention?.matches?.length) return;

  picker.hidden = false;
  picker.innerHTML = activeMention.matches
    .map((person, index) => `
      <button
        class="mention-option ${index === activeMention.selectedIndex ? "active" : ""}"
        type="button"
        role="option"
        aria-selected="${index === activeMention.selectedIndex ? "true" : "false"}"
        data-mention-option="${index}">
        <span>@${escapeHtml(person.fullName)}</span>
      </button>
    `)
    .join("");

  activeMention.input.setAttribute("aria-expanded", "true");
}

function hideMentionPicker(input = activeMention?.input) {
  const field = input?.closest?.(".mention-field");
  const picker = field?.querySelector("[data-mention-picker]");

  if (picker) {
    picker.hidden = true;
    picker.innerHTML = "";
  }

  input?.setAttribute?.("aria-expanded", "false");

  if (!input || activeMention?.input === input) {
    activeMention = null;
  }
}

function handleMentionKeydown(event) {
  if (!event.target.matches("[data-mention-input]")) return false;

  if (!activeMention || activeMention.input !== event.target) {
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete") {
      window.setTimeout(() => updateMentionPicker(event.target), 0);
    }
    return false;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeMention.selectedIndex = (activeMention.selectedIndex + 1) % activeMention.matches.length;
    renderMentionPicker();
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    activeMention.selectedIndex = (activeMention.selectedIndex - 1 + activeMention.matches.length) % activeMention.matches.length;
    renderMentionPicker();
    return true;
  }

  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    selectMentionOption(activeMention.selectedIndex);
    return true;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    hideMentionPicker(event.target);
    return true;
  }

  window.setTimeout(() => updateMentionPicker(event.target), 0);
  return false;
}

function selectMentionOption(index) {
  if (!activeMention?.matches?.length) return;

  const person = activeMention.matches[index] || activeMention.matches[0];
  const input = activeMention.input;
  const before = input.value.slice(0, activeMention.start);
  const after = input.value.slice(activeMention.end);
  const insertion = `@${person.fullName} `;

  input.value = `${before}${insertion}${after}`;
  const cursor = before.length + insertion.length;
  input.setSelectionRange(cursor, cursor);
  input.focus();
  hideMentionPicker(input);
}

async function handleMessageReaction(messageId, emoji) {
  try {
    await postJson(`/api/messages/${encodeURIComponent(messageId)}/reactions`, { emoji });
    showToast("Reaction added.");
    render();
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  }
}

async function handleAdminLogout() {
  try {
    adminSession = await postJson("/api/admin/logout", {});
    showToast("Logged out.");
    render();
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  }
}

async function handleAdminDeleteTeam(teamId) {
  const team = state.teams.find((entry) => entry.id === teamId);

  if (!team || !window.confirm(`Delete ${team.name}? This removes the team, its members, and mileage entries for that team.`)) {
    return;
  }

  try {
    await requestJson(`/api/admin/teams/${encodeURIComponent(teamId)}`, { method: "DELETE" });
    await refreshState();
    showToast("Team deleted.");
    render();
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  }
}

async function handleAdminDeleteMember(teamId, memberId) {
  const team = state.teams.find((entry) => entry.id === teamId);
  const member = team?.members.find((entry) => entry.id === memberId);

  if (!team || !member || !window.confirm(`Remove ${member.fullName} from ${team.name}? This also removes that member's distance entries.`)) {
    return;
  }

  try {
    await requestJson(`/api/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
    await refreshState();
    showToast("Member removed.");
    render();
  } catch (error) {
    showToast(error.message || "Something went wrong.", "error");
  }
}

function handleChange(event) {
  if (event.target.matches("[data-distance-team]")) {
    selectedDistanceTeamId = event.target.value;
    selectedDistanceMemberId = "";
    render();
  }

  if (event.target.matches("[data-distance-member]")) {
    selectedDistanceMemberId = event.target.value;
  }

  if (event.target.matches("[data-distance-mode]")) {
    selectedDistanceMode = event.target.value;
    render();
  }

  if (event.target.matches("[data-distance-week]")) {
    selectedDistanceWeek = Number(event.target.value);
    render();
  }

  if (event.target.matches("[data-individual-log-view]")) {
    selectedIndividualLogView = event.target.value === "date" ? "date" : "total";
    selectedIndividualLogDate = selectedIndividualLogDate || getDefaultIndividualLogDate();
    render();
  }

  if (event.target.matches("[data-individual-log-date]")) {
    selectedIndividualLogDate = event.target.value || getDefaultIndividualLogDate();
    render();
  }
}

async function requestJson(url, options = {}) {
  const method = options.method || "POST";
  const body = options.body;
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    const error = new Error(payload?.error || payload?.errorMessage || "Please check the form and try again.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  if (payload?.teams) {
    state = payload;
    state.distanceEntries = state.distanceEntries || [];
    state.messages = state.messages || [];
    if (mentionablePeopleUsesStateFallback) {
      mentionablePeople = normalizeMentionablePeople([
        ...mentionablePeople,
        ...getStateMentionablePeople()
      ]);
    }
  }
  return payload;
}

async function postJson(url, body) {
  return requestJson(url, { method: "POST", body });
}

async function readJsonResponse(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
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

function getDefaultChallengeWeek() {
  const today = new Date();
  const week = getChallengeWeeks().find((entry) => {
    const start = new Date(`${entry.startDate}T00:00:00`);
    const end = new Date(`${entry.endDate}T23:59:59`);
    return today >= start && today <= end;
  });

  return week?.weekNumber || 1;
}

function getWeekNumberForDate(value) {
  if (!value) return null;

  const date = new Date(`${value}T12:00:00`);
  const week = getChallengeWeeks().find((entry) => {
    const start = new Date(`${entry.startDate}T00:00:00`);
    const end = new Date(`${entry.endDate}T23:59:59`);
    return date >= start && date <= end;
  });

  return week?.weekNumber || null;
}

function getTeamWeeklyRows() {
  const rows = new Map();

  for (const team of state.teams) {
    rows.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      memberCount: team.members.length,
      weekTotals: {},
      totalMiles: 0
    });
  }

  for (const entry of state.distanceEntries || []) {
    const teamId = entry.teamId || "unassigned";
    const weekNumber = Number(entry.weekNumber);
    const miles = Number(entry.totalMiles) || 0;

    if (!weekNumber || miles <= 0) continue;

    if (!rows.has(teamId)) {
      rows.set(teamId, {
        teamId,
        teamName: entry.teamName || "Unassigned",
        memberCount: 0,
        weekTotals: {},
        totalMiles: 0
      });
    }

    addWeeklyMiles(rows.get(teamId), weekNumber, miles);
  }

  return [...rows.values()].sort((a, b) => b.totalMiles - a.totalMiles || a.teamName.localeCompare(b.teamName));
}

function addWeeklyMiles(row, weekNumber, miles) {
  row.weekTotals[weekNumber] = roundMiles((row.weekTotals[weekNumber] || 0) + miles);
  row.totalMiles = roundMiles(row.totalMiles + miles);
}

function getTopMembers() {
  const members = new Map();

  for (const entry of state.distanceEntries || []) {
    addMemberMiles(members, entry.memberName, Number(entry.totalMiles) || 0);
  }

  return [...members.values()]
    .sort((a, b) => b.miles - a.miles || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((member, index) => ({
      rank: index + 1,
      name: member.name,
      miles: roundMiles(member.miles)
    }));
}

function getIndividualMileageRows(options = {}) {
  const selectedDate = cleanString(options.date);
  const rows = new Map();

  for (const team of state.teams) {
    for (const member of team.members) {
      rows.set(member.id, {
        id: member.id,
        name: member.fullName,
        teamName: team.name,
        miles: 0
      });
    }
  }

  for (const entry of state.distanceEntries || []) {
    const miles = selectedDate
      ? getEntryMilesForDate(entry, selectedDate)
      : Number(entry.totalMiles) || 0;
    const memberId = cleanString(entry.memberId);
    const memberName = cleanString(entry.memberName);
    const key = rows.has(memberId)
      ? memberId
      : memberId || `legacy:${nameKey(memberName)}`;

    if (!key || !memberName || miles <= 0) continue;

    const existing = rows.get(key) || {
      id: key,
      name: memberName,
      teamName: cleanString(entry.teamName) || "Unassigned",
      miles: 0
    };

    existing.miles = roundMiles(existing.miles + miles);
    rows.set(key, existing);
  }

  return [...rows.values()].sort((a, b) =>
    a.name.localeCompare(b.name) ||
    a.teamName.localeCompare(b.teamName)
  );
}

function getEntryMilesForDate(entry, selectedDate) {
  if (entry.entryMode !== "daily") {
    return 0;
  }

  return roundMiles((entry.dailyMiles || []).reduce((total, day) => {
    return cleanString(day.isoDate) === selectedDate
      ? total + (Number(day.miles) || 0)
      : total;
  }, 0));
}

function addMemberMiles(map, name, miles) {
  const cleanName = cleanString(name);
  if (!cleanName || miles <= 0) return;

  const key = cleanName.toLocaleLowerCase();
  const existing = map.get(key) || { name: cleanName, miles: 0 };
  existing.miles = roundMiles(existing.miles + miles);
  map.set(key, existing);
}

function getLatestUpdateLabel() {
  const dates = [
    ...(state.distanceEntries || []).map((entry) => entry.createdAt)
  ].filter(Boolean);

  if (!dates.length) {
    return "No entries yet";
  }

  const latest = new Date(dates.sort().at(-1));
  return latest.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getAxisMax(value) {
  const max = Math.max(value, 10);
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

function getAxisTicks(axisMax) {
  const step = axisMax / 6;
  return Array.from({ length: 7 }, (_, index) => Math.round(step * index));
}

function getWeekColor(weekNumber) {
  return weekColors[(weekNumber - 1) % weekColors.length];
}

function assertMiles(value, label) {
  const cleanValue = String(value ?? "").trim();

  if (!/^\d+(\.\d{1,2})?$/.test(cleanValue)) {
    throw new Error(`Please enter ${label} with no more than two decimal places.`);
  }
}

function splitEntryNames(value) {
  return [...new Set(
    String(value ?? "")
      .split(/\n|,/)
      .map(cleanString)
      .filter(Boolean)
      .map((name) => name.toLocaleLowerCase())
  )];
}

function showToast(message, type = "success") {
  if (!toast) return;

  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show", "error");
  }, 4800);
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2
  });
}

function formatMilesInput(value) {
  return String(roundMiles(value));
}

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatMessageText(value) {
  return escapeHtml(value || "")
    .replace(/(^|[^\w@])(@[A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+)+)/g, '$1<span class="message-mention">$2</span>')
    .replace(/\n/g, "<br>");
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function roundMiles(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function cleanString(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function nameKey(value) {
  return cleanString(value).toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
