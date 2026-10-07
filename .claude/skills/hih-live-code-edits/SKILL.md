---
name: hih-live-code-edits
description: Use whenever the user (HandinHand CMS) pastes or uploads the HTML/JS code of a live system page and asks for a change (dashboard, popup, table, etc.). The page must be returned in the SAME code, SAME order and SAME formatting, with only the requested area changed, so the vendor developer can diff and wire it quickly.
---

# Editing a live CMS page in place

The CMS is built by an outside company. When the user hands back an edited page, the vendor must see
**only** the lines that changed. Everything else must match their code byte for byte.

## Rules

1. **Keep the pasted code verbatim.** Save the user's code exactly as given: same order, indentation,
   blank lines, comments, odd characters, and server-rendered values. Don't pretty-print, re-indent,
   sort, rename, "fix" or remove unused code.
   - When the paste is in the transcript, extract it programmatically into the file instead of
     retyping it, so it stays byte-exact.
2. **Change only the requested area, in place.** Replace the old block where it is. Don't move code
   elsewhere or add "improvements" outside the area, even when you see bugs. Mention bugs in chat instead.
3. **Reuse what the page already has.** Use its stack: jQuery, Bootstrap 3, AdminLTE RTL, Highcharts,
   moment, select2, pnotify, sweetalert, and the same URL base (`https://cms.handinhand-eg.com/...`).
   Don't add React, CDNs or new libraries unless the user asks.
   - Keep existing function names and hooks so the call sites stay unchanged. For example, the new
     dashboard is still filled by `loadStatistics(action)` and `#refresh_dashboard`.
4. **Mark the change.** Wrap new or replaced blocks in `<!-- ... start -->` / `<!-- ... end -->` comments,
   or `// ... start` / `// ... end` in JS. Keep comments short and in English.
5. **Data from the server.** When the change needs new data, POST to a clearly named new endpoint and
   document the JSON shape in a comment.
   - A preview mock is allowed only as one clearly marked `MOCK (preview only)` function, used when the
     request fails.
6. **Keep the original next to the edit.** Save `live/<page>-live-original.html` (verbatim) and
   `live/<page>-live-<change>.html` (edited).
   - Before committing, check `diff original edited`: every hunk must be inside the marked area.
7. **Test** in headless Chromium. Route the CMS asset URLs to local npm copies (jQuery 2.1.4,
   Bootstrap 3, moment, Highcharts 4.x). Check that the changed area works and adds no new page errors.

## Highcharts in the RTL page

- Set `#container .highcharts-container { direction: ltr; }`. Without it, names and numbers are
  mirrored or overlap the bars.
- Horizontal bars, RTL: `xAxis.opposite: true` (names on the right), `yAxis.reversed: true` (bars grow
  right → left).
- Line or column over time, RTL: `xAxis.reversed: true`, `yAxis.opposite: true`, `legend.rtl: true`.
- Use `new Highcharts.Chart({ chart: { renderTo: id } })` (works on old versions). Set
  `credits.enabled: false` and `exporting.enabled: false`. Call `destroy()` before redrawing.
