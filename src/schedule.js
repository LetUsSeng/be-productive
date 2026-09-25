// Pure scheduling / matching / lock logic. No chrome.* APIs here so it can be
// unit-tested with `node --test`.

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const MINUTES_PER_DAY = 24 * 60;

// How far around "now" concrete windows are generated. A weekly schedule
// repeats every 7 days, so 14 days ahead comfortably covers "next" lookups and
// chained windows.
const LOOKBEHIND_DAYS = 1;
const LOOKAHEAD_DAYS = 14;

/**
 * Turn user input ("https://www.Reddit.com/r/foo", "youtube.com:443") into a
 * bare lowercase domain ("reddit.com"). Returns null if it isn't a valid host.
 */
export function normalizeSite(input) {
  if (typeof input !== "string") return null;
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = "https://" + text;

  let host;
  try {
    host = new URL(text).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  return HOST_RE.test(host) ? host : null;
}

/** True if `hostname` is `site` or any subdomain of it. */
export function hostMatches(hostname, site) {
  const host = String(hostname).toLowerCase().replace(/\.$/, "");
  return host === site || host.endsWith("." + site);
}

/** The first blocked site matching `url`, or null. Only http(s) URLs match. */
export function matchSite(url, sites) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return sites.find((site) => hostMatches(parsed.hostname, site)) ?? null;
}

export function parseTime(hhmm) {
  const m = TIME_RE.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes a schedule's window lasts: overnight wraps, start === end is 24h. */
export function durationMinutes(schedule) {
  const start = parseTime(schedule.start);
  const end = parseTime(schedule.end);
  const diff = end - start;
  return diff > 0 ? diff : diff + MINUTES_PER_DAY;
}

/** Returns a list of problems; empty means the schedule is valid. */
export function validateSchedule(schedule) {
  const errors = [];
  const days = schedule?.days;
  if (!Array.isArray(days) || days.length === 0) {
    errors.push("Pick at least one day.");
  } else if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    errors.push("Days must be 0 (Sun) through 6 (Sat).");
  }
  if (parseTime(schedule?.start) === null) errors.push("Start time must be HH:MM.");
  if (parseTime(schedule?.end) === null) errors.push("End time must be HH:MM.");
  return errors;
}

/**
 * Concrete [start, end) windows for one schedule around `now`. The selected
 * days are the days a window *starts* on, so "Fri 22:00–02:00" runs
 * Fri 22:00 → Sat 02:00. Built with local Date so DST follows wall-clock time.
 */
export function windowsFor(schedule, now) {
  const start = parseTime(schedule.start);
  const duration = durationMinutes(schedule);
  const windows = [];
  for (let offset = -LOOKBEHIND_DAYS; offset <= LOOKAHEAD_DAYS; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!schedule.days.includes(day.getDay())) continue;
    const y = day.getFullYear();
    const mo = day.getMonth();
    const d = day.getDate();
    windows.push({
      start: new Date(y, mo, d, 0, start),
      end: new Date(y, mo, d, 0, start + duration),
      schedule,
    });
  }
  return windows;
}

function allWindows(schedules, now) {
  return schedules.flatMap((s) => windowsFor(s, now));
}

function contains(window, now) {
  return window.start <= now && now < window.end;
}

export function isScheduleActive(schedule, now) {
  return windowsFor(schedule, now).some((w) => contains(w, now));
}

/** Windows active right now (one per active schedule). */
export function activeWindows(schedules, now) {
  return allWindows(schedules, now).filter((w) => contains(w, now));
}

export function activeSchedules(schedules, now) {
  return [...new Set(activeWindows(schedules, now).map((w) => w.schedule))];
}

export function isBlocking(schedules, now) {
  return schedules.some((s) => isScheduleActive(s, now));
}

/**
 * When blocking will actually stop: the end of the union of active windows,
 * following overlapping or back-to-back windows (09–12 + 12–13 → 13:00).
 * Null when not blocking.
 */
export function blockEndsAt(schedules, now) {
  const windows = allWindows(schedules, now);
  const active = windows.filter((w) => contains(w, now));
  if (active.length === 0) return null;

  let end = new Date(Math.max(...active.map((w) => w.end)));
  let extended = true;
  while (extended) {
    extended = false;
    for (const w of windows) {
      if (w.start <= end && w.end > end) {
        end = w.end;
        extended = true;
      }
    }
  }
  return end;
}

/** Start of the next window after `now`, or null if there are no schedules. */
export function nextBlockStart(schedules, now) {
  const starts = allWindows(schedules, now)
    .map((w) => w.start)
    .filter((t) => t > now);
  return starts.length ? new Date(Math.min(...starts)) : null;
}

/** The next moment any window starts or ends, or null. */
export function nextTransition(schedules, now) {
  const times = allWindows(schedules, now)
    .flatMap((w) => [w.start, w.end])
    .filter((t) => t > now);
  return times.length ? new Date(Math.min(...times)) : null;
}

function sameTiming(a, b) {
  const daysKey = (s) => [...new Set(s.days)].sort().join();
  return a.start === b.start && a.end === b.end && daysKey(a) === daysKey(b);
}

/**
 * True if going from `oldState` to `newState` could reduce blocking: a site
 * was removed, or a schedule was removed or had its days/times changed.
 * Adding sites or schedules (and renaming) is always allowed.
 */
export function isLoosening(oldState, newState) {
  const newSites = new Set(newState.sites);
  if (oldState.sites.some((site) => !newSites.has(site))) return true;

  const newById = new Map(newState.schedules.map((s) => [s.id, s]));
  return oldState.schedules.some((old) => {
    const updated = newById.get(old.id);
    return !updated || !sameTiming(old, updated);
  });
}

/** "09:00–12:00" style label, with a hint for overnight / all-day windows. */
export function describeWindow(schedule) {
  const start = parseTime(schedule.start);
  const end = parseTime(schedule.end);
  if (start === end) return `all day from ${schedule.start}`;
  const range = `${schedule.start}–${schedule.end}`;
  return end < start ? `${range} (overnight)` : range;
}

export function describeDays(days) {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "Every day";
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.join() === "0,6") return "Weekends";
  // List Monday first, which reads more naturally than Sunday first.
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => sorted.includes(d))
    .map((d) => DAY_NAMES[d])
    .join(" ");
}
