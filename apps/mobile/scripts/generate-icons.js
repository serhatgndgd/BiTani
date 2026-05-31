#!/usr/bin/env node
/**
 * PNG icon generator for BiTanı — uses rsvg-convert (brew install librsvg).
 *
 * Usage:
 *   node apps/mobile/scripts/generate-icons.js
 *
 * Outputs (to apps/mobile/assets/):
 *   icon.png          1024×1024  — App icon
 *   adaptive-icon.png 1024×1024  — Android adaptive icon foreground
 *   favicon.png         64×64   — Web favicon
 *   splash.png        1242×2688  — Splash screen (icon centred on #0F172A)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const LOGO_SVG = path.join(ASSETS, 'logo', 'logo.svg');
const SPLASH_SVG = path.join(ASSETS, 'logo', '_splash_tmp.svg');

const SPLASH_BG = '#0F172A';
const SPLASH_W = 1242;
const SPLASH_H = 2688;
const ICON_PX = 320; // icon size inside the splash

function writeSplashSvg() {
  const ix = (SPLASH_W - ICON_PX) / 2;
  const iy = (SPLASH_H - ICON_PX) / 2 - 60;
  const logoContent = fs.readFileSync(LOGO_SVG, 'utf8');
  const innerMatch = logoContent.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  const inner = innerMatch ? innerMatch[1] : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SPLASH_W} ${SPLASH_H}" width="${SPLASH_W}" height="${SPLASH_H}">
  <rect x="0" y="0" width="${SPLASH_W}" height="${SPLASH_H}" fill="${SPLASH_BG}"/>
  <g transform="translate(${ix}, ${iy}) scale(${ICON_PX / 1024})">
    ${inner}
  </g>
</svg>`;

  fs.writeFileSync(SPLASH_SVG, svg, 'utf8');
}

function convert(svgPath, outPath, w, h) {
  execSync(
    `rsvg-convert -w ${w} -h ${h} -o "${outPath}" "${svgPath}"`,
    { stdio: 'inherit' }
  );
}

function main() {
  console.log('BiTanı icon generator starting…\n');

  if (!fs.existsSync(LOGO_SVG)) {
    console.error('SVG bulunamadı:', LOGO_SVG);
    process.exit(1);
  }

  writeSplashSvg();

  const targets = [
    { name: 'icon.png',          svg: LOGO_SVG,   w: 1024, h: 1024 },
    { name: 'adaptive-icon.png', svg: LOGO_SVG,   w: 1024, h: 1024 },
    { name: 'favicon.png',       svg: LOGO_SVG,   w:   64, h:   64 },
    { name: 'splash.png',        svg: SPLASH_SVG, w: SPLASH_W, h: SPLASH_H },
  ];

  for (const { name, svg, w, h } of targets) {
    const out = path.join(ASSETS, name);
    process.stdout.write(`  ${name.padEnd(22)} ${String(w).padStart(4)}×${h} … `);
    convert(svg, out, w, h);
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`✓  (${kb} KB)`);
  }

  fs.unlinkSync(SPLASH_SVG);

  console.log('\nTüm asset\'ler oluşturuldu → apps/mobile/assets/');
}

main();
