import { activeWindows, blockEndsAt, describeWindow, isBlocking, normalizeSite } from "../schedule.js";
import { formatDuration, formatWhen } from "../format.js";
import { loadState } from "../storage.js";

const $ = (id) => document.getElementById(id);

// Anyone can link to this page, so only trust `site` if it's a clean domain.
const site = normalizeSite(new URLSearchParams(location.search).get("site") ?? "");

async function render() {
  const { sites, schedules } = await loadState();
  const now = new Date();
  const blocked = site && sites.includes(site) && isBlocking(schedules, now);

  if (!blocked) {
    $("eyebrow").textContent = "Break time";
    $("headline").textContent = site ? `${site} isn't blocked right now` : "Nothing is blocked right now";
    $("windows").replaceChildren();
    $("until").textContent = "";
    if (site) {
      $("visit").href = `https://${site}`;
      $("visit").textContent = `Go to ${site}`;
      $("visit").hidden = false;
    }
    return;
  }

  $("eyebrow").textContent = "Focus time";
  $("headline").textContent = `${site} is blocked`;
  $("visit").hidden = true;
  $("windows").replaceChildren(
    ...activeWindows(schedules, now).map(({ schedule }) => {
      const li = document.createElement("li");
      li.textContent = [schedule.name, describeWindow(schedule)].filter(Boolean).join(" · ");
      return li;
    }),
  );

  const end = blockEndsAt(schedules, now);
  const until = $("until");
  until.replaceChildren(
    "Unblocks at ",
    Object.assign(document.createElement("strong"), { textContent: formatWhen(end, now) }),
    ` — in ${formatDuration(end - now)}`,
  );
}

$("close-tab").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
});

document.title = site ? `${site} blocked — Be Productive` : "Be Productive";
render();
setInterval(render, 15_000);
chrome.storage.onChanged.addListener(render);
