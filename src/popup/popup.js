import { activeSchedules, blockEndsAt, isBlocking, matchSite, nextBlockStart, normalizeSite } from "../schedule.js";
import { formatDuration, formatWhen } from "../format.js";
import { addSite, loadState } from "../storage.js";

const $ = (id) => document.getElementById(id);

function renderStatus({ sites, schedules }) {
  const now = new Date();
  const blocking = isBlocking(schedules, now) && sites.length > 0;
  $("dot").classList.toggle("on", blocking);

  if (blocking) {
    const end = blockEndsAt(schedules, now);
    const names = activeSchedules(schedules, now).map((s) => s.name).filter(Boolean);
    $("status-title").textContent = `Blocking until ${formatWhen(end, now)}`;
    $("status-detail").textContent = [names.join(", "), `${formatDuration(end - now)} left`]
      .filter(Boolean)
      .join(" · ");
    return;
  }

  $("status-title").textContent = "Not blocking";
  const next = nextBlockStart(schedules, now);
  $("status-detail").textContent = !schedules.length
    ? "Add a schedule in Settings."
    : !sites.length
      ? "Add sites to block in Settings."
      : `Next block ${formatWhen(next, now)}`;
}

async function renderCurrentSite(state) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const button = $("block-current");
  const note = $("current-note");
  button.hidden = true;
  note.hidden = true;

  let url;
  try {
    url = new URL(tab?.url ?? "");
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const listed = matchSite(url.href, state.sites);
  if (listed) {
    note.textContent = `${listed} is on your block list.`;
    note.hidden = false;
    return;
  }

  const site = normalizeSite(url.hostname);
  if (!site) return;
  button.textContent = `Block ${site}`;
  button.hidden = false;
  button.onclick = async () => {
    try {
      await addSite(site);
      render();
    } catch (err) {
      $("error").textContent = err.message;
    }
  };
}

async function render() {
  const state = await loadState();
  renderStatus(state);
  await renderCurrentSite(state);
}

$("open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

chrome.extension.isAllowedIncognitoAccess().then((allowed) => {
  $("incognito-warning").hidden = allowed;
});

render();
