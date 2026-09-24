# Be Productive

A Brave (Chromium, Manifest V3) extension that blocks distracting sites on a weekly schedule.

- One list of blocked sites; each entry also blocks its subdomains (`youtube.com` → `m.youtube.com`).
- Any number of schedules, each with its own days and time window. Sites are blocked while **any** schedule is active.
- Windows may run overnight (`22:00–02:00`); the selected days are the days the window *starts*. Equal start and end means 24 hours.
- Blocked navigations, and tabs already open when a window starts, are sent to a page showing when blocking ends.
- While blocking is active you can only tighten things (add sites or schedules); removing sites or editing/deleting schedules is locked until the window ends.

## Install

1. Open `brave://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Optional but recommended: in the extension's **Details**, turn on **Allow in Private** so blocking also applies to private windows.
4. Click the toolbar icon → **Settings** to add sites and schedules.

After changing code, click the reload icon on the extension card.

## Development

No build step — plain ES modules.

```
npm test        # unit tests for src/schedule.js (node --test)
```

| Path | Purpose |
|---|---|
| `src/schedule.js` | Pure logic: site matching, schedule windows, lock rules (unit-tested) |
| `src/storage.js` | `chrome.storage.local` access; refuses loosening saves while blocking |
| `src/background.js` | Service worker: installs/clears redirect rules, sweeps open tabs, schedules alarms |
| `src/options/`, `src/popup/`, `src/blocked/` | Settings page, toolbar popup, block page |

## Known limits

- Nothing stops you from disabling or removing the extension at `brave://extensions`.
- Times are the browser's local time.
