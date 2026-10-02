# Comeback

Comeback is a habit tracker for getting back to your best, one day at a time: habits that fit your week, automatic step counting, weight, waist, BMI, notes and progress charts, packaged as an offline Android app with Capacitor. Developer: EntaLogics.

- App ID: `com.entalogics.comeback` — minSdk 23, target SDK 36
- Works fully offline (Chart.js, the Inter font and the icons are bundled)
- Data is stored with Capacitor Preferences on the phone
- Three tabs: **Today** (what to do now), **Progress** (how it is going, including BMI) and **Plan** (your goals). Account and sync, backup, the daily reminder, step tracking health, permissions, units and body details live in **Settings**, behind the gear in the top-right corner of every screen.

## Design

The UI follows the principles behind Apple's Human Interface Guidelines (clarity, deference, depth, consistency) with an original look. It uses no Apple fonts, icons or branding: the typeface is **Inter** and the icons are **Lucide** (1.75px stroke), both bundled locally (see `THIRD_PARTY.md`).

- **Glass look:** frosted, translucent surfaces (cards, the top bar, the floating tab bar, sheets, the toast) over a soft aurora backdrop, with a thin light edge and a gentle shadow. Contrast is checked against the worst colours the glass can sit on (`npm run test:contrast`). Phones with little memory or few cores keep the translucency but drop the blur on cards, and if Android asks for less transparency (or the WebView has no backdrop blur) every surface becomes solid.
- **Responsive:** one layout that adapts from a 280 px folded cover screen to a desktop window. Phones get a floating bottom tab bar; from 600 px targets and stats use three columns; from 840 px (tablets, landscape) the tab bar becomes a side rail, Today splits into a sticky summary and a targets grid, Progress and Plan use two columns and sheets open as centred dialogs. Short landscape screens get a tighter layout, notches and cut-outs are respected, and 130% and 160% text sizes still fit (`npm run test:responsive`).
- **Today:** the date as a large title, one progress ring, and your habits in sections (see below). Every change saves by itself, shows "Saved", and can be undone for 5 seconds.
- **Progress:** Week / Month / 3 Months, stat tiles, a **Body** section with the BMI card on top, a trend chart you can touch and drag across to read exact values, a calendar of soft squares (tap a day to open it), and recent days.
- **Plan:** your goals only: habits grouped by section with their targets and schedules, the habit library, "Create your own", and the sections. Swipe a row left to remove it (with confirmation), use Reorder to drag habits inside a section.
- **Settings:** Account and sync, Backup, Reminder, Step tracking (Android app), Permissions (Android app), Units, Body (height, BMI scale), Suggestions, and a collapsed **Advanced** (vehicle filter strictness, accelerometer sensitivity, location accuracy).
- **Feel:** light haptics on taps, a success haptic when a target is reached, a short celebration when the whole day is done, and neutral wording on quiet days ("Not logged", "Start again today"). Reduce-motion turns animations into simple fades.
- **Accessibility:** works at 130% text size, 44px minimum tap targets, labelled controls, text summaries for the ring and chart, status never shown by colour alone, and WCAG AA contrast in light and dark (`npm run test:contrast`).

## How Comeback is organised

**Today is grouped into sections:** *Movement* (Steps, which are counted by the phone and read-only, and Brisk walk), *Workout* (pushups, pull-ups, squats, plank and your own workouts), *Health* (water, sleep), *Food rules* (a tick list) and *Body and notes* (weight, waist, BMI and the note; collapsed until you open it). Any habit can be moved to any section, and you can add your own sections.

**Four habit types**

| Type | How you log it | Examples |
| --- | --- | --- |
| Count | A card with + and − (tap the number to type one) | pushups, water |
| Duration | A card with quick +5 / +10 minute (or seconds) presets | plank, brisk walk |
| Yes/No | One tap on a switch | no sugar, vitamins |
| Steps | Automatic and read-only, counted by the phone | steps |

