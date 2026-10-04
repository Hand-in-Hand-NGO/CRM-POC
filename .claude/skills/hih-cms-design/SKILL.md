---
name: hih-cms-design
description: Design system of the HandinHand (Hand in Hand NGO) CMS — the Arabic RTL AdminLTE / Bootstrap 3 system at cms.handinhand-eg.com — with its font (Droid Arabic Kufi → Noto Kufi Arabic), exact color palette and dashboard style. Use this skill whenever designing, mocking up, prototyping or restyling ANY page, screen, dashboard (داش بورد / لوحة تحكم / إحصائيات / تقارير / charts / KPIs), filter bar, table, modal, report or HTML file for HandinHand / هاند إن هاند or its CMS / CRM (engineering, visits الزيارات, manufacturing التصنيع, MDM, fitting, maintenance, call center, reception, follow-ups), or when the user asks for "نفس الفونت والألوان", "نفس شكل السيستم", "نفس شكل اللايف", or any Arabic RTL admin page or dashboard — even if they don't mention the skill, fonts, colors or HandinHand explicitly in that chat.
---

# HandinHand CMS design system

Every page built for HandinHand should look like it belongs to the live CMS: same font, same colors, same Bootstrap 3 / AdminLTE structure, Arabic and right-to-left. Users compare mockups side by side with the live system, so "close enough" colors or a different Arabic font are immediately noticed.

## 1. Always start from the theme file

Copy `assets/theme.css` (next to this file) into the page's `<style>` (or link it). It defines:
- `--live-font` and the font rules for the whole page
- every color token below as CSS variables
- the recurring components (header gradient, panels, buttons, toggle groups, chips, picker tables, data-table rows, case-value buttons, side stats panel)

Then build the page with those variables/classes instead of inventing new values. If a new color is genuinely needed, derive it from the palette (lighter/darker shade of an existing token) and say so.

## 2. Base page setup

```html
<html lang="ar" dir="rtl">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.3.7/css/bootstrap.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-rtl/3.4.0/css/bootstrap-rtl.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;500;600;700&display=swap">
```
- Libraries the live system uses (prefer them): jQuery 2.1.4, Bootstrap 3.3.x + bootstrap-rtl, Font Awesome 4.7, select2 4, moment + daterangepicker (single-month calendar), iCheck flat-green, DataTables (legacy API), SweetAlert, pnotify.
- Layout shell: gradient top header (`.main-header`), dark right sidebar `#222d32` (collapsed, icons only), white content area, filters inside a `.panel.panel-primary` whose heading uses the header gradient.

## 3. Font

`--live-font: 'Droid Arabic Kufi', 'Noto Kufi Arabic', Tahoma, Arial, sans-serif;`

The live AdminLTE Arabic theme uses **Droid Arabic Kufi**. Google retired that font, so load **Noto Kufi Arabic** (its official successor, same design) from Google Fonts. Use the same font for numbers/dates too (no separate monospace font) and add `font-variant-numeric: tabular-nums` where digits must line up.

## 4. Color palette (exact values)

| Token | Value | Used for |
|---|---|---|
| Header/panel gradient | `linear-gradient(90deg, #d3f1f8 0%, #ebf6ed 17%, #fff9e4 34%, #f9e7de 47%, #f8f2e4 57%, #d9eaf4 64%, #e9efec 74%, #baeae6 100%)` | top header, panel headings, modal headers |
| Header text | `#535252` | header links/icons, modal titles |
| Sidebar | `#222d32` (hover/active `#1e282c`, text `#b8c7ce`) | right sidebar |
| Primary (blue) | `#0093e9` | primary buttons, نسخ, اليوم, selected picker cells (odd cols) |
| Success (green) | `#31c860` (hover `#2db457`) | بحث, لصق, هذا الأسبوع, Excel export, positive states |
| Danger (red/pink) | `#f96a74` | مسح, delete, selected picker cells (even cols) |
| Warning (orange) | `#ff6a00` | إدارة الملفات and secondary call-to-action |
| Focus / highlight | `#67b9ec` | input focus border, select2 highlighted option |
| Default button | bg `#f4f4f4`, border `#ddd`, text `#444` | neutral buttons |
| Inputs | border `#d2d6de`, radius 0 (AdminLTE) | form controls |
| Toggle "الكل" active | `#b7b7b7` | btn-group-justified all |
| Toggle "on" active | `#5bb75b` | e.g. حضر / نعم |
| Toggle "off" active | `#da4f49` | e.g. لم يحضر / لا |
| Box/filter group | bg `#f6f6f6`, border `#d7dbe0`, radius 10px | `.box-content` |
| Chips (selected values) | bg `#e6f1fb`, text+border `#0093e9`, radius 15px | picker chips |
| Picker table | header `#d9e8f7`; odd cols `#c3e0f9`, even cols `#ffbec2`; borders gray | status/team/components dropdown tables |
| Table row – new order | `#d9edf7` (hover `#becfd8`); key cells `#e8f1ff` | طلب جديد |
| Table row – maintenance | `#f2dede` (hover `#dbc6c6`); key cells `#fbe8e8` | طلب صيانة |
| Table hover (generic) | `#f96a741f` | `.table tbody tr:hover` |
| Label text in info cells | `gray` | الاسم: / المحافظة: … |
| Stats – target rows | `#fdf6df` | الرقم المستهدف |
| Stats – percent rows | `#dff0d8` / `#d3eacb` | النسبة المحققة |
| Dashboard (cards/charts) | bg `#f5f6f8`, surface `#fff`, surface-2 `#eef0f3`, border `#e2e5ea`, text `#1a1d23`, dim `#62697a`, faint `#97a0ad`, accent `#2f6fed` (hover `#2559c9`), green `#15803d`, radius 6/10px | side statistics dashboard with charts |

