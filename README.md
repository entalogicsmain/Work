# Reset Log

A personal daily health tracker (workouts, steps, rules, weight, waist, notes, progress charts) packaged as an offline Android app with Capacitor.

- App ID: `com.umar.resetlog` — minSdk 23, target SDK 36
- Works fully offline (Chart.js and the Barlow fonts are bundled)
- Data is stored with Capacitor Preferences on the phone
- Backup, restore, a daily reminder and optional cloud sync are on the **My plan** tab

## Install the APK

1. Get `release/ResetLog-debug.apk` onto your phone (download it from this repo, or take it from the latest GitHub Actions run, see below).
2. Open it. Android will ask you to allow **Install unknown apps** for the app you opened it from (Files, Chrome, etc.). Allow it, then tap Install.
3. Open **Reset Log**. On Android 13+ the first time you switch the daily reminder on, allow notifications.

Every build uses the same signing key, so a newer APK installs straight over an older one and keeps your data. Don't uninstall first, because uninstalling deletes the app's data.

## Cloud sync (optional)

The app works fully without an account. If you want your log on more than one phone, or safe in the cloud, sync it with a free account.

**Create an account**
1. Open **My plan > Cloud sync > Sign in to sync**.
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

**Privacy.** Your data is stored in a Supabase database with Row Level Security: your account can only read and write its own rows. The app only contains the project's publishable key (`www/config.js`), never an admin key. The auto backup and export files described below still work the same, signed in or not.

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
- `npm run test:web` and `npm run test:sync` run the headless-browser tests (they need a Chromium for Playwright). `test:sync` uses a fake Supabase server; `npm run test:real` runs the same kind of checks against the real project and needs `E2E_EMAIL` and `E2E_PASSWORD` of an existing confirmed user.
- `supabase/migrations/` holds the SQL that creates the two tables and their security policies. The Supabase URL and publishable key are in `www/config.js`.
- `npm run assets` regenerates icons and splash screens from `assets/`.

### Rebuild on GitHub

`.github/workflows/build-apk.yml` builds the debug APK on every push to `main` (and on demand from the Actions tab). Open the run and download the **ResetLog-debug-apk** artifact.