Weight and waist are measurements (they open a number pad). Habits you had before were turned into these types for you (see Migration below).

**Schedules.** Every day, Specific days, X times per week, or Every N weeks. Only habits that are due today show on Today, the daily score and the streak only count habits that were due that day, and X-per-week habits show "2 of 3 this week". Weight defaults to 3 times a week and waist to every 2 weeks; everything else is daily.

**Streaks.** A day is kept when its score is 50% or more (counting only what was due). The streak is the number of kept days in a row, rest days skipped. Today counts once it reaches 50%; until then the streak is counted from yesterday, so it never drops while the day is still open (Today says, for example, "12-day streak · today still open"). A day that holds nothing (for example after undoing the only change of the day) is not a logged day. Progress also shows "Kept 31 of 35 due days in the last 5 weeks". Steps is always the habit with the id `steps`; any other habit that only has a steps unit is a plain Count.

**Finished cards shrink.** When a target is met its card becomes one compact row with a ✓. Tap it to open the card again.

**Customise Today.** Long-press any card, or tap *Edit Today* at the bottom, to enter edit mode: drag the handles to reorder cards and sections (or move a card into another section), tap *Hide* to take a card off Today (it stays in Plan and waits in a tray to be shown again), tap **+** on a section to add from the library, and tap *Done*. Arrow keys work on the handles too. The layout is saved on the phone and travels with your settings when you sync.

**Habit library and "Create your own".** A searchable library with icons and sensible default types and targets: Movement (walk, run, cycling, stretching, stand-up breaks), Strength (pushups, pull-ups, squats, plank, lunges, sit-ups), Health (water, sleep, vitamins, weight, waist), Food (no sugar, no sugary drinks, no fried food, no maida, no late eating, eat vegetables, protein with every meal) and Mind (meditation, reading, no phone before bed, journaling). *Create your own* takes a name, icon, type, target, unit, schedule and section.

**Starter plans.** On a fresh install, after the welcome page and before the permission screen: *Desk worker reset*, *Beginner fitness*, *Weight loss* or *Start from scratch*. People who already have data are not shown them.

**Smart target suggestions.** When a Count or Duration habit has hit its target on 5 due days in a row, Today says, for example, "You've hit 30 pushups 5 days straight. Try 35?" with **Raise target** or **Not now** (about 10 to 20 percent more, on a round number; "Not now" keeps it quiet for 7 days). Turn it off in Settings > Suggestions.

## BMI

- **Where:** a card at the top of Progress > Body (BMI, category, a small trend line), and the Body section of Today shows BMI next to your latest weight. Tap either to open the detail sheet.
- **How:** BMI = kg ÷ m², calculated from the height in Settings and your latest logged weight, and recalculated whenever either changes. It is never stored. With no weight it says "Log your weight to see your BMI" (with a button), and with no height "Set your height to see your BMI".
- **Two scales** (Settings > Body > BMI scale; onboarding asks right after the height, and says the Asian scale is recommended for South, East and Southeast Asian backgrounds; Standard is the default if you skip it):

| Scale | Underweight | Normal | Overweight | Obese |
| --- | --- | --- | --- | --- |
| Standard (WHO) | under 18.5 | 18.5 to 24.9 | 25 to 29.9 | 30 and over |
| Asian (WHO Asia-Pacific) | under 18.5 | 18.5 to 22.9 | 23 to 24.9 | 25 and over |

  For 180 cm and 87 kg the BMI is 26.9: Overweight on Standard, Obese on Asian. Categories use colour and text together.
- **Detail sheet:** the large BMI and category, a horizontal scale bar with a marker, the healthy weight range for your height on the selected scale, a neutral distance to that range ("6.3 kg to the healthy range"), waist-to-height ratio when a waist is logged (under 0.5 healthy, 0.5 and above elevated), a BMI trend chart (week, month, 3 months), a **Quick calculator** for any height and weight (it saves nothing), and the note that BMI is a general screening measure that does not account for muscle mass and is not a medical diagnosis.
- **Units** (Settings > Units): kg or lb, cm or ft/in. Everything is stored in kg and cm. Height, units and the BMI scale are part of the synced settings. The CSV export has a BMI column for days with a weight.