## 5. Component conventions

- **Buttons**: rounded `border-radius: 10px` for filter/action buttons (مسح / نسخ / لصق / اليوم / هذا الأسبوع / بحث / تفاصيل الجدول / إدارة الملفات) with an icon before the text (`fa-times`, `fa-copy`, `fa-paste`, `fa-calendar-o`, `glyphicon-search`). Put a field's action buttons directly next to the field.
- **Filters**: stacked one per row in the order the user knows; each filter only as wide as its content needs (not full width). Labels bold, right-aligned above the field.
- **Tabs / category buttons**: `btn-lg btn-default`; active tab takes blue for new-order stages and red for maintenance stages; "الكل" grey.
- **Dropdown pickers**: a button showing chips, opening a 4-column colored table (see palette) with "إزالة التحديد".
- **Tables**: Bootstrap bordered table, centered text, `nowrap` headers, row colors by order type; only the table scrolls horizontally — the toolbar (عرض N / records count / طباعة / اكسيل) and pager stay fixed.
- **Copy/search on values**: value followed by a small white 🔍 button and a blue "نسخ" button (turns green "تم" for ~1s after copying).
- **Side stats panel**: slides in from the left, toggled by a blue `#0093e9` arrow tab.
- **Text**: all UI copy in Arabic (Egyptian context), dates `YYYY-MM-DD`, week = Sunday → Thursday/Saturday as the page defines.

## 6. Dashboards (داش بورد / إحصائيات)

Any dashboard — a full page or the slide-in side panel — uses the same font and palette, in the card/chart style of the visits statistics dashboard:

- **Container**: white surface on `--vs-bg` (`#f5f6f8`), borders `--vs-border` (`#e2e5ea`), radius 10px, title bar with a `fa-bar-chart` icon + title on the right, refresh button (white, `fa-refresh`, spins while reloading) and green "تصدير إلى Excel" button on the left.
- **Period switcher**: segmented tabs اليوم / الأسبوع / الشهر / ربع سنوي / سنوية; active tab `--vs-accent` (`#2f6fed`) with white text; show the date range under it in faint text (`#97a0ad`).
- **KPI cards**: grid of cards (bg `#f5f6f8`, radius 10px) — big bold number (20px, tabular digits) on top, small dim label (`#62697a`) under it; zero values in faint color. Typical KPIs: القياسات، التسليمات، صيانات / تقييم صيانة، تسليم صيانة، رفض الاستلام، إعادة تصنيع.
- **Target vs actual**: cards per metric with "الفعلي" and "المستهدف" rows, a progress bar in the accent blue and the percentage; show "-" when no target is set (never fake a percentage).
- **Charts**: Recharts (React UMD) or Highcharts (the live system already loads Highcharts). Use the palette colors (`#2f6fed`, `#15803d`, `#0093e9`, `#31c860`, `#f96a74`, `#ff6a00`), light dashed grid `#d6d9df`, axis text `#6b7280` 11px, legend and tooltips in `--live-font`, RTL tooltips.
- **Tables inside dashboards**: same table look as the stats panel — header `#e9eef3`, period rows white/`#f7f9fb`, target rows `#fdf6df`, percentage rows `#dff0d8`.
- Section headings small, bold, faint (`#97a0ad`), e.g. "الأداء مقابل المستهدف"، "الاتجاه عبر الفترات".

## 7. Before handing over

Check the page in a browser at ~1900px wide: font is Kufi everywhere (body, tables, select2, date picker, chart axes/legends/tooltips), no colors outside the palette, RTL alignment correct, and buttons sit next to their fields.
