import { DAY_NAMES } from "./schedule.js";

const pad = (n) => String(n).padStart(2, "0");

export function clock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "12:00" today, "tomorrow 02:00", otherwise "Mon 09:00". */
export function formatWhen(date, now) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return clock(date);
  if (dayDiff === 1) return `tomorrow ${clock(date)}`;
  return `${DAY_NAMES[date.getDay()]} ${clock(date)}`;
}

/** "47 min", "2 h", "2 h 5 min". Rounds up so "0 min" never shows early. */
export function formatDuration(ms) {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