## Migration from the earlier structure

Everything you had is kept and moved into the new structure the first time the new version starts (and again, harmlessly, on every start after that):

- Every day record is unchanged (`vals`, `rules`, `weight`, `waist`, `note`, `steps_meta`). Old and new backups and the cloud rows need no data rewrite.
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

First launch: welcome, starter plans, targets, reminder, height, BMI scale, and (Android app) the permission screen.

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

**First launch:** after the welcome, starter plan, targets and reminder screens there is one screen, **"Let Comeback track for you"**, that explains in a line each why Comeback needs *Physical activity* (to count steps and pause counting in vehicles), *Notifications* (for the daily reminder and the step counter notification) and *Battery* (so counting keeps running in the background). One **Allow and continue** button asks for them one after another: Physical activity, then Notifications (Android 13+), then Android's "run in the background" dialog. On Xiaomi, Oppo, Realme, Vivo, Samsung, Infinix, Tecno, itel, Huawei and Honor phones a brand screen follows, with a button that opens the right settings page (you can skip it). Then your height (optional; used for the distance estimate and for BMI) and the BMI scale, and the step service starts straight away. **Location is never asked for during onboarding**; the optional "Use location to improve accuracy in vehicles" switch in Settings > Advanced stays off until you turn it on.

**If you say No:** onboarding carries on and the app works fully for habits. The Steps card on Today says **Turn on step counting** instead of a number (tap it to try again), and Settings > Step tracking > **Step tracking health** shows what is wrong (*Permission missing*, *Paused by battery settings*) with a one-tap fix.

**Updating from an older version:** if Physical activity is already allowed, counting simply switches on. If not, the same permission screen shows once on the next launch.

**On the Steps card (Today):** the live count from the sensor, the target, a progress bar and the estimated distance (stride = 0.415 x height), with the label **Counted by phone**. Tap it for a read-only sheet: today's hourly chart, the distance, the source, **steps filtered out** by the vehicle filtering, and the tracking health. The daily Steps **target** is still editable in Plan.

