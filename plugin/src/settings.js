// Settings: pure helpers (testable in Node) + load/save to the plugin data folder (UXP only).
'use strict';

const DEFAULTS = {
  version: 1,
  defaultTemplate: '',          // '' = no template
  companyTemplates: {},         // { "acme": { company: "Acme", template: "TPL_Acme" } } keyed by normalised company
  pattern: '{company}_{video}_R{nn}',
  handleBefore: 0,
  handleAfter: 0,
  markers: true,
  sortChronological: false
};

const TEMPLATE_PREFIX = 'TPL_';

function normCompany(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function isTemplateName(name) { return String(name || '').startsWith(TEMPLATE_PREFIX); }

/** Merge stored JSON onto defaults, ignoring junk. */
function sanitize(raw) {
  const s = Object.assign({}, DEFAULTS, { companyTemplates: {} });
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.defaultTemplate === 'string') s.defaultTemplate = raw.defaultTemplate;
  if (raw.companyTemplates && typeof raw.companyTemplates === 'object') {
    s.companyTemplates = {};
    for (const [k, v] of Object.entries(raw.companyTemplates)) {
      if (v && typeof v.template === 'string') s.companyTemplates[normCompany(k)] = { company: String(v.company || k), template: v.template };
    }
  }
  if (typeof raw.pattern === 'string' && raw.pattern.trim()) s.pattern = raw.pattern;
  for (const k of ['handleBefore', 'handleAfter']) if (typeof raw[k] === 'number' && raw[k] >= 0 && raw[k] < 600) s[k] = raw[k];
  for (const k of ['markers', 'sortChronological']) if (typeof raw[k] === 'boolean') s[k] = raw[k];
  return s;
}

/**
 * Which template a reel should use: company mapping first, then the default.
 * Returns '' when nothing applies or the template no longer exists.
 * @param {object} settings
 * @param {string} company
 * @param {string[]} available template sequence names in the project
 */
function templateFor(settings, company, available) {
  const has = (n) => !!n && available.includes(n);
  const m = settings.companyTemplates[normCompany(company)];
  if (m && has(m.template)) return m.template;
  return has(settings.defaultTemplate) ? settings.defaultTemplate : '';
}

function setCompanyTemplate(settings, company, template) {
  const k = normCompany(company);
  if (!k) return settings;
  if (template) settings.companyTemplates[k] = { company: String(company).trim(), template };
  else delete settings.companyTemplates[k];
  return settings;
}

// ---------- storage (UXP) ----------
const FILE = 'settings.json';

async function load() {
  try {
    const { localFileSystem } = require('uxp').storage;
    const folder = await localFileSystem.getDataFolder();
    const f = await folder.getEntry(FILE);
    return sanitize(JSON.parse(await f.read()));
  } catch (e) {
    return sanitize(null);
  }
}

async function save(settings) {
  const { localFileSystem } = require('uxp').storage;
  const folder = await localFileSystem.getDataFolder();
  const f = await folder.createFile(FILE, { overwrite: true });
  await f.write(JSON.stringify(settings, null, 2));
}

module.exports = { DEFAULTS, TEMPLATE_PREFIX, normCompany, isTemplateName, sanitize, templateFor, setCompanyTemplate, load, save };
