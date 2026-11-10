// Update check: fetch a small version.json and compare with the installed version.
// version.json: { "version": "1.0.1", "url": "https://.../ReelCutter-1.0.1.ccx", "notes": "..." }
// UPDATE_URL empty = check disabled. Network errors are ignored silently.
'use strict';

// Put the raw URL of version.json here once there is a GitHub repo, e.g.
// https://raw.githubusercontent.com/<user>/reel-cutter/main/version.json
const UPDATE_URL = 'https://raw.githubusercontent.com/Mohamed-Elsawaf/reel-cutter/main/version.json';

/** Compare "1.2.3" style versions. Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * @param {string} current installed version
 * @param {string} [url]
 * @returns {Promise<null | {version:string, url:string, notes:string}>} newer release or null
 */
async function checkForUpdate(current, url) {
  const u = url === undefined ? UPDATE_URL : url;
  if (!u) return null;
  try {
    const res = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now());
    if (!res.ok) return null;
    const info = await res.json();
    if (info && typeof info.version === 'string' && compareVersions(info.version, current) > 0) {
      return { version: info.version, url: String(info.url || ''), notes: String(info.notes || '') };
    }
  } catch (e) { /* offline or bad JSON: ignore */ }
  return null;
}

module.exports = { UPDATE_URL, compareVersions, checkForUpdate };
