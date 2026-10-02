// Draws the Comeback icon, adaptive-icon layers, monochrome icon, splash, notification icon and Play Store graphics
// from the single glyph in scripts/glyph.mjs, then lets @capacitor/assets cut the Android densities.
//   npm run brand
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { BG, ARC, HEAD, STROKE, BOUNDS, glyphSvg } from './glyph.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(root, ...a);
const svgDoc = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const png = (svg, out) => sharp(Buffer.from(svg)).png().toFile(out);
const bg = (w, h, c = BG) => `<rect width="${w}" height="${h}" fill="${c}"/>`;

fs.mkdirSync(P('assets'), { recursive: true });
fs.mkdirSync(P('store'), { recursive: true });

// 1. Capacitor asset sources
await png(svgDoc(1024, 1024, bg(1024, 1024)), P('assets/icon-background.png'));                              // adaptive background layer
await png(svgDoc(1024, 1024, glyphSvg({ cx: 512, cy: 512, height: 600 })), P('assets/icon-foreground.png')); // adaptive foreground layer (stays inside the safe zone)
await png(svgDoc(1024, 1024, bg(1024, 1024) + glyphSvg({ cx: 512, cy: 512, height: 640 })), P('assets/icon-only.png'));
for (const f of ['splash.png', 'splash-dark.png'])
  await png(svgDoc(2732, 2732, bg(2732, 2732) + glyphSvg({ cx: 1366, cy: 1366, height: 560 })), P('assets', f));

// 2. Play Store images
await png(svgDoc(512, 512, bg(512, 512) + glyphSvg({ cx: 256, cy: 256, height: 330 })), P('store/icon-512.png'));

const GW = Math.ceil(232 * (BOUNDS.x1 - BOUNDS.x0) / (BOUNDS.y1 - BOUNDS.y0)) + 8;   // glyph box width at 232 px tall
const fontB64 = fs.readFileSync(P('www/fonts/inter-latin.woff2')).toString('base64');
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontB64}) format('woff2');font-weight:100 900}
html,body{margin:0;width:1024px;height:500px;background:${BG};overflow:hidden;font-family:Inter,sans-serif;color:#fff}
.wrap{display:flex;align-items:center;gap:56px;height:500px;padding:0 90px;box-sizing:border-box}
h1{font-size:104px;line-height:1;margin:0 0 18px;font-weight:700;letter-spacing:-2px}
p{font-size:34px;line-height:1.3;margin:0;color:#B9C7CC;font-weight:500}
</style><div class="wrap">${svgDoc(GW, 240, glyphSvg({ cx: GW / 2, cy: 120, height: 232 }))}<div><h1>Comeback</h1><p>Track habits. Count steps.<br>Get back to your best.</p></div></div>`;
const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const pg = await browser.newPage({ viewport: { width: 1024, height: 500 } });
await pg.setContent(html);
await pg.evaluate(() => document.fonts.ready);
await pg.screenshot({ path: P('store/feature-graphic-1024x500.png') });
await browser.close();

// 3. Generate Android icon and splash densities
execSync('npx capacitor-assets generate --android --iconBackgroundColor "' + BG + '" --splashBackgroundColor "' + BG + '" --splashBackgroundColorDark "' + BG + '"', { cwd: root, stdio: 'inherit' });

// 4. Vector drawables: monochrome (Android 13 themed icon) and the status bar icon.
const vec = (size, view, scale, strokeWidth, color, tint) => {
  const cx = (BOUNDS.x0 + BOUNDS.x1) / 2, cy = (BOUNDS.y0 + BOUNDS.y1) / 2;
  const t = `translateX="${view / 2}" translateY="${view / 2}"`;
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp" android:height="${size}dp" android:viewportWidth="${view}" android:viewportHeight="${view}">
    <group android:scaleX="${scale}" android:scaleY="${scale}" android:translateX="${view / 2 - cx * scale}" android:translateY="${view / 2 - cy * scale}">
        <path android:pathData="${ARC}" android:strokeColor="${color}" android:strokeWidth="${STROKE}" android:strokeLineCap="round" android:strokeLineJoin="round" />
        <path android:pathData="${HEAD}" android:strokeColor="${color}" android:strokeWidth="${STROKE}" android:strokeLineCap="round" android:strokeLineJoin="round" />
    </group>
</vector>
`;
};
const h = BOUNDS.y1 - BOUNDS.y0;
fs.writeFileSync(P('android/app/src/main/res/drawable/ic_launcher_monochrome.xml'), vec(108, 108, 60 / h, STROKE, '#FFFFFF'));
fs.writeFileSync(P('android/app/src/main/res/drawable/ic_stat_comeback.xml'), vec(24, 24, 21 / h, STROKE, '#FFFFFF'));

// 5. Adaptive icon XML with the monochrome layer for themed icons
for (const n of ['ic_launcher', 'ic_launcher_round']) {
  const file = P('android/app/src/main/res/mipmap-anydpi-v26', n + '.xml');
  let x = fs.readFileSync(file, 'utf8').replace(/\s*<monochrome[^>]*\/>/, '');
  x = x.replace('</adaptive-icon>', '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n</adaptive-icon>');
  fs.writeFileSync(file, x);
}
console.log('brand assets written');