**Days entered by hand in earlier versions** keep their numbers. They are marked **Entered manually (old)** on the Steps card, in the history list, in the day sheet and in chart tooltips, and the phone never overwrites them (only today is taken over by the phone's count). In the CSV export old rows keep the source `manual`; new days are `counted`.

**Progress:** average steps and average distance for the chosen range (Week / Month / 3 Months), the Steps chart tells you for each day whether it was counted or entered manually (old), and an hourly bar chart shows when you were active today.

**What is stored (per day, inside the normal day record):** `vals.steps` plus `steps_meta`: `source` (`auto`, or `manual` on old days), `counted`, `distance_km`, `filtered`, and `hourly` (24 buckets). It is part of the JSON backup, the CSV export (columns *Steps source*, *Distance (km)*, *Filtered steps*) and cloud sync. Step updates reach the cloud at most once every 15 minutes, and never overwrite an old manual day. Device settings (height, detection, speed check, pull-to-refresh history) stay on this phone.

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
| Vehicle detection | Google's Activity Recognition pushes transitions to us (no polling). Location is **off** unless you switch on the speed check. |
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
- Android 14 and newer require the "health" foreground-service permission; it is declared in the manifest.

### What is tested where

- `npm run test:android` runs 35 JVM unit tests with **simulated sensors** (no phone needed): walking with the phone in a pocket and in hand, running pace, batched counter reports, reboot reset, midnight split, missed samples (service down while walking, and while in a car), a smooth car ride, a motorbike on a bumpy road, a bicycle ride, short shuffles of 3 to 5 steps, vehicle-to-walking transitions, the speed check, phone shaking, strictness levels and state saving.
- `npm run test:steps` runs 100 browser tests of the web side against a fake plugin (existing users, the read-only Steps card and sheet, no manual entry anywhere, old manual days, permission missing, settings, health states, sync throttling, CSV, backup, Progress, and no page work while hidden).
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
- When you open the app, come back to it, sign in, or tap **Sync now**, the app downloads everything in your account and compares it with the phone, day by day. The version with the newer save time wins, and anything the cloud is missing is uploaded.
- The first time you sign in on a phone that already has entries, those entries are uploaded.
- Restoring a backup while signed in also sends the restored days to the cloud. If you choose **Replace everything**, days that exist only in the cloud come back on the next sync.
- **Sign out** keeps all your entries on the phone. They stop syncing until you sign in again.
- The sync line on the card shows "Syncing…", "Synced at <time>", "<n> changes waiting to sync", or the error.

**Offline**
- Saving works without internet. Changes that couldn't be sent wait in a queue on the phone ("2 changes are waiting to sync").
- The queue is sent automatically when you open the app, when you return to it, and when the connection comes back. The queue survives closing the app.
- If two phones edited the same day while one was offline, the later save wins when the offline one reconnects.

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

- The web app is `www/index.html` with `www/css/app.css`, `www/js/core.js` (the pure logic: habit types, schedules, scores and streaks, suggestions, the library and starter plans, BMI and units, the migration), `www/js/logic.js` (data, storage, backup, reminder, sync), and the screens: `ui.js` (sheets, Progress, onboarding, navigation), `today.js`, `plan.js`, `settings.js`, `body.js` (BMI and body units) and `app.js` (start-up). The Capacitor plugins and supabase-js are bundled from `src/native.js` into `www/vendor/native.js`, and the Lucide icons into `www/vendor/icons.js`, by `npm run build:web`.
- `npm run test:dates` (calendar maths under other time zones, "Yesterday" after a clock change, the midnight rollover with the app open), `npm run test:core` (pure logic: types, schedules, scores, streaks, suggestions, library, starter plans, BMI, units and the migration), `npm run test:structure` (the new Today, edit mode, library, starter plans, suggestions, Settings, BMI and migration in a browser), `npm run test:responsive` (10 screen sizes x light and dark: no sideways scrolling, tap targets, sheets and keypads fit, bars clear the content, large text, glass effects and low-end fallback), `npm run test:rename` (old-data move, old backups still restore, new copy, no leftover old name or medical wording), `npm run lint:android` (Android lint, warnings count as errors), `npm run test:android` (Kotlin sensor tests), `npm run test:steps` (step tracking UI) and `npm run test:contrast` (WCAG AA colour contrast). `npm run test:web` and `npm run test:sync` run the headless-browser tests (they need a Chromium for Playwright). `test:sync` uses a fake Supabase server; `npm run test:real` runs the same kind of checks against the real project and needs `E2E_EMAIL` and `E2E_PASSWORD` of an existing confirmed user.
- `supabase/migrations/` holds the SQL that creates the two tables and their security policies. The Supabase URL and publishable key are in `www/config.js`.
- `npm run assets` regenerates icons and splash screens from `assets/`.

### Rebuild on GitHub

`.github/workflows/build-apk.yml` builds the debug APK on every push to `main` (and on demand from the Actions tab). Open the run and download the **Comeback-debug-apk** artifact.


## Icon, splash and store files

- The Comeback mark (an open "C" that rises into an upward arrow, white on dark slate `#1C2629`) is defined once in `scripts/glyph.mjs`. `npm run brand` draws the icon, the adaptive icon layers, the Android 13 themed (monochrome) icon, the splash screens, the notification icon and the Play Store graphics from it, then lets `@capacitor/assets` cut the Android sizes.
- `store/icon-512.png` (512 x 512), `store/feature-graphic-1024x500.png` and `store/listing.md` (title, short and full description) are the Play Store listing draft.
