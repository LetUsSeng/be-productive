import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockEndsAt,
  describeDays,
  describeWindow,
  hostMatches,
  isBlocking,
  isLoosening,
  isScheduleActive,
  matchSite,
  nextBlockStart,
  nextTransition,
  normalizeSite,
  validateSchedule,
} from "../src/schedule.js";

// Week of 2026-09-20: Sun 20, Mon 21, ..., Fri 25, Sat 26, Sun 27.
const at = (day, h, m = 0) => new Date(2026, 8, day, h, m);
const SUN = 0, MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6;
const WEEKDAYS = [MON, TUE, WED, THU, FRI];
const sched = (days, start, end, id = `${days}-${start}-${end}`) => ({ id, name: "", days, start, end });

test("fixture dates fall on the expected weekdays", () => {
  assert.equal(at(20, 0).getDay(), SUN);
  assert.equal(at(25, 0).getDay(), FRI);
  assert.equal(at(26, 0).getDay(), SAT);
});

test("normalizeSite strips scheme, www, path, port and case", () => {
  assert.equal(normalizeSite("reddit.com"), "reddit.com");
  assert.equal(normalizeSite("  https://www.Reddit.com/r/funny?x=1 "), "reddit.com");
  assert.equal(normalizeSite("http://m.youtube.com:8080/watch"), "m.youtube.com");
  assert.equal(normalizeSite("WWW.X.COM"), "x.com");
  assert.equal(normalizeSite("news.ycombinator.com."), "news.ycombinator.com");
});

