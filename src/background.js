import { isBlocking, matchSite, nextTransition } from "./schedule.js";
import { blockedPageUrl, loadState } from "./storage.js";

const TICK_ALARM = "tick";
const TRANSITION_ALARM = "transition";

// Fire slightly after a boundary so the window is unambiguously started/ended.
const TRANSITION_SLACK_MS = 1000;

/**
 * Bring the browser in line with the stored schedule: install or clear the
 * redirect rules, push open tabs on blocked sites to the block page, and
 * schedule the next wake-up. Everything funnels through here.
 */
async function reconcileNow() {
  const { sites, schedules } = await loadState();
  const now = new Date();
  const blocking = isBlocking(schedules, now) && sites.length > 0;

  await applyRules(blocking ? sites : []);
  if (blocking) await sweepTabs(sites);
  await scheduleAlarms(schedules, now);

  await chrome.action.setBadgeText({ text: blocking ? "ON" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#c2410c" });
}

// Serialize runs: concurrent updateDynamicRules calls could collide on rule IDs.
let queue = Promise.resolve();
function reconcile() {
  queue = queue.then(reconcileNow).catch((err) => console.error("reconcile failed", err));
  return queue;
}

async function applyRules(sites) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: sites.map((site, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: `/src/blocked/blocked.html?site=${encodeURIComponent(site)}` },
      },
      // requestDomains matches the domain and all of its subdomains.
      condition: { requestDomains: [site], resourceTypes: ["main_frame"] },
    })),
  });
}

/** Redirect tabs that were already open on a blocked site when blocking began. */
async function sweepTabs(sites) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      const site = tab.url && matchSite(tab.url, sites);
      if (!site) return;
      try {
        await chrome.tabs.update(tab.id, { url: blockedPageUrl(site) });
      } catch (err) {
        // Tab may have closed mid-sweep.
        console.warn("could not redirect tab", tab.id, err);
      }
    }),
  );
}

async function scheduleAlarms(schedules, now) {
  // A once-a-minute safety net covers sleep/resume, clock changes and
  // late-firing alarms. Only create it once so it isn't constantly reset.
  if (!(await chrome.alarms.get(TICK_ALARM))) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  }

  const next = nextTransition(schedules, now);
  if (next) {
    await chrome.alarms.create(TRANSITION_ALARM, { when: next.getTime() + TRANSITION_SLACK_MS });
  } else {
    await chrome.alarms.clear(TRANSITION_ALARM);
  }
}

// Navigations that never hit the network (back/forward cache, SPA history
// changes) slip past the redirect rules, so catch them as tab URL changes.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const { sites, schedules } = await loadState();
  if (!isBlocking(schedules, new Date())) return;
  const site = matchSite(changeInfo.url, sites);
  if (site) chrome.tabs.update(tabId, { url: blockedPageUrl(site) }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);
chrome.alarms.onAlarm.addListener(reconcile);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") reconcile();
});
