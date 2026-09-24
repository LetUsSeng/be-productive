import { isBlocking, isLoosening } from "./schedule.js";

const DEFAULT_STATE = { sites: [], schedules: [] };

export async function loadState() {
  const stored = await chrome.storage.local.get(["sites", "schedules"]);
  return {
    sites: stored.sites ?? DEFAULT_STATE.sites,
    schedules: stored.schedules ?? DEFAULT_STATE.schedules,
  };
}

export class LockedError extends Error {
  constructor() {
    super("Blocking is active — you can only add sites or schedules until it ends.");
    this.name = "LockedError";
  }
}

/**
 * Persist a new state. While any schedule is active, changes that would
 * loosen blocking (removing sites, editing/deleting schedules) are refused.
 */
export async function saveState(newState, now = new Date()) {
  const oldState = await loadState();
  if (isBlocking(oldState.schedules, now) && isLoosening(oldState, newState)) {
    throw new LockedError();
  }
  await chrome.storage.local.set({ sites: newState.sites, schedules: newState.schedules });
}

/** Add a site (always allowed — it only tightens blocking). */
export async function addSite(site) {
  const state = await loadState();
  if (state.sites.includes(site)) return false;
  await saveState({ ...state, sites: [...state.sites, site].sort() });
  return true;
}

export function blockedPageUrl(site) {
  return chrome.runtime.getURL(`src/blocked/blocked.html?site=${encodeURIComponent(site)}`);
}