test("normalizeSite rejects junk", () => {
  for (const bad of ["", "   ", "localhost", "not a site", "http://", "192.168.1.1", "foo.c", null, 42]) {
    assert.equal(normalizeSite(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("hostMatches covers subdomains but not lookalikes", () => {
  assert.ok(hostMatches("youtube.com", "youtube.com"));
  assert.ok(hostMatches("www.youtube.com", "youtube.com"));
  assert.ok(hostMatches("M.YouTube.com", "youtube.com"));
  assert.ok(!hostMatches("notyoutube.com", "youtube.com"));
  assert.ok(!hostMatches("youtube.com.evil.io", "youtube.com"));
});

test("matchSite only matches http(s) URLs", () => {
  const sites = ["reddit.com", "youtube.com"];
  assert.equal(matchSite("https://old.reddit.com/r/x", sites), "reddit.com");
  assert.equal(matchSite("https://example.com", sites), null);
  assert.equal(matchSite("chrome-extension://abc/src/blocked/blocked.html?site=reddit.com", sites), null);
  assert.equal(matchSite("not a url", sites), null);
});

test("same-day window: start inclusive, end exclusive, right days only", () => {
  const s = sched(WEEKDAYS, "09:00", "12:00");
  assert.ok(!isScheduleActive(s, at(21, 8, 59)));
  assert.ok(isScheduleActive(s, at(21, 9, 0)));
  assert.ok(isScheduleActive(s, at(21, 11, 59)));
  assert.ok(!isScheduleActive(s, at(21, 12, 0)));
  assert.ok(!isScheduleActive(s, at(26, 10, 0)), "Saturday is not selected");
});

test("overnight window belongs to the day it starts", () => {
  const s = sched([FRI], "22:00", "02:00");
  assert.ok(!isScheduleActive(s, at(25, 21, 59)));
  assert.ok(isScheduleActive(s, at(25, 22, 0)));
  assert.ok(isScheduleActive(s, at(26, 1, 0)), "Sat 01:00 is inside Fri's window");
  assert.ok(!isScheduleActive(s, at(26, 2, 0)));
  assert.ok(!isScheduleActive(s, at(26, 22, 30)), "Sat is not selected");
  assert.ok(!isScheduleActive(s, at(25, 1, 0)), "Thu is not selected, so Fri 01:00 is free");
});

test("start === end means a 24h window from start", () => {
  const s = sched([MON], "06:00", "06:00");
  assert.ok(!isScheduleActive(s, at(21, 5, 59)));
  assert.ok(isScheduleActive(s, at(21, 6, 0)));
  assert.ok(isScheduleActive(s, at(22, 5, 59)));
  assert.ok(!isScheduleActive(s, at(22, 6, 0)));
});

test("isBlocking is true when any schedule is active", () => {
  const schedules = [sched(WEEKDAYS, "09:00", "12:00"), sched(WEEKDAYS, "13:00", "17:00")];
  assert.ok(isBlocking(schedules, at(21, 10)));
  assert.ok(!isBlocking(schedules, at(21, 12, 30)));
  assert.ok(isBlocking(schedules, at(21, 16)));
  assert.ok(!isBlocking([], at(21, 10)));
});

test("blockEndsAt follows chained and overlapping windows", () => {
  const chained = [sched(WEEKDAYS, "09:00", "12:00"), sched(WEEKDAYS, "12:00", "13:00")];
  assert.deepEqual(blockEndsAt(chained, at(21, 10)), at(21, 13));

  const overlapping = [sched(WEEKDAYS, "09:00", "12:00"), sched(WEEKDAYS, "11:00", "14:30")];
  assert.deepEqual(blockEndsAt(overlapping, at(21, 9, 30)), at(21, 14, 30));

  const gap = [sched(WEEKDAYS, "09:00", "12:00"), sched(WEEKDAYS, "13:00", "17:00")];
  assert.deepEqual(blockEndsAt(gap, at(21, 10)), at(21, 12));
  assert.equal(blockEndsAt(gap, at(21, 12, 30)), null);
});

test("nextTransition finds the next boundary, across midnight and the week", () => {
  const schedules = [sched(WEEKDAYS, "09:00", "12:00")];
  assert.deepEqual(nextTransition(schedules, at(21, 8)), at(21, 9));
  assert.deepEqual(nextTransition(schedules, at(21, 10)), at(21, 12));
  assert.deepEqual(nextTransition(schedules, at(21, 12)), at(22, 9), "boundary itself is not 'next'");
  assert.deepEqual(nextTransition(schedules, at(25, 13)), at(28, 9), "Fri afternoon → Mon morning");

  const overnight = [sched([SUN], "22:00", "02:00")];
  assert.deepEqual(nextTransition(overnight, at(20, 23)), at(21, 2));
  assert.equal(nextTransition([], at(21, 10)), null);
});

test("nextBlockStart skips the currently active window", () => {
  const schedules = [sched(WEEKDAYS, "09:00", "12:00"), sched([SAT], "10:00", "11:00")];
  assert.deepEqual(nextBlockStart(schedules, at(25, 10)), at(26, 10));
});

test("validateSchedule", () => {
  assert.deepEqual(validateSchedule(sched([MON], "09:00", "17:00")), []);
  assert.equal(validateSchedule(sched([], "09:00", "17:00")).length, 1);
  assert.equal(validateSchedule(sched([7], "09:00", "17:00")).length, 1);
  assert.equal(validateSchedule(sched([MON], "9:00", "24:00")).length, 2);
});

test("isLoosening: removals and schedule edits loosen, additions don't", () => {
  const base = { sites: ["a.com", "b.com"], schedules: [sched(WEEKDAYS, "09:00", "12:00", "s1")] };
  const withSchedule = (s) => ({ ...base, schedules: [s] });

  assert.ok(!isLoosening(base, base));
  assert.ok(!isLoosening(base, { ...base, sites: ["a.com", "b.com", "c.com"] }));
  assert.ok(!isLoosening(base, { ...base, schedules: [...base.schedules, sched([SAT], "10:00", "11:00", "s2")] }));
  assert.ok(!isLoosening(base, withSchedule({ ...base.schedules[0], name: "Renamed" })));
  assert.ok(!isLoosening(base, withSchedule({ ...base.schedules[0], days: [FRI, THU, WED, TUE, MON] })), "day order is irrelevant");

  assert.ok(isLoosening(base, { ...base, sites: ["a.com"] }));
  assert.ok(isLoosening(base, { ...base, schedules: [] }));
  assert.ok(isLoosening(base, withSchedule({ ...base.schedules[0], end: "11:00" })));
  assert.ok(isLoosening(base, withSchedule({ ...base.schedules[0], days: [MON] })));
});

test("describe helpers", () => {
  assert.equal(describeWindow(sched([MON], "09:00", "12:00")), "09:00–12:00");
  assert.equal(describeWindow(sched([MON], "22:00", "02:00")), "22:00–02:00 (overnight)");
  assert.equal(describeWindow(sched([MON], "06:00", "06:00")), "all day from 06:00");
  assert.equal(describeDays(WEEKDAYS), "Weekdays");
  assert.equal(describeDays([SAT, SUN]), "Weekends");
  assert.equal(describeDays([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.equal(describeDays([SUN, MON, WED]), "Mon Wed Sun");
});
