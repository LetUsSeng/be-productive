import {
  DAY_NAMES,
  activeSchedules,
  blockEndsAt,
  describeDays,
  describeWindow,
  isBlocking,
  nextBlockStart,
  normalizeSite,
  parseTime,
  validateSchedule,
} from "../schedule.js";
import { formatWhen } from "../format.js";
import { loadState, saveState } from "../storage.js";

// Chips are shown Monday first.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const NEW_SCHEDULE_DEFAULTS = { name: "", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };

const $ = (id) => document.getElementById(id);

let state = { sites: [], schedules: [] };
let locked = false;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/**
 * Name, day chips and start/end inputs for one schedule. Returns the element
 * and a `read()` that collects the current values.
 */
function scheduleFields(schedule, { disabled = false } = {}) {
  const name = el("input", {
    type: "text",
    className: "name",
    value: schedule.name,
    placeholder: "Name (optional), e.g. Morning focus",
  });
  name.setAttribute("aria-label", "Schedule name");

  const chips = DAY_ORDER.map((day) =>
    el("label", { className: "chip" }, [
      el("input", { type: "checkbox", value: String(day), checked: schedule.days.includes(day) }),
      el("span", { textContent: DAY_NAMES[day] }),
    ]),
  );

  const start = el("input", { type: "time", value: schedule.start, required: true });
  const end = el("input", { type: "time", value: schedule.end, required: true });
  const hint = el("span", { className: "hint" });
  const updateHint = () => {
    const s = parseTime(start.value);
    const e = parseTime(end.value);
    hint.textContent =
      s === null || e === null ? "" : s === e ? "Runs 24 hours" : e < s ? "Ends the next day" : "";
  };
  start.addEventListener("input", updateHint);
  end.addEventListener("input", updateHint);
  updateHint();

  const fieldset = el("fieldset", { className: "schedule-fields", disabled }, [
    name,
    el("div", { className: "days", role: "group", ariaLabel: "Days" }, chips),
    el("div", { className: "times" }, [
      el("label", {}, ["From", start]),
      el("label", {}, ["to", end]),
      hint,
    ]),
  ]);

  const read = () => ({
    name: name.value.trim(),
    days: chips
      .map((chip) => chip.querySelector("input"))
      .filter((box) => box.checked)
      .map((box) => Number(box.value))
      .sort(),
    start: start.value,
    end: end.value,
  });

  return { fieldset, read };
}

async function commit(newState, errorNode) {
  try {
    await saveState(newState);
    state = newState;
    errorNode.textContent = "";
    return true;
  } catch (err) {
    errorNode.textContent = err.message;
    return false;
  } finally {
    render();
  }
}

function lockTitle() {
  return locked ? "Locked while blocking is active" : "";
}

function renderSites() {
  const list = $("site-list");
  list.replaceChildren(
    ...state.sites.map((site) => {
      const remove = el("button", {
        type: "button",
        className: "icon",
        textContent: locked ? "🔒" : "✕",
        disabled: locked,
        title: lockTitle() || `Remove ${site}`,
      });
      remove.setAttribute("aria-label", `Remove ${site}`);
      remove.addEventListener("click", () =>
        commit({ ...state, sites: state.sites.filter((s) => s !== site) }, $("site-error")),
      );
      return el("li", {}, [el("span", { textContent: site }), remove]);
    }),
  );
  $("site-empty").hidden = state.sites.length > 0;
}

