const routes = {
  register: "Register for Walk to Wellness",
  "create-team": "Create a Team",
  "join-team": "Join a Team",
  "step-submission": "Step Submission",
  "live-feed": "Live Feed"
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
let state = null;
let expandedTeamId = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("hashchange", render);
document.addEventListener("submit", handleSubmit);
document.addEventListener("click", handleClick);

async function init() {
  renderLoading();
  await refreshState();
  render();
}

async function refreshState() {
  const response = await fetch("/api/state", { cache: "no-store" });
  state = await response.json();
}

function getRoute() {
  const hash = window.location.hash.replace("#", "");
  return routes[hash] ? hash : "register";
}

function renderLoading() {
  app.innerHTML = `<div class="loading">Loading Walk to Wellness '26</div>`;
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
  if (route === "join-team") renderJoinTeamPage();
  if (route === "step-submission") renderStepSubmissionPage();
  if (route === "live-feed") renderLiveFeedPage();
}

function updateActiveNav(route) {
  document.querySelectorAll("[data-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
}

function renderRegisterPage() {
  const teamCount = state.teams.length;
  const memberCount = state.teams.reduce((total, team) => total + team.members.length, 0);
  const totalMiles = state.totals.totalMilesByTeam.reduce((total, row) => total + row.miles, 0);
  const selectedTeam = state.teams.find((team) => team.id === expandedTeamId);

  app.innerHTML = `
    <section class="page">
      <div class="hero">
        <div class="hero-content">
          <p class="eyebrow">HR Debrief</p>
          <p class="program-brand">Bright Harbor Healthcare</p>
          <h1>Walk to Wellness '26</h1>
          <p class="hero-tagline">Step Into Better Health, One Walk at a Time.</p>
          <p>Build movement into the workday through short walks, outdoor breaks, and shared progress with your colleagues.</p>
          <div class="hero-actions">
            <a class="primary-button" href="#create-team">Register A Team</a>
            <a class="secondary-button" href="#join-team">Join a Team</a>
          </div>
        </div>
      </div>

      ${renderProgramIntro()}

      <div class="content-band">
        <div class="content-grid">
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
              ${renderStat("Miles", formatMiles(totalMiles))}
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

          <section class="form-panel" aria-labelledby="registration-title">
            <div class="section-header">
              <div>
                <h2 id="registration-title">Registration</h2>
                <p>Tell us who is stepping into the challenge.</p>
              </div>
            </div>
            <form class="form-grid" data-action="register">
              <div class="form-grid two-column">
                <label>
                  First Name
                  <input name="firstName" autocomplete="given-name" required>
                </label>
                <label>
                  Last Name
                  <input name="lastName" autocomplete="family-name" required>
                </label>
              </div>
              <label>
                Program Name
                <input name="programName" required>
              </label>
              <label>
                Office Building Site
                <input name="officeSite" required>
              </label>
              <div class="button-row">
                <button class="primary-button" type="submit">Submit Registration</button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </section>
  `;
}

function renderProgramIntro() {
  return `
    <section class="intro-band" aria-label="Walk to Wellness overview">
      <div class="intro-grid">
        <article class="intro-card lavender-card">
          <p class="eyebrow">Step Into Better Health</p>
          <h2>One walk at a time.</h2>
          <p>Walk to Wellness is a simple, inclusive challenge that encourages employees to stay active while contributing to a shared goal.</p>
        </article>
        <article class="intro-card coral-card">
          <p class="eyebrow">How it Works</p>
          <h2>Form a team, log miles, follow the leaderboard.</h2>
          <p>Teams record activity through the Step Submission page, and the Live Feed updates team mileage and the top three members.</p>
        </article>
      </div>
      <div class="recap-strip" aria-label="Walk to Wellness 2025 recap">
        <div>
          <span>Walk to Wellness '25 Recap</span>
          <strong>20,783</strong>
          <small>Miles Walked</small>
        </div>
        <div>
          <strong>113</strong>
          <small>Participants</small>
        </div>
        <div>
          <strong>7</strong>
          <small>Teams</small>
        </div>
        <div>
          <strong>5</strong>
          <small>Countries Traveled</small>
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
            <p>Existing team names appear first.</p>
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

function renderJoinTeamPage() {
  app.innerHTML = `
    <section class="page content-band">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Join a Team</h1>
            <p>${state.teams.length ? "Choose a team and add your name." : "No teams are open yet."}</p>
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
            <p>Submit activity miles for the Live Feed.</p>
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

function renderLiveFeedPage() {
  app.innerHTML = `
    <section class="page content-band">
      <div class="single-column">
        <div class="section-header">
          <div>
            <h1>Live Feed</h1>
            <p>Team totals and top member mileage.</p>
          </div>
        </div>

        <div class="chart-stack">
          <section class="panel" aria-labelledby="team-miles-title">
            <h2 id="team-miles-title">Total Miles Walked by Team</h2>
            ${renderTeamMilesChart()}
          </section>

          <section class="panel" aria-labelledby="top-members-title">
            <h2 id="top-members-title">Top Three Members</h2>
            ${renderTopMembers()}
          </section>

          <section class="panel" aria-labelledby="recent-title">
            <h2 id="recent-title">Recent Submissions</h2>
            ${renderRecentSubmissions()}
          </section>
        </div>
      </div>
    </section>
  `;
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
  return `
    <article class="team-card">
      <h3>
        <span>${escapeHtml(team.name)}</span>
        <span class="team-count">${team.members.length} ${pluralize("member", team.members.length)}</span>
      </h3>
      ${renderMembers(team.members)}
      <form data-action="join-team" data-team-id="${escapeAttribute(team.id)}">
        <label>
          Name
          <input name="fullName" autocomplete="name" required>
        </label>
        <button class="primary-button" type="submit">Join This Team</button>
      </form>
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

function renderTeamMilesChart() {
  const totals = state.totals.totalMilesByTeam;

  if (!totals.length || totals.every((row) => row.miles === 0)) {
    return `<p class="muted">No step submissions yet.</p>`;
  }

  const maxMiles = Math.max(...totals.map((row) => row.miles), 1);

  return `
    <div class="bar-chart" role="list">
      ${totals
        .map((row) => {
          const width = Math.max((row.miles / maxMiles) * 100, row.miles > 0 ? 3 : 0);

          return `
            <div class="bar-row" role="listitem">
              <div class="bar-label">${escapeHtml(row.teamName)}</div>
              <div class="bar-track" aria-hidden="true">
                <div class="bar-fill" style="width: ${width}%"></div>
              </div>
              <div class="bar-value">${formatMiles(row.miles)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTopMembers() {
  const members = state.totals.topMembers;

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
              <span class="bar-value">${formatMiles(member.miles)}</span>
            </li>`
        )
        .join("")}
    </ol>
  `;
}

function renderRecentSubmissions() {
  if (!state.activities.length) {
    return `<p class="muted">No activity submissions yet.</p>`;
  }

  return `
    <ul class="recent-feed">
      ${state.activities
        .slice(0, 8)
        .map((activity) => {
          const team = state.teams.find((entry) => entry.id === activity.teamId);
          return `
            <li>
              <strong>${escapeHtml(activity.participantName)}</strong>
              <span class="muted">submitted ${formatMiles(activity.miles)} for ${escapeHtml(activity.activityType)} on ${escapeHtml(activity.activityDate)}${team ? ` with ${escapeHtml(team.name)}` : ""}.</span>
            </li>
          `;
        })
        .join("")}
    </ul>
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
      await postJson("/api/teams", formData);
      showToast("Team created.");
    }

    if (action === "join-team") {
      await postJson(`/api/teams/${encodeURIComponent(form.dataset.teamId)}/members`, formData);
      showToast("Team member added.");
    }

    if (action === "activity") {
      await postJson("/api/activities", formData);
      showToast("Step submission saved.");
    }

    await refreshState();
    form.reset();
    render();
  } catch (error) {
    showToast(error.message || "Something went wrong.");
  }
}

function handleClick(event) {
  const toggle = event.target.closest("[data-team-toggle]");
  if (!toggle) return;

  expandedTeamId = expandedTeamId === toggle.dataset.teamToggle ? null : toggle.dataset.teamToggle;
  render();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Please check the form and try again.");
  }

  state = payload;
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function pluralize(word, count) {
  return count === 1 ? word : `${word}s`;
}

function formatMiles(value) {
  return `${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2
  })} mi`;
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
