#!/usr/bin/env node
/**
 * generate-manifest.js
 * ---------------------------------------------------------------
 * Build-time replacement for the old api/issues.php.
 *
 * There's no PHP/MySQL anymore, so nothing scans the /newspapers
 * folder while the site is live. Instead, this script runs once at
 * BUILD time (Cloudflare Pages runs it automatically on every push,
 * see the "build command" note in README.md) and writes a plain
 * newspapers/manifest.json that the static site fetches at runtime.
 *
 * Net effect for you: drop a new PDF into /newspapers, push it,
 * Cloudflare rebuilds, the manifest regenerates, the issue shows up
 * — no manual JSON editing, no server-side code running live.
 *
 * Run it by hand any time with:
 *   node scripts/generate-manifest.js
 * ---------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const NEWSPAPERS_DIR = path.join(__dirname, '..', 'newspapers');
const MANIFEST_PATH = path.join(NEWSPAPERS_DIR, 'manifest.json');

function humanizeTitle(filename) {
  let name = filename.replace(/\.pdf$/i, '');
  name = name.replace(/[_-]+/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/\s+(\d)$/, ' $1');
  return name || 'Untitled Issue';
}

/**
 * Pull /CreationDate or /ModDate out of a PDF's raw bytes without any
 * external PDF library. PDF dates look like: D:20260612101530+01'00'
 */
function pdfInternalDate(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const bufSize = 200000; // metadata usually lives in the first/last chunk
    const buffer = Buffer.alloc(bufSize);
    const bytesRead = fs.readSync(fd, buffer, 0, bufSize, 0);
    fs.closeSync(fd);

    const chunk = buffer.toString('latin1', 0, bytesRead);
    const match = chunk.match(/\/(CreationDate|ModDate)\s*\(D:(\d{4})(\d{2})(\d{2})/);
    if (!match) return null;

    const [, , year, month, day] = match;
    const ts = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getTime();
    return Number.isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}

function formatDate(timestampMs) {
  const d = new Date(timestampMs);
  return d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function main() {
  if (!fs.existsSync(NEWSPAPERS_DIR)) {
    console.error(`No newspapers folder found at ${NEWSPAPERS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(NEWSPAPERS_DIR).filter((f) => /\.pdf$/i.test(f));

  const issues = files.map((filename) => {
    const filePath = path.join(NEWSPAPERS_DIR, filename);
    const stat = fs.statSync(filePath);
    const internalDate = pdfInternalDate(filePath);
    const timestamp = internalDate || stat.mtimeMs;

    return {
      file: filename,
      url: `newspapers/${encodeURIComponent(filename)}`,
      title: humanizeTitle(filename),
      date: formatDate(timestamp),
      timestamp,
      sizeKb: Math.round(stat.size / 1024),
    };
  });

  issues.sort((a, b) => b.timestamp - a.timestamp);

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ issues }, null, 2));
  console.log(`Wrote ${issues.length} issue(s) to ${MANIFEST_PATH}`);
}

main();