function renderSchedules() {
  const now = new Date();
  const activeIds = new Set(activeSchedules(state.schedules, now).map((s) => s.id));
  const sorted = [...state.schedules].sort((a, b) => a.start.localeCompare(b.start));

  $("schedule-list").replaceChildren(
    ...sorted.map((schedule) => {
      const { fieldset, read } = scheduleFields(schedule, { disabled: locked });
      const error = el("p", { className: "error", role: "alert" });

      // Edits stay local until Save, so typing isn't interrupted by re-renders.
      const save = el("button", { type: "button", className: "primary", textContent: "Save" });
      const cancel = el("button", { type: "button", textContent: "Cancel" });
      const editActions = el("div", { className: "row", hidden: true }, [save, cancel]);
      const markDirty = () => (editActions.hidden = false);
      fieldset.addEventListener("input", markDirty);
      fieldset.addEventListener("change", markDirty);
      cancel.addEventListener("click", render);
      save.addEventListener("click", () => {
        const updated = { ...schedule, ...read() };
        const problems = validateSchedule(updated);
        if (problems.length) {
          error.textContent = problems.join(" ");
          return;
        }
        commit({ ...state, schedules: state.schedules.map((s) => (s.id === schedule.id ? updated : s)) }, error);
      });

      const remove = el("button", {
        type: "button",
        className: "icon",
        textContent: locked ? "🔒" : "Delete",
        disabled: locked,
        title: lockTitle(),
      });
      remove.addEventListener("click", () =>
        commit({ ...state, schedules: state.schedules.filter((s) => s.id !== schedule.id) }, error),
      );

      const summary = `${describeDays(schedule.days)} · ${describeWindow(schedule)}`;
      const head = el("div", { className: "card-head" }, [
        el("strong", { textContent: summary }),
        el("div", { className: "row" }, [
          ...(activeIds.has(schedule.id) ? [el("span", { className: "active-tag", textContent: "Active now" })] : []),
          remove,
        ]),
      ]);

      const card = el("li", { className: "card" }, [head, fieldset, editActions, error]);
      card.classList.toggle("active", activeIds.has(schedule.id));
      return card;
    }),
  );
  $("schedule-empty").hidden = state.schedules.length > 0;
}

function renderStatus() {
  const now = new Date();
  const blocking = isBlocking(state.schedules, now);
  document.querySelector("#status .dot").classList.toggle("on", blocking);

  if (blocking) {
    const until = formatWhen(blockEndsAt(state.schedules, now), now);
    $("status-text").textContent = state.sites.length
      ? `Blocking until ${until}`
      : `A schedule is active until ${until}, but no sites are listed`;
    $("lock-text").textContent = `Locked until ${until}.`;
  } else {
    const next = nextBlockStart(state.schedules, now);
    $("status-text").textContent = next ? `Not blocking · next block ${formatWhen(next, now)}` : "Not blocking · no schedules";
  }
  $("lock-banner").hidden = !blocking;
}

function render() {
  locked = isBlocking(state.schedules, new Date());
  renderStatus();
  renderSites();
  renderSchedules();
}

function setUpSiteForm() {
  $("site-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("site-input");
    const site = normalizeSite(input.value);
    if (!site) {
      $("site-error").textContent = "That doesn't look like a site. Try something like reddit.com.";
      return;
    }
    if (state.sites.includes(site)) {
      $("site-error").textContent = `${site} is already on the list.`;
      return;
    }
    if (await commit({ ...state, sites: [...state.sites, site].sort() }, $("site-error"))) {
      input.value = "";
    }
  });
}

function setUpNewScheduleForm() {
  const form = $("new-schedule");
  const error = form.querySelector(".error");
  let fields;
  const reset = () => {
    fields = scheduleFields(NEW_SCHEDULE_DEFAULTS);
    form.querySelector(".schedule-fields").replaceWith(fields.fieldset);
  };
  reset();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const schedule = { id: crypto.randomUUID(), ...fields.read() };
    const problems = validateSchedule(schedule);
    if (problems.length) {
      error.textContent = problems.join(" ");
      return;
    }
    if (await commit({ ...state, schedules: [...state.schedules, schedule] }, error)) reset();
  });
}

async function checkIncognito() {
  const allowed = await chrome.extension.isAllowedIncognitoAccess();
  $("incognito-banner").hidden = allowed;
}

async function init() {
  state = await loadState();
  setUpSiteForm();
  setUpNewScheduleForm();
  render();
  checkIncognito();

  $("open-extensions").addEventListener("click", () =>
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }),
  );

  // Changes from the popup or another settings tab. Our own saves already
  // updated `state`, so skip those to avoid clobbering focus mid-edit.
  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== "local") return;
    const fresh = await loadState();
    if (JSON.stringify(fresh) === JSON.stringify(state)) return;
    state = fresh;
    render();
  });

  // Windows start and end without any storage change, so poll for the lock
  // flipping and keep the status line current.
  setInterval(() => {
    if (isBlocking(state.schedules, new Date()) !== locked) render();
    else renderStatus();
  }, 10_000);

  // "Allow in Private" is toggled on another page; recheck when we come back.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkIncognito();
  });
}

init();
