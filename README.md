# Reset Log

A personal daily health tracker (workouts, steps, rules, weight, waist, notes, progress charts) packaged as an offline Android app with Capacitor.

- App ID: `com.umar.resetlog` — minSdk 23, target SDK 36
- Works fully offline (Chart.js and the Barlow fonts are bundled)
- Data is stored with Capacitor Preferences on the phone
- Backup, restore and a daily reminder notification are on the **My plan** tab

## Install the APK

1. Get `release/ResetLog-debug.apk` onto your phone (download it from this repo, or take it from the latest GitHub Actions run, see below).
2. Open it. Android will ask you to allow **Install unknown apps** for the app you opened it from (Files, Chrome, etc.). Allow it, then tap Install.
3. Open **Reset Log**. On Android 13+ the first time you switch the daily reminder on, allow notifications.

Every build uses the same signing key, so a newer APK installs straight over an older one and keeps your data. Don't uninstall first, because uninstalling deletes the app's data.

## Where backups are stored

- **Automatic:** every time you save a day (or change your plan), the app writes your full data to `Documents/ResetLog/resetlog-autobackup.json`. It also keeps one copy per day as `resetlog-autobackup-YYYY-MM-DD.json` for the last 7 days; older ones are deleted.
- **Manual:** My plan > Backup > *Export backup (JSON)* saves `resetlog-backup-YYYY-MM-DD.json` in the same folder and opens the share sheet (Drive, WhatsApp, email...). *Export as spreadsheet (CSV)* does the same with a one-row-per-day file you can open in Excel or Sheets.
- Before a restore, the app saves what is on the phone as `resetlog-before-restore.json` in that folder.
- "Last backup" on the Backup card shows when a backup was last written.

## Restore on a new phone

1. Install the APK on the new phone.
2. Copy a backup file to the phone (from Drive, WhatsApp, email, or `Documents/ResetLog/`).
3. Open Reset Log > **My plan** > **Restore from backup** and pick the `.json` file.
4. The app shows how many days it contains. Choose **Merge** (keeps what is on the phone; for a day that exists in both, the newer save wins) or **Replace everything**.

Backups use this shape, so old and new backups stay compatible:

```json
{ "version": 1,
  "settings": { "habits": [], "rules": [] },
  "days": { "YYYY-MM-DD": { "vals": {}, "rules": {}, "weight": null, "waist": null, "note": "", "date": "YYYY-MM-DD", "updatedAt": 0 } } }
```

## Build it yourself

You need Node 22, JDK 21 and the Android SDK (platform 36).

```bash
npm ci
npm run build:apk        # bundles plugins, syncs www/ into android/, runs Gradle
# result: android/app/build/outputs/apk/debug/app-debug.apk
```

- The web app is `www/index.html`. The Capacitor plugins are bundled from `src/native.js` into `www/vendor/native.js` by `npm run build:web`.
- `npm run test:web` runs the headless-browser tests (needs a Chromium for Playwright).
- `npm run assets` regenerates icons and splash screens from `assets/`.

### Rebuild on GitHub

`.github/workflows/build-apk.yml` builds the debug APK on every push to `main` (and on demand from the Actions tab). Open the run and download the **ResetLog-debug-apk** artifact.
