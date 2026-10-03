# Comeback

Comeback is a habit tracker for getting back to your best, one day at a time: habits that fit your week, automatic step counting, weight, waist, BMI, notes and progress charts, packaged as an offline Android app with Capacitor. Developer: EntaLogics.

- App ID: `com.entalogics.comeback` — minSdk 23, target SDK 36
- Works fully offline (Chart.js, the Inter font and the icons are bundled)
- Data is stored with Capacitor Preferences on the phone
- Three tabs: **Today** (what to do now), **Progress** (how it is going, including BMI) and **Plan** (your goals). Account and sync, backup, the daily reminder, step tracking health, permissions, units and body details live in **Settings**, behind the gear in the top-right corner of every screen.

## Design

The UI follows the principles behind Apple's Human Interface Guidelines (clarity, deference, depth, consistency) with an original look. It uses no Apple fonts, icons or branding: the typeface is **Inter** and the icons are **Lucide** (1.75px stroke), both bundled locally (see `THIRD_PARTY.md`).

- **Glass look:** frosted, translucent surfaces (cards, the top bar, the floating tab bar, sheets, the toast) over a soft aurora backdrop, with a thin light edge and a gentle shadow. Only the surfaces that float over moving content (the top and tab bars, sheets, the toast) blur what is behind them; cards in the page are plain translucent. Contrast is checked against the worst colours the glass can sit on (`npm run test:contrast`). **Settings > Appearance > Simple look** (switched on automatically on low-memory phones) makes bars and sheets solid and stops the wiggle in edit mode, and if Android asks for less transparency (or the WebView has no backdrop blur) every surface becomes solid.
- **Responsive:** one layout that adapts from a 280 px folded cover screen to a desktop window. Phones get a floating bottom tab bar; from 600 px targets and stats use three columns; from 840 px (tablets, landscape) the tab bar becomes a side rail, Today splits into a sticky summary and a targets grid, Progress and Plan use two columns and sheets open as centred dialogs. Short landscape screens get a tighter layout, notches and cut-outs are respected, and 130% and 160% text sizes still fit (`npm run test:responsive`).
- **Today:** the date as a large title with a pencil button to edit Today, a compact progress ring card, and your habits in sections (see below); a full row of cards is visible on a 360x800 phone without scrolling. Every change saves by itself and shows "Saved". Plain + and - taps and Yes/No ticks are quiet (the number and the bar move); a toast with **Undo** appears for a goal hit, a streak milestone, a finished day, a sheet save, Hide, and for the +5 / +10 buttons on Duration cards. Taps on the same card within 3 seconds share one toast ("Pushups +7") and one Undo.
- **Progress:** Week / Month / 3 Months, stat tiles, a **Body** section with the BMI card on top, a trend chart you can touch and drag across to read exact values, a calendar of soft squares (tap a day to open it), and recent days.
- **Plan:** your goals only: habits grouped by section with their targets and schedules, the habit library, "Create your own", and the sections. Swipe a row left (or use Remove in a habit's edit sheet) to remove it at once, with an Undo toast; use "Reorder in sections" to drag habits inside a section.
- **Settings**, in this order: Reminder, Units, Body (height, BMI scale), Suggestions, Appearance (Theme, Simple look), Security (Android app: Lock Comeback), Step tracking (Android app), Permissions (Android app), a collapsed **Advanced** (vehicle filter strictness, accelerometer sensitivity, location accuracy), Backup ("Last backup: never" shows a gentle warning and a **Back up now** button), Account and sync, About (with the version).
- **Theme and app lock:** Settings > Appearance > **Theme** is System (default, follows the phone), Light or Dark. Settings > Security (Android app only, off by default) has **Lock Comeback**. Both are described under "Theme and app lock" below.
- **Feel:** light haptics on taps, a success haptic when a target is reached, a short celebration when the whole day is done, and neutral wording on quiet days ("Not logged", "Start again today"). Reduce-motion turns animations into simple fades.
- **Accessibility:** works at 130% text size, 44px minimum tap targets, labelled controls, text summaries for the ring and chart, status never shown by colour alone, and WCAG AA contrast in light and dark (`npm run test:contrast`).

## How Comeback is organised

**Today is grouped into sections:** *Movement* (Steps, which are counted by the phone and read-only, and Brisk walk), *Workout* (pushups, pull-ups, squats, plank and your own workouts), *Health* (water, sleep), *Food rules* (a tick list) and *Body and notes* (weight, waist, BMI and the note; collapsed until you open it). Any habit can be moved to any section, and you can add your own sections.

**Four habit types**

| Type | How you log it | Examples |
| --- | --- | --- |
| Count | A card with + and − (tap the card to add a bigger amount: the sheet opens in **Add** mode, "20 + 15 = 35 of 30 reps", with a **Set total** toggle for corrections) | pushups, water |
| Duration | A card with quick +5 / +10 minute (or seconds) presets, and the same Add sheet | plank, brisk walk |
| Yes/No | One tap on a switch | no sugar, vitamins |
| Steps | Automatic and read-only, counted by the phone | steps |

Weight and waist are measurements (they open a number pad). Habits you had before were turned into these types for you (see Migration below).

**Schedules.** Every day, Specific days, X times per week, or Every N weeks. Only habits that are due today show on Today, the daily score and the streak only count habits that were due that day, and X-per-week habits show "2 of 3 this week". Weight defaults to 3 times a week and waist to every 2 weeks; everything else is daily.

**Streaks.** A day is kept when its score is 50% or more (counting only what was due). The streak is the number of kept days in a row, rest days skipped. Today counts once it reaches 50%; until then the streak is counted from yesterday, so it never drops while the day is still open (Today says, for example, "12-day streak · today still open"). A day that holds nothing (for example after undoing the only change of the day) is not a logged day. Progress also shows "Kept 31 of 35 due days in the last 5 weeks". Steps is always the habit with the id `steps`; any other habit that only has a steps unit is a plain Count.

**Finished cards shrink.** When a target is met its card stays open for a moment (about 1.5 seconds, none with reduced motion), then folds into one compact row ("30 / 30 min", the same format as the card) with a ✓. Count and Duration rows keep a small + for extra reps; tap the row to open the card again.

**Customise Today.** Tap the pencil next to the date, tap *Edit Today* at the bottom, or press and hold any card (a ring grows around it while you hold) to enter edit mode. The first time you log something, a one-time tip says "Tip: hold a card to rearrange". One compact strip at the top has *Done* and, when something is hidden, a *Hidden (n)* chip that opens a small list with Show buttons. Drag the handles to reorder cards and sections (or move a card into another section), tap *Hide* to take a card off Today (it stays in Plan), tap **+** on a section to add from the library. The card you pressed stays where it was on screen, and the cards wiggle for about a second and then settle (never in the simple look or with reduced motion). Arrow keys work on the handles too. The layout is saved on the phone and travels with your settings when you sync.

**Habit library and "Create your own".** A searchable library with icons and sensible default types and targets: Movement (walk, run, cycling, stretching, stand-up breaks), Strength (pushups, pull-ups, squats, plank, lunges, sit-ups), Health (water, sleep, vitamins, weight, waist), Food (no sugar, no sugary drinks, no fried food, no maida, no late eating, eat vegetables, protein with every meal) and Mind (meditation, reading, no phone before bed, journaling). *Create your own* takes a name, icon, type, target, unit, schedule and section.

**Starter plans.** On a fresh install, after the welcome page: *Desk worker reset*, *Beginner fitness*, *Weight loss* or *Start from scratch* (Next stays off until one is picked, and a line says "Pick one to continue"). People who already have data are not shown them. If the plan is empty, Today says "Your plan is empty" with an *Add habit* button and a *Choose a starter plan* link. When nothing is due the ring text, the "0 of 0" chips and the hint are hidden.

**Body and notes** starts open when a weight or waist is due today, and closed otherwise; closed, its header says what is due ("Weight due", with a small dot).

**Smart target suggestions.** When a Count or Duration habit has hit its target on 5 due days in a row, Today says, for example, "You've hit 30 pushups 5 days straight. Try 35?" with **Raise target** or **Not now** (about 10 to 20 percent more, on a round number; "Not now" keeps it quiet for 7 days). Turn it off in Settings > Suggestions.


## Theme and app lock

**Theme.** Settings > Appearance > Theme: *System* (default), *Light* or *Dark*, a radio group that applies at once. The choice is device-local (Preferences key `comeback_theme`: `system`, `light` or `dark`; not synced) and is also cached in `localStorage` (`comeback_theme_cache`, in a try/catch) so `www/js/theme.js`, loaded in the `<head>`, can set `data-theme` on `<html>` before the first paint (System leaves the attribute off). In `css/app.css` light is the default; the dark tokens sit under `@media (prefers-color-scheme:dark){:root:not([data-theme="light"])}` and again under `:root[data-theme="dark"]` (CSS cannot share one rule between a media query and an attribute selector, so the two copies must stay identical; `npm run test:contrast` checks that and tests the palettes), and `color-scheme` follows the choice. The override rules for solid surfaces use `:root:root` so they still beat the dark tokens. `isDark()` (theme.js) is the one question every script asks: the status bar style in `syncBars()` uses it, and every theme change (or the phone changing its dark mode while System is chosen) fires `comeback-theme` on `window`, which re-syncs the bars and redraws the charts. Tests: `node test/theme-lock-test.mjs`.

**App lock (Android app, off by default).** Settings > Security: **Lock Comeback** and, once it is on, **Lock after** (Immediately, 1 minute, 5 minutes; 1 minute to begin with). It uses Android's `BiometricPrompt` through the small Kotlin plugin `AppLock` (`android/app/src/main/java/com/entalogics/comeback/lock/`, registered in `MainActivity`; dependency `androidx.biometric:biometric:1.1.0`).
- **One approach for API 23 and up:** authenticators `BIOMETRIC_WEAK | DEVICE_CREDENTIAL`, so a phone without a fingerprint or face sensor can use its PIN, pattern or password. The library supplies the screen-lock fallback itself on Android 6 to 10, so no separate `KeyguardManager` route is needed (the combinations to avoid before Android 11 are `DEVICE_CREDENTIAL` alone and `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`). Plugin methods: `isAvailable()` -> `{available, reason}`, `authenticate({title, subtitle})` -> `{ok, error?}` (`canceled`, `lockout`, `unavailable`, `failed`), `setSecure({enabled})`.
- **When it locks** (`www/js/lock.js`, `www/css/lock.css`): at every app start, and when the app comes back after the chosen time away. Immediately puts the lock screen up as the app goes to the background. The lock screen is a full-screen modal dialog; everything behind it is inert, Tab cannot leave it, and **Unlock** asks again (the prompt also opens by itself). While the lock is on the window is `FLAG_SECURE`, so the recent-apps card and screenshots are blank (the plugin sets it as soon as it loads, before the page).
- **Never traps you:** the lock cannot be turned on unless the phone can check it is you (no screen lock set: a clear message) and you pass the check once; turning it off asks for the check again. If the phone later loses its screen lock, or the sensor is gone, the lock screen says so and offers **Turn off the lock** (a busy sensor only asks you to wait). Share sheets, permission dialogs and the file picker are not counted as leaving the app.
- **Device-local only:** Preferences keys `comeback_lock` (`1`), `comeback_lock_delay` (`0`, `1` or `5` minutes) and `comeback_last_active` (set when the app goes to the background). They are not in the synced settings, the JSON backup or the cloud rows, and Android backup is off. The group is hidden in a plain browser. The delay rule (`LockPolicy.shouldLock` in Kotlin, `Lock.shouldLock` in JavaScript) is unit tested on both sides with the same table (`npm run test:android`).

## Reminders, timer, quick add, anchors and the first week

**Smarter reminders (Android app).** All of them are local notifications on the `daily-reminder` channel, titled "Comeback", inexact and allowed while idle (Doze friendly). Settings > Reminder has:

- **Daily reminder** at a time you pick (9:00 PM to begin with) and **Only remind me if something is left** (on by default, kept in `meta.reminder.onlyIfOpen`). Android schedules notifications ahead of time, so "only if something is left" works by planning one-shot notifications (`schedule.at`) for tonight and the next two days (ids 1001 to 1003) and planning again whenever anything changes. `rescheduleReminders()` in `logic.js` does it: it runs after every save (`flushSave`, Plan edits, restore, cloud pull), when the app opens and when it comes back to the front, and it cancels everything planned before and schedules what `Core.planReminders` says (pure, tested in `npm run test:core`). Tonight's reminder is skipped when everything due today is done, on a rest day (nothing due) and on a light day (`day.light`); if something is open, its text names up to two things: "Water and Brisk walk are still open. A quick one counts." The days after use the plain text, because nothing is known about them yet.
- **Decision: no repeating fallback while that switch is on.** A repeating notification would fire on a finished day, which is exactly what this switch is for. The cost is that after three days without opening the app the one-shots run out and the reminders go quiet by themselves, which is deliberate (no nagging). Switch "Only remind me if something is left" off and the evening reminder is the old repeating daily one (`schedule.on`, id 1001) that needs no re-planning.
- **Morning cue** (off by default, 8:00 AM, ids 1011 to 1013): one note with the day's easiest win, for example "Good morning. Today's easiest win: 6 stand-up breaks." (the open Count or Duration habit closest to done, then the smallest). Skipped on days that are done, rest or light. After the third logged day, people who use the evening reminder are offered it once, gently ("Not now" is fine).
- **Reminders for one habit** (Plan > a habit > **Remind me**): up to 3 times a day with the same 12-hour pickers, and **Skip if already done**. The text is "After lunch: 10 min brisk walk." when the habit has an anchor, else "Pushups: 30 reps." Ids start at 2000 (`2000 + habit index * 40 + time index * 12 + slot`). Habits that skip when done are planned like the evening reminder (one-shots for the next three days, skipped on days they are not due, when already met, and on light days). A habit that does not skip and is every day is one repeating daily notification; a Specific days habit that does not skip is one repeating notification per weekday; X-times-a-week and every-N-weeks habits are always planned day by day. All habit reminders are replaced together each time the plan changes. A bell on the card shows that a habit has reminders. If notifications are refused when you save one, a toast says the reminder cannot ring yet.
- Notification permission is asked the first time something needs it (the switch, or saving a habit reminder). If it is refused the switch goes back off with a message and nothing is scheduled.

**Timer for Duration habits.** A play button on the cards of habits measured in seconds or minutes (plank, walk, stretching, meditation) opens a timer: a ring that counts up to the target (or **Count down**), Start / Pause / Resume / Stop, a haptic and a vibration at the target, and on Stop an "Add 0:42 to Plank" line (whole seconds, or minutes to a tenth; under a second says it was too short). Keep going, Add or Discard. The running timer is saved in Preferences under `comeback_timer` as `{habitId, day, mode, startedAt, pausedMs, pausedAt, reached, stopped}` (this phone only, not synced) and the time on screen is always worked out from those timestamps, so it is right after the screen was off or the app was closed. Opening the app again offers to pick it up. In the Android app a notification is scheduled for the moment the target is reached (id 1900). The screen stays awake while the sheet is open when the WebView has `navigator.wakeLock`; reduced motion stops the ring animating. `www/js/timer.js` and `www/css/timer.css` (which also holds the styles for the bell, the quick-add chips, the form fields and the ramp row).

**Quick add amounts.** A Count habit can have `presets` (up to 4 positive amounts, for example `[0.25, 0.5]`) and a `step`. The card shows them as one-tap chips ("+0.25 L", "+0.5 L"; for glasses "+1 glass (250 ml)"); the number sheet shows all of them. Without your own, litres, glasses and cups get sensible ones, and the + and − buttons on water step by a quarter litre (or the first amount) instead of half a litre. Edit them in the habit form under Quick add amounts. The library's water entry comes with 0.25 and 0.5.

**Anchors.** A habit can have an `anchor` such as "After lunch" or "Before bed" (30 characters at most, shown as plain text only). Chips in the habit form fill it in. It is the small line under the card or row, in Plan, and the start of that habit's reminder text.

**First-week ramp (new installs only).** Picking a starter plan (other than Start from scratch) in onboarding sets `settings.prefs.ramp = true` and `prefs.rampStart`. For the first 7 days Today shows 3 habits (the first three of the plan that are due, plus anything you have already logged), then a "More when you're ready (N)" row; tapping it shows everything and ends the ramp. On day 4 a card offers once "Add another habit?" (**Add one** raises `prefs.rampLimit` by one). Settings > Suggestions has **Ease me in during the first week**; people who installed before this existed never have the setting and never see the switch. `Core.rampVisible(settings, days, today, habit)` is the pure rule.

**New habit fields** (all optional, all inside `settings.habits`, so they sync and back up with the plan): `anchor` (text), `presets` (`[number]`, Count and Duration), `remind` (`{times:["07:00"], skipIfDone:true}`; 24-hour storage, at most 3, sorted, no repeats), plus the existing `step`. New `settings.prefs` keys: `ramp`, `rampStart`, `rampLimit`. New phone-only keys in `comeback_meta`: `reminder.onlyIfOpen`, `reminder.morning`, `reminder.morningOffered`, `reminderIds` (what was scheduled last, so it can be cancelled), `rampOffered`. Tests: `node test/reminders-test.mjs`.

## BMI

- **Where:** a card at the top of Progress > Body (BMI, category, a small trend line), and the Body section of Today shows BMI next to your latest weight. Tap either to open the detail sheet.
- **How:** BMI = kg ÷ m², calculated from the height in Settings and your latest logged weight, and recalculated whenever either changes. It is never stored. With no weight it says "Log your weight to see your BMI" (with a button), and with no height "Set your height to see your BMI".
- **Two scales** (Settings > Body > BMI scale; the first time the BMI sheet opens without a height it asks for the height and offers the scale in one line, and says the Asian scale is often used for South, East and Southeast Asian backgrounds; Standard is the default):

| Scale | Underweight | Normal | Overweight | Obese |
| --- | --- | --- | --- | --- |
| Standard (WHO) | under 18.5 | 18.5 to 24.9 | 25 to 29.9 | 30 and over |
| Asian (WHO Asia-Pacific) | under 18.5 | 18.5 to 22.9 | 23 to 24.9 | 25 and over |

  For 180 cm and 87 kg the BMI is 26.9: Overweight on Standard, Obese on Asian. Categories use colour and text together.
- **Detail sheet:** the large BMI and category, a horizontal scale bar with a marker, the healthy weight range for your height on the selected scale, a neutral distance to that range ("6.3 kg to the healthy range"), waist-to-height ratio when a waist is logged (under 0.5 healthy, 0.5 and above elevated), a BMI trend chart (week, month, 3 months), a **Quick calculator** for any height and weight (it saves nothing), and the note that BMI is a general screening measure that does not account for muscle mass and is not a medical diagnosis.
- **Units** (Settings > Units): kg or lb, cm or ft/in. Everything is stored in kg and cm. Height, units and the BMI scale are part of the synced settings. The CSV export has a BMI column for days with a weight.

## Light days, streak shield, weekly review, insights, goal weight

- **Light day ("Take it easy today").** The button next to *Edit Today* marks a day as light (illness, travel, a low day), and it works on past days too. A light day is left out of scoring like a rest day, so it never breaks the streak and never counts against you; the calendar shows it with a dashed outline and the legend names it. Today says "Light day on. Just do what you can. Your streak is safe." and, the next morning, "Welcome back. Pick up with one easy thing." Toggling shows a toast with Undo. The day record gets an optional `light: true`, which is kept by backup, restore, merge, cloud sync and the CSV (a *Light day* column).
- **Streak shield.** One automatic free miss: a single due day with no record or under 50% does not break the streak if the 6 due days before it were all kept. It adds nothing to the count and shows as a dotted "shield day" on the calendar; Today says "Rest day used. Streak safe at 12." The shield is ready again after 6 more kept due days, so two misses within 7 due days still end the streak. The 50% rule and rest-day skipping are unchanged (`Core.currentStreak`, `Core.shieldDays`, `Core.shieldNote`; `Core.isLight(day)` is for anything that should skip light days, such as reminders).
- **Weekly review.** A dismissible "Last week" card at the top of Today (until you answer it, or the next week arrives): "Last week: 5 of 7 days kept (up from 3). Water was your steadiest habit. Plank dipped. Keep the plan, or ease plank to 50 sec?" with *Keep the plan*, *Lighten the plan* (about 20% off the habit that dipped, or its schedule) and *Raise [habit]* (the same step as the target suggestion), each with Undo, plus an optional note that is added to that day's note. Share sends the text through the Android share sheet. The answer is remembered on the phone (Preferences key `comeback_review_seen`, the week start). Progress has a *This week / Last week* tile. The numbers come from `Core.weekSummary`, the words from `Core.weekText`.
- **Insights.** After 21 logged days, up to 3 patterns in your own data on Progress: best day of the week, weekdays against weekends, a habit often missed on one weekday (with *Move it off Fridays*), a weight plateau of three weeks (reassuring wording), and "tends to" pairs such as 6,000+ steps (each side needs at least 8 days). No causes, no blame (`Core.insights`).
- **Goal weight.** Settings > Body > *Goal weight* (number pad in your unit, optional target date, clear the number to remove it). It is stored in kg as `settings.body.goalKg` and `settings.body.goalDate`, syncs with the settings, and is drawn as a dashed "Goal" line on the weight chart, as a card under Progress > Body and as a row in the BMI sheet. The pace is the median slope of your weigh-ins over the last 4 weeks (at least 3, a week apart), so one odd weigh-in does not move it: "4 kg to go · about 0.5 kg a week lately · around late November", and "a little behind, and that's normal" when behind a date. A date that needs more than 1 kg a week is never encouraged: the card says so and shows the date a steady 1 kg a week would reach (`Core.goalStatus`, `Core.goalText`).
- Tests: `node test/core-test.mjs` (the rules) and `node test/retention-test.mjs` (in the browser).

## Migration from the earlier structure

Everything you had is kept and moved into the new structure the first time the new version starts (and again, harmlessly, on every start after that):

- Every day record is unchanged (`vals`, `rules`, `weight`, `waist`, `note`, `steps_meta`); a day may also carry the optional `light: true`, and `settings.body` may carry the optional `goalKg` (kg) and `goalDate` (`YYYY-MM-DD`). Older data simply lacks them, and nothing is rewritten. Old and new backups and the cloud rows need no data rewrite.
- Targets became habits with a type: steps → Steps, minutes or seconds → Duration, everything else → Count. Rules became Yes/No habits in *Food rules*. Existing habits stay every day. Weight and waist were added as measurements (3 times a week and every 2 weeks). A rule that shared an id with a habit got a new id (in your days too).
- The height that used to be a phone-only step setting becomes the synced height (once, on the first start).
- Old backups (`version` 1, or no version) restore into the new structure; new backups are `version` 2 and carry the whole layout. The migration is covered by `npm run test:core` (pure logic, including running it twice), `npm run test:structure` (in the browser, with 12 seeded days and an old backup file) and `npm run test:rename`.

| Today | Edit Today | Habit library | Create your own |
| --- | --- | --- | --- |
| ![Today, light](docs/screenshots/10-today-360x800-light.webp) | ![Edit mode, light](docs/screenshots/14-today-edit-mode-360x800-light.webp) | ![Library, light](docs/screenshots/16-habit-library-360x800-light.webp) | ![Create your own, light](docs/screenshots/22-create-your-own-360x800-light.webp) |
| ![Today, dark](docs/screenshots/10-today-360x800-dark.webp) | ![Edit mode, dark](docs/screenshots/14-today-edit-mode-360x800-dark.webp) | ![Library, dark](docs/screenshots/16-habit-library-360x800-dark.webp) | ![Create your own, dark](docs/screenshots/22-create-your-own-360x800-dark.webp) |

| Finished cards | Body and BMI on Today | Target suggestion | Start from scratch |
| --- | --- | --- | --- |
| ![All done, light](docs/screenshots/50-today-all-done-360x800-light.webp) | ![Body, light](docs/screenshots/13-today-body-bmi-360x800-light.webp) | ![Suggestion, light](docs/screenshots/53-today-target-suggestion-360x800-light.webp) | ![Empty, light](docs/screenshots/54-today-start-from-scratch-360x800-light.webp) |
| ![All done, dark](docs/screenshots/50-today-all-done-360x800-dark.webp) | ![Body, dark](docs/screenshots/13-today-body-bmi-360x800-dark.webp) | ![Suggestion, dark](docs/screenshots/53-today-target-suggestion-360x800-dark.webp) | ![Empty, dark](docs/screenshots/54-today-start-from-scratch-360x800-dark.webp) |

| Plan | Settings | Settings (Android app) | Advanced |
| --- | --- | --- | --- |
| ![Plan, light](docs/screenshots/20-plan-360x800-light.webp) | ![Settings, light](docs/screenshots/30-settings-360x800-light.webp) | ![Settings 2, light](docs/screenshots/31-settings-scrolled-360x800-light.webp) | ![Advanced, light](docs/screenshots/32-settings-advanced-360x800-light.webp) |
| ![Plan, dark](docs/screenshots/20-plan-360x800-dark.webp) | ![Settings, dark](docs/screenshots/30-settings-360x800-dark.webp) | ![Settings 2, dark](docs/screenshots/31-settings-scrolled-360x800-dark.webp) | ![Advanced, dark](docs/screenshots/32-settings-advanced-360x800-dark.webp) |

| Progress | BMI card (Standard) | BMI card (Asian) | BMI, no weight yet |
| --- | --- | --- | --- |
| ![Progress, light](docs/screenshots/40-progress-360x800-light.webp) | ![BMI card, light](docs/screenshots/41-progress-bmi-card-360x800-light.webp) | ![BMI Asian, light](docs/screenshots/45-progress-bmi-card-asian-360x800-light.webp) | ![No weight, light](docs/screenshots/47-bmi-no-weight-360x800-light.webp) |
| ![Progress, dark](docs/screenshots/40-progress-360x800-dark.webp) | ![BMI card, dark](docs/screenshots/41-progress-bmi-card-360x800-dark.webp) | ![BMI Asian, dark](docs/screenshots/45-progress-bmi-card-asian-360x800-dark.webp) | ![No weight, dark](docs/screenshots/47-bmi-no-weight-360x800-dark.webp) |

| BMI sheet | BMI sheet (trend) | Quick calculator | BMI sheet (Asian) |
| --- | --- | --- | --- |
| ![BMI sheet, light](docs/screenshots/42-bmi-sheet-360x800-light.webp) | ![BMI trend, light](docs/screenshots/43-bmi-sheet-middle-360x800-light.webp) | ![Calculator, light](docs/screenshots/44-bmi-sheet-calculator-360x800-light.webp) | ![BMI Asian, light](docs/screenshots/46-bmi-sheet-asian-360x800-light.webp) |
| ![BMI sheet, dark](docs/screenshots/42-bmi-sheet-360x800-dark.webp) | ![BMI trend, dark](docs/screenshots/43-bmi-sheet-middle-360x800-dark.webp) | ![Calculator, dark](docs/screenshots/44-bmi-sheet-calculator-360x800-dark.webp) | ![BMI Asian, dark](docs/screenshots/46-bmi-sheet-asian-360x800-dark.webp) |

First launch: welcome, starter plans, reminder, and (Android app) the permission screen and an optional height. Height and the BMI scale are asked where they are used, the first time BMI is opened. (The height and BMI scale screenshots below are from the earlier, longer intro.)

| Welcome | Starter plans | Height | BMI scale | Permissions |
| --- | --- | --- | --- | --- |
| ![Welcome, light](docs/screenshots/01-onboarding-welcome-360x800-light.webp) | ![Plans, light](docs/screenshots/03-onboarding-starter-plan-picked-360x800-light.webp) | ![Height, light](docs/screenshots/06-onboarding-height-360x800-light.webp) | ![Scale, light](docs/screenshots/07-onboarding-bmi-scale-360x800-light.webp) | ![Permissions, light](docs/screenshots/08-onboarding-permissions-360x800-light.webp) |
| ![Welcome, dark](docs/screenshots/01-onboarding-welcome-360x800-dark.webp) | ![Plans, dark](docs/screenshots/03-onboarding-starter-plan-picked-360x800-dark.webp) | ![Height, dark](docs/screenshots/06-onboarding-height-360x800-dark.webp) | ![Scale, dark](docs/screenshots/07-onboarding-bmi-scale-360x800-dark.webp) | ![Permissions, dark](docs/screenshots/08-onboarding-permissions-360x800-dark.webp) |

Larger screens (the tab bar becomes a side rail, Today splits into a summary and a grid, Settings and Plan use two columns, sheets are centred dialogs):

| Tablet landscape: Today | Settings | BMI sheet | Plan (dark) |
| --- | --- | --- | --- |
| ![Today 1024](docs/screenshots/60-wide-today-1024x768-light.webp) | ![Settings 1024](docs/screenshots/63-wide-settings-1024x768-light.webp) | ![BMI 1024](docs/screenshots/64-wide-bmi-sheet-1024x768-dark.webp) | ![Plan 1024](docs/screenshots/62-wide-plan-1024x768-dark.webp) |

All screenshots (light and dark) are in [`docs/screenshots`](docs/screenshots). Regenerate them with `node scripts/screenshots.mjs`.

## Install the APK


1. Get `release/Comeback-debug.apk` onto your phone (download it from this repo, or take it from the latest GitHub Actions run, see below).
2. Open it. Android will ask you to allow **Install unknown apps** for the app you opened it from (Files, Chrome, etc.). Allow it, then tap Install.
3. Open **Comeback**. On Android 13+ the first time you switch the daily reminder on, allow notifications.

Every build uses the same signing key, so a newer APK installs straight over an older one and keeps your data. Don't uninstall first, because uninstalling deletes the app's data.

### Moving from the earlier version of the app

Comeback has a new application ID (`com.entalogics.comeback`), so Android treats it as a **new app**. It does not replace the earlier version and it cannot read that app's data. Before you install it:

1. In the earlier app open **Plan** (or **Settings**, in newer versions) **> Export backup (JSON)** and save the file somewhere safe (Drive, email, WhatsApp to yourself).
2. Install Comeback, open **Settings > Restore from backup** and pick that file. Backup files from the earlier app (`resetlog-backup-YYYY-MM-DD.json`) restore as they are. Or just sign in to sync with the same account and your days come down from the cloud.
3. Once you have checked your days, uninstall the earlier app.

Inside Comeback, anything saved under the earlier storage names (`resetlog`, `resetlog_meta`, `resetlog_sync`, `resetlog_onboarded`, the native step file `resetlog_steps`) moves to the new `comeback` names the first time the app opens, and the old names are removed. It is safe to run more than once, and if both an old and a new value exist and differ, nothing is deleted. `npm run test:rename` and the Kotlin `LegacyMigrationTest` cover this.

## Steps (phone sensor only)

Comeback counts your steps by itself using the phone's own motion sensors. It does **not** use Health Connect, Google Fit, Samsung Health or any other health app, and nothing is shared with other apps. Everything is counted and stored on the phone. Steps **cannot be typed in**: there is no stepper, no number pad and no manual override. (The Android app only; in a browser the Steps card says steps are counted in the Android app.) Your other targets (brisk walk, pushups, pull-ups, squats, plank, water, sleep) are logged by hand as before.

**First launch:** after the welcome, starter plan and reminder screens there is one screen, **"Let Comeback track for you"**, that explains in a line each why Comeback needs *Physical activity* (to count steps and pause counting in vehicles), *Notifications* (for the daily reminder and the step counter notification) and *Battery* (so counting keeps running in the background). One **Allow and continue** button asks for them one after another: Physical activity, then Notifications (Android 13+), then Android's "run in the background" dialog. On Xiaomi, Oppo, Realme, Vivo, Samsung, Infinix, Tecno, itel, Huawei and Honor phones a brand screen follows, with a button that opens the right settings page (you can skip it). Then your height (marked optional; used for the distance estimate, with a typical stride if left empty) and the step service starts straight away. **Location is never asked for during onboarding**; the optional "Use location to improve accuracy in vehicles" switch in Settings > Advanced stays off until you turn it on.

**If you say No:** onboarding carries on and the app works fully for habits. The Steps card on Today says **Turn on step counting** instead of a number (tap it to try again), and Settings > Step tracking > **Step tracking health** shows what is wrong (*Permission missing*, *Paused by battery settings*) with a one-tap fix.

**Updating from an older version:** if Physical activity is already allowed, counting simply switches on. If not, the same permission screen shows once on the next launch.

**On the Steps card (Today):** the live count from the sensor, the target, a progress bar and the estimated distance (stride = 0.415 x height), with the label **Counted by phone**. Tap it for a read-only sheet: today's hourly chart, the distance, the source, **steps filtered out** by the vehicle filtering, and the tracking health. The daily Steps **target** is still editable in Plan.

**Days entered by hand in earlier versions** keep their numbers. They are marked **Entered manually (old)** on the Steps card, in the history list, in the day sheet and in chart tooltips, and the phone never overwrites them (only today is taken over by the phone's count). In the CSV export old rows keep the source `manual`; new days are `counted`.

**Progress:** average steps and average distance for the chosen range (Week / Month / 3 Months), the Steps chart tells you for each day whether it was counted or entered manually (old), and an hourly bar chart shows when you were active today.

**What is stored (per day, inside the normal day record):** `vals.steps` plus `steps_meta`: `source` (`auto`, or `manual` on old days), `counted`, `distance_km`, `filtered`, and `hourly` (24 buckets). It is part of the JSON backup, the CSV export (columns *Steps source*, *Distance (km)*, *Filtered steps*) and cloud sync. Step updates reach the cloud at most once every 15 minutes, and never overwrite an old manual day. Device settings (height, detection, speed check, pull-to-refresh history) stay on this phone.

## Home-screen widget

A widget for the phone's home screen shows today at a glance and works without opening the app. Long-press an empty spot on the home screen, choose **Widgets**, find **Comeback today** and drag it out. It starts as 4 x 2; make it smaller (2 x 2) or larger by long-pressing it and dragging the handles.

- **2 x 2:** the score ring with the percent in it, and steps against the target ("5,200 / 8,000").
- **4 x 2:** the same, plus the streak ("12-day streak", or "Rest day" / "Light day"), the next habit still open ("Next: Water") and a small "Open Comeback".
- **Tap anywhere** on the widget to open Comeback. It follows light and dark mode, has a solid rounded background (no blur), and is described to screen readers as one sentence ("Comeback. Today 62 percent. 5,200 of 8,000 steps. 12-day streak. Next: Water. Tap to open Comeback."). No clock time is ever shown.
- **A new day:** until you open the app on a new day the widget says **Open Comeback to start today** and shows only the steps the phone has counted so far (with the last known target). It never shows yesterday's score as if it were today's.

**How it gets its numbers.** Only the page knows your habits and day records, so it sends the phone a small snapshot (`js/widget.js`: date, score, label, steps, steps target, next open habit) about 1.5 seconds after the Today numbers change, and at once when you leave the app. It is kept in the phone's own storage (`comeback_widget` preferences) and is not part of backups or sync. While the app is closed the step service refreshes only the **steps** (at most once a minute, and only when the count changed); the score, streak and next habit update the next time the app is opened and something changes. The widget only draws what is already on the phone: **no network, no location, no periodic polling** (`updatePeriodMillis` is 0). It also redraws at midnight and when the date, time or time zone changes. Nothing is sent in a browser.

## Pull to refresh (Today)

Pull down on Today (when it is scrolled to the top). A small glass panel opens with one short line, a light tap tells you when you have pulled far enough, and when you let go:

- the phone's step count is read **once** and the Steps card, distance, ring and hourly chart are updated;
- the cloud sync runs only if the last sync was more than **5 minutes** ago;
- the panel stays open for about 1 second (so the line is readable) and at most 2.5 seconds, then closes smoothly.

The line is a nudge from your own data when one applies ("1,240 steps to today's goal", "Pushups not logged yet today", "3-day streak. Keep it going.", "Strong day. Your comeback is on track."), otherwise one of 61 general lines in [`www/data/nudges.json`](www/data/nudges.json). A line is never repeated within the last 20 pulls. With Reduce motion on, the panel simply fades in instead of following your finger. The animation is plain CSS (no library), and the gesture only works on Today.

### How steps are counted

1. **Hardware step counter** (`TYPE_STEP_COUNTER`, the low-power chip) is the main source. The app keeps the last reading and adds the difference to the current day. If a reading is lower than the last one the phone rebooted, so the new reading counts as steps since the reboot. A walk that crosses midnight is split between the two days by time, and an alarm takes a reading just after midnight. `TYPE_STEP_DETECTOR` (when present) supplies each step's timestamp for the rhythm checks and live updates.
2. **Accelerometer fallback** for phones with no step sensor: the acceleration magnitude is band-pass filtered to the walking range (about 0.8 to 3 Hz) and peaks are picked with a minimum height and spacing. Sensitivity (Low / Normal / High) is adjustable in Settings > Advanced. It uses more battery (it holds a partial wake lock) and needs a slightly longer steady walk (4 extra steps) before it counts.
3. Everything is saved in native storage (not the WebView), so nothing is lost if the app is closed. The web app reads the daily totals when it opens and while it is open.

### Keeping vehicles out

All of this runs on the phone. Detection strictness (Relaxed / Balanced / Strict) is in Settings > Advanced.

| Layer | What it does |
| --- | --- |
| **Activity Recognition** (Google Play services Transition API, on-device) | While IN_VEHICLE or ON_BICYCLE is active, steps are discarded; counting resumes on WALKING, RUNNING or STILL. Steps accepted shortly before the detection are cancelled too. Skipped on phones without Play services (for example Huawei). |
| **Rhythm validation** | Steps must come at about 1.2 to 3 per second with an even rhythm (interval variation under about 25%). Irregular bursts are rejected. |
| **Buffering** | New steps are held until about 10 steady steps in a row (Relaxed 6, Strict 14). Short shuffles of 3 to 5 steps are discarded. Once walking is confirmed, steps count until the rhythm stops for about 3 seconds. Accepted steps also wait a short hold-back (30 to 120 seconds) so a late "you are in a vehicle" message can still cancel them. |
| **Vibration filtering** (accelerometer mode) | Band-pass 0.8 to 3 Hz, minimum peak height and spacing, steady step strength, and rejection of very large peaks (shaking). |
| **Speed check** (optional, off) | Settings > Advanced > "Use location to improve accuracy in vehicles". If speed stays above about 15 km/h for 30 seconds, steps in that window are discarded. Location permission is asked only when you switch it on. |

Settings > Step tracking shows **Step tracking health** (Working / Paused by battery settings / Permission missing / Steps paused while in vehicle, with a one-tap fix where it applies) and **Steps filtered out today**.

### Keep it running (battery settings)

Many phones stop background apps. The first-launch permission screen asks Android to exclude Comeback from battery optimisation and, for brands that close background apps, shows steps for your brand with a button that opens the right settings screen where possible. If counting pauses later, Settings shows "Paused by battery settings" with the same help.

| Brand | What to set |
| --- | --- |
| Xiaomi / Redmi / POCO | Settings > Apps > Manage apps > Comeback: turn on **Autostart**, set **Battery saver** to **No restrictions**. |
| Oppo / Realme / OnePlus | Settings > Battery > Comeback: allow background activity and auto-launch, turn off "Optimize battery use". |
| Vivo / iQOO | Settings > Battery > Background power consumption: allow Comeback; turn on Autostart in the phone manager. |
| Samsung | Settings > Battery > Background usage limits: remove Comeback from Sleeping apps and Deep sleeping apps; set it to **Unrestricted**. |
| Huawei / Honor | Settings > Apps > App launch > Comeback: turn off "Manage automatically", turn on Auto-launch, Secondary launch and Run in background. |
| Infinix / Tecno / itel | Phone Master (or Settings) > App management > Autostart: allow Comeback; set battery use to "No restrictions". |
| Other | Settings > Apps > Comeback > Battery > Unrestricted ("Don't optimize"), and allow it in any Autostart / Background apps list. |

The app restarts counting after the phone reboots or the app is updated. A 15-minute WorkManager check brings the service back if the system killed it, and the hardware counter keeps counting while the service is down, so steps are caught up later (without the rhythm checks, but still honouring vehicle periods). While counting, a quiet notification reads "Counting steps · 4,320 today"; tapping it opens the app.

### Battery and background behaviour (audited)

Read from the code (not measured on a device; there is no phone in the build environment). Constants are in `StepService.kt`, `StepTracker.kt` and `js/steps.js`.

| What | Behaviour |
| --- | --- |
| Step sensors | The hardware step counter and detector are registered with a **20 second batching window**, so while you walk the service wakes at most about every 20 seconds, and **not at all while you stand still** (the counter only reports changes). |
| Service tick | A 15 second tick on the main thread (uptime clock, so it never wakes a sleeping CPU; it only runs when the CPU is already awake). Each tick is a few microseconds of arithmetic. |
| Saving | Native storage is written at most once every **20 seconds**, and only if something changed (`apply()`, off the main thread). |
| Notification | Updated at most once every 20 seconds and only when the number changed. |
| Page updates | The service tells the page about new totals at most once every 5 seconds, and only while the app is on screen (the plugin stops sending when the app is stopped). |
| Watchdog | One WorkManager job every **15 minutes** (Android's minimum). It restarts the service only if it has gone quiet for over 4 minutes. At most 96 very small runs a day. |
| Midnight | One alarm per day to split the day cleanly. |
| Home-screen widget | No polling. Redrawn when the page sends a snapshot, when the date changes (and at the midnight alarm), and by the step service at most once a minute and only if the step count changed; the work runs on a background thread and skips entirely when no widget is placed. |
| Vehicle detection | Google's Activity Recognition pushes transitions to us (no polling). Location is **off** unless you switch on the speed check or trip distance (see Travel record), and trip distance asks for location **only while a vehicle or bike trip is on**. |
| Wake locks | **None** on phones with the step counter chip. The accelerometer fallback (phones without that chip) holds a partial wake lock with a 60 second timeout that the tick renews, and releases it when the service stops. That mode uses much more battery. |
| The page (WebView) | Two seconds after the app leaves the screen the WebView is paused (`onPause` + `pauseTimers`): no JavaScript timers, layout or painting. The page also stops its own 1-minute refresh and queued sync timers when it is hidden, and a "network is back" sync only runs while the app is visible. Everything resumes when you come back, and the page reads what was counted meanwhile in one call. |
| Cloud sync | Only while the app is open: step updates at most once every **15 minutes**, pull-to-refresh only if the last sync is over **5 minutes** old, ordinary edits as before (immediately), and the usual check when you open the app (at most one full sync per 30 seconds). Nothing syncs in the background. |

In short, with the step counter chip the app wakes roughly every 20 seconds only while you are walking, once every 15 minutes for the watchdog and once a day at midnight, and does no cloud work at all while it is closed.

### Accuracy notes

- The hardware counter is as accurate as your phone's chip. Phones in a hand-held, swinging or pocketed position all work; a phone left in a bag can undercount.
- The rhythm and buffering rules mean the first few steps of a very short walk (under about 10 steps) and a brief shuffle are not counted. That is deliberate.
- Regular pedalling looks like slow walking to a step sensor. Bicycles are rejected by Activity Recognition (so on a phone without Play services, cycling can add steps). The same applies to a very smooth, regular vibration in a vehicle.
- Activity Recognition notices a ride after a minute or so. The hold-back cancels the steps from just before, but a ride longer than the hold-back window before detection can leak a few steps.
- On a bumpy ride with only the accelerometer and no Activity Recognition, a rare stretch of bumps can look like a short walk (about 10 to 15 steps in 10 minutes in our simulations).
- If the service is stopped for a long time, the catch-up from the hardware counter cannot judge rhythm; if part of that time was in a vehicle, at most half of the remaining time is counted as walking.
- Android 14 and newer require the "health" foreground-service permission; it is declared in the manifest. The service declares the "location" type as well only when a location feature is switched on and allowed, and falls back to "health" alone if Android refuses (Android 14 refuses a location service started from the background; the app re-declares it the next time it is opened). Before Android 14 the type is not used for anything but background location, so it is set to match what is granted instead of "whatever the manifest says".
- The day boundary follows the phone's current time zone (read on every use, not once at start-up), and the midnight alarm is booked again when the zone changes.
- Android's automatic backup and phone-to-phone transfer are **off** (`allowBackup=false` plus empty data-extraction rules). The app's stored data holds the cloud sign-in token, health data and the step counter baseline, which are wrong on another phone. Use Settings > Backup (JSON) to move data.
- The share sheet can only read files from `Documents/Comeback` and the app's cache (`res/xml/file_paths.xml`), not the rest of shared storage.

### Travel record

The Progress screen has a **Travel** card: for the range you picked (week, month, 3 months) it shows minutes spent walking, running, cycling and in a vehicle, the number of trips, a small stacked bar per day and a list of trips. It never changes your daily score or streak. It needs step counting to be on (same Physical activity permission) and a phone with Google Play services; otherwise the card says so and shows nothing.

- **What is recorded (always, no location).** From the same Activity Recognition transitions that keep vehicle steps out: minutes per day for walking, running, cycling and in a vehicle (standing still is ignored), stored natively next to the step totals so they survive the app being closed. A **trip** is one vehicle or bicycle journey of at least 2 minutes. A stop shorter than 3 minutes (traffic light, drop-off) does not end it; a longer stop does. A ride that crosses midnight is split by time between the two days, and the trip belongs to the day it started. Up to 50 trips a day are kept.
- **Car or motorbike?** Android cannot tell: both are "in a vehicle". Each vehicle trip carries a label you choose (Car, Motorbike, Other). New trips get your **default vehicle** (Settings > Advanced; saved on this phone only, key `comeback_travel_prefs`); tap a trip in the Progress trip list to change it. Cycling is detected separately.
- **Distance (opt-in, off by default, never asked during onboarding).** Settings > Advanced > **Record distance of vehicle trips**. Turning it on asks for the Location permission. Location updates then run **only while a vehicle or bike trip is active** (balanced power, about every 12 seconds, at least 20 m apart) and stop when it ends. Distance is the sum of the gaps between consecutive fixes; fixes less accurate than 50 m, jumps that imply more than 200 km/h, and wobble smaller than the fix's own error are ignored. Only the **totals** are kept per trip (km and average speed). Coordinates and routes are never stored, logged, or synced: the one previous fix is held in memory to measure the next gap and is not written to storage. Distance is a lower bound: Activity Recognition notices a ride a minute or so late, and nothing is measured before that. Without distance, vehicle trips show minutes only.
- **Distance on foot** is worked out from your steps and height (steps x stride), as everywhere else; it includes running steps.
- **Where it lives.** In the day record as an optional `travel` object (`walk_min, run_min, bike_min, vehicle_min, trips[]`), so it is part of backups, restores, the CSV (Walk, Run, Bike, Vehicle minutes and Vehicle km) and cloud sync. Only those totals and trips go to the cloud, never a position.
- **Android hardening notes.** Location needs the foreground service to declare the "location" type, and Android 14+ only allows that while the app is on screen; if the service was restarted in the background (reboot, alarm) trips are still recorded by time but distance may be missing until the app is opened once. This cannot be tested without a phone. If trips come out short, the priority constant `TRAVEL_PRIORITY` in `StepService.kt` can be raised to high accuracy (more battery while on a trip).

### What is tested where

- `npm run test:android` runs 35 JVM unit tests with **simulated sensors** (no phone needed): walking with the phone in a pocket and in hand, running pace, batched counter reports, reboot reset, midnight split, missed samples (service down while walking, and while in a car), a smooth car ride, a motorbike on a bumpy road, a bicycle ride, short shuffles of 3 to 5 steps, vehicle-to-walking transitions, the speed check, phone shaking, strictness levels and state saving.
- `npm run test:steps` runs 100 browser tests of the web side against a fake plugin (existing users, the read-only Steps card and sheet, no manual entry anywhere, old manual days, permission missing, settings, health states, sync throttling, CSV, backup, Progress, and no page work while hidden).
- `node test/travel-test.mjs` runs the Travel card, trips sheet, vehicle labels, settings rows and `normalizeTravel` edge cases against the fake plugin; the Kotlin tests (`TravelLogTest`, `TimeZoneTest`) cover trips, stops, midnight, process death, distance filtering and time zone changes with simulated transitions and fixes.
- `node test/widget-test.mjs` (51 checks) runs the widget feed against the fake bridge (snapshots for an empty, partial, full, light and rest day, the 1.5 s debounce, sending when the page is hidden, a new day, nothing sent when nothing changed or in a browser); the Kotlin `WidgetModelTest` covers parsing, the staleness rule, the thousands separators, the texts for every state and the ring arc geometry.
- `npm run test:permissions` (54 checks) walks the first-launch permission flow with everything allowed, everything denied and partial answers, every brand, "Show intro again" and a plain browser.
- `npm run test:refresh` (55 checks) sends real touch gestures to pull-to-refresh: the panel and haptic, one plugin read per pull, 1 to 2.5 s timing, the 5-minute sync rule, contextual nudges, the 20-pull no-repeat rule, reduce motion, and the lines file.
- **Needs a real phone:** the actual sensors, Activity Recognition, background survival on your brand, the notification, and the numbers below.

**Check it on your phone**

1. *500-step walk:* note the Steps value (or pull down on Today to refresh it), walk 500 steps counting by hand at a normal pace (phone in a pocket, then another run in your hand), and compare. Expect within about 3 to 5%.
2. *10-minute ride:* start the app counting, then ride 10 minutes in a car or on a motorbike with the phone on you. The Steps value should rise by close to 0 (a handful at most). Check Settings > "Steps filtered out today". Repeat on a bumpy road if you can.
3. Leave it running for a day with the screen off and see that the notification is still there and the total is sensible.

## Cloud sync (optional)

The app works fully without an account. If you want your log on more than one phone, or safe in the cloud, sync it with a free account.

**Create an account**
1. Open **Settings** (the gear) **> Account and sync > Sign in to sync**.
2. Enter your email and a password (at least 6 characters) and tap **Create account**.
3. Supabase emails you a confirmation link. Tap it, then come back and tap **Sign in**. Until you confirm, the app says "Check your email to confirm your account, then sign in."
4. On another phone, install the app and sign in with the same email and password. Your whole history downloads.

**How sync works**
- The phone always keeps its own copy and the app reads from that. The cloud is a second copy.
- Every time you save a day (or change your plan) the change is sent to the cloud straight away.
- When you open the app, come back to it, sign in, or tap **Sync now**, the app downloads everything in your account and compares it with the phone, day by day, and anything the cloud is missing is uploaded. The phone remembers the cloud version of each day it last saw, so it can tell "only the cloud changed", "only this phone changed" and "both changed". Only one side changed: that side wins (so removing a value sticks). Both changed the same day (for example the steps counted on one phone and the water logged on another): the two are merged field by field. Every habit value and rule from both is kept; where both have the same one, the newer save wins; steps keep the higher count with its fuller step details; weight, waist and note come from the newer save unless it is empty.
- Save times are read as at most 5 minutes in the future, so a phone with a wrong clock cannot win forever. A day with no save time (an old backup) is merged, never blindly replaced, and gets a real time when it is uploaded.
- The first time you sign in on a phone that already has entries, those entries are uploaded. Your plan from onboarding (the starter plan and targets) does not count as an edit: signing in to an account that already has settings brings that account's plan, and a phone with nothing logged and no earlier sync always takes the account's plan. A plan you changed yourself later is kept and uploaded.
- Plan and settings are stored in the cloud as version 2. If an older app version uploads its older shape (habits and rules only), this app reads it, keeps your layout (sections, order, schedules, hidden habits, units, body and preferences), adds new habits, takes changed names and targets, renames rule ids that clash with habit ids (in the days too), and writes version 2 back. Settings from a newer app version are not read or overwritten.
- A cloud change arrives into the plan you are looking at without replacing it, so a habit sheet that is open stays valid, and pressing Done still saves your edit.
- Restoring a backup while signed in also sends the restored days to the cloud. If you choose **Replace everything**, days that exist only in the cloud come back on the next sync.
- **Sign out** keeps all your entries on the phone. They stop syncing until you sign in again.
- The sync line on the card shows "Syncing…", "Synced at <time>", "<n> changes waiting to sync", or the error.

**Offline**
- Saving works without internet. Changes that couldn't be sent wait in a queue on the phone ("2 changes are waiting to sync").
- The queue is sent automatically when you open the app, when you return to it, and when the connection comes back. The queue survives closing the app.
- If two phones edited the same day while one was offline, the two versions are merged field by field when the offline one reconnects (see above).

**Letting anyone register (owner setup, one time)**

By default a new Supabase project only sends sign up emails to people on your Supabase team (and only a few per hour), and it links to a "Site URL" of `localhost`. So out of the box only you could register. Pick one of these in the Supabase dashboard for the `reset-log` project:

- **Simplest: no confirmation email.** Authentication > Sign In / Providers > Email > turn **off** "Confirm email" > Save. Anyone can then create an account in the app and is signed in straight away. No email is sent. The downside is that addresses aren't verified, and you can't send password resets.
- **Keep the confirmation email.** Project Settings > Authentication > SMTP Settings > turn on **Custom SMTP** and enter the details from an email service (for example Resend, Brevo or Postmark). Then set Authentication > URL Configuration > Site URL to a page you control, because the link in the email opens a browser, not the app.

Either way every account gets its own rows. Row Level Security means one user can never read or change another user's entries.

**Privacy.** Your data is stored in a Supabase database with Row Level Security: your account can only read and write its own rows. The app only contains the project's publishable key (`www/config.js`), never an admin key. The auto backup and export files described below still work the same, signed in or not.

## Where backups are stored

- **Automatic:** every time you save a day (or change your plan), the app writes your full data to `Documents/Comeback/comeback-autobackup.json`. It also keeps one copy per day as `comeback-autobackup-YYYY-MM-DD.json` for the last 7 days; older ones are deleted.
- **Manual:** Settings > Backup > *Export backup (JSON)* saves `comeback-backup-YYYY-MM-DD.json` in the same folder and opens the share sheet (Drive, WhatsApp, email...). *Export as spreadsheet (CSV)* does the same with a one-row-per-day file you can open in Excel or Sheets.
- Before a restore, the app saves what is on the phone as `comeback-before-restore.json` in that folder.
- "Last backup" on the Backup card shows when a backup was last written.

**If saved data is damaged.** When the app starts, a day that cannot be read is set aside on its own: every other day loads, Settings > Backup says which dates were set aside, and the raw records are kept on the phone (`comeback_quarantine_*`). If the whole saved copy cannot be read, the app does not write over it and leaves the automatic backup files alone. New entries are kept apart and come back on the next start, and Settings > Backup shows **Recover the unreadable copy**, which runs the kept copy through the usual restore dialog (readable days are taken; a damaged plan is replaced by the default one, or kept as it is on Merge). Restoring any good backup file also unlocks saving. Only the newest 3 kept copies of each kind are stored. Restoring a backup file is still strict: one bad day refuses the file. `npm run test:datasafety` covers all of this.

## Restore on a new phone

1. Install the APK on the new phone.
2. Copy a backup file to the phone (from Drive, WhatsApp, email, or `Documents/Comeback/`).
3. Open Comeback > **Settings** (the gear) > **Restore from backup** and pick the `.json` file.
4. The app shows how many days it contains. Choose **Merge** (keeps what is on the phone; for a day that exists in both, the newer save wins) or **Replace everything**.

Backups use this shape. Version 1 files (made by earlier versions) still restore: they are moved into this structure on the way in.

```json
{ "version": 2,
  "settings": { "v": 2, "habits": [], "sections": [], "body": { "heightCm": null, "scale": "standard" }, "units": { "weight": "kg", "length": "cm" }, "prefs": { "suggestions": true } },
  "days": { "YYYY-MM-DD": { "vals": {}, "rules": {}, "weight": null, "waist": null, "note": "", "date": "YYYY-MM-DD", "updatedAt": 0 } } }
```

## Build it yourself

You need Node 22, JDK 21 and the Android SDK (platform 36).

```bash
npm ci
npm run build:apk        # bundles plugins, syncs www/ into android/, runs Gradle
# result: android/app/build/outputs/apk/debug/app-debug.apk
```

- The web app is `www/index.html` with `www/css/app.css`, `www/js/core.js` (the pure logic: habit types, schedules, scores and streaks, suggestions, the library and starter plans, BMI and units, the migration), `www/js/logic.js` (data, storage, backup, reminder, sync), and the screens: `ui.js` (sheets, Progress, onboarding, navigation), `today.js`, `plan.js`, `settings.js`, `body.js` (BMI and body units), `timer.js` (the habit timer, with `css/timer.css`) and `app.js` (start-up). The Capacitor plugins and supabase-js are bundled from `src/native.js` into `www/vendor/native.js`, and the Lucide icons into `www/vendor/icons.js`, by `npm run build:web`.
- `node test/reminders-test.mjs` (smarter and per-habit reminders against a recording notification mock and a fixed clock, the timer, quick-add chips, anchors and the first-week ramp).
- `npm run test:dates` (calendar maths under other time zones, "Yesterday" after a clock change, the midnight rollover with the app open), `npm run test:core` (pure logic: types, schedules, scores, streaks, suggestions, library, starter plans, BMI, units and the migration), `npm run test:structure` (the new Today, edit mode, library, starter plans, suggestions, Settings, BMI and migration in a browser), `npm run test:responsive` (10 screen sizes x light and dark: no sideways scrolling, tap targets, sheets and keypads fit, bars clear the content, large text, glass effects and low-end fallback), `npm run test:rename` (old-data move, old backups still restore, new copy, no leftover old name or medical wording), `npm run lint:android` (Android lint, warnings count as errors), `npm run test:android` (Kotlin sensor tests), `npm run test:steps` (step tracking UI) and `npm run test:contrast` (WCAG AA colour contrast). `npm run test:web` and `npm run test:sync` run the headless-browser tests (they need a Chromium for Playwright). `test:sync` uses a fake Supabase server; `npm run test:real` runs the same kind of checks against the real project and needs `E2E_EMAIL` and `E2E_PASSWORD` of an existing confirmed user.
- `supabase/migrations/` holds the SQL that creates the two tables and their security policies. The Supabase URL and publishable key are in `www/config.js`.
- `npm run assets` regenerates icons and splash screens from `assets/`.

### Rebuild on GitHub

`.github/workflows/build-apk.yml` builds the debug APK on every push to `main` (and on demand from the Actions tab). Open the run and download the **Comeback-debug-apk** artifact.


## Icon, splash and store files

- The Comeback mark (an open "C" that rises into an upward arrow, white on dark slate `#1C2629`) is defined once in `scripts/glyph.mjs`. `npm run brand` draws the icon, the adaptive icon layers, the Android 13 themed (monochrome) icon, the splash screens, the notification icon and the Play Store graphics from it, then lets `@capacitor/assets` cut the Android sizes.
- `store/icon-512.png` (512 x 512), `store/feature-graphic-1024x500.png` and `store/listing.md` (title, short and full description) are the Play Store listing draft.
