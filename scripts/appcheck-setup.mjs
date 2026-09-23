#!/usr/bin/env node
// One-shot App Check setup for Firebase AI Logic (Gemini).
//
// Firebase refuses AI Logic calls until App Check is enforced for the service
// ("Firebase AI Logic has been deactivated in this project. To resume using
// Firebase AI Logic, you must enforce Firebase App Check."). This script does
// everything the console wizard does, via gcloud + REST, idempotently:
//   1. enables recaptchaenterprise + firebaseappcheck APIs
//   2. creates (or reuses) a reCAPTCHA Enterprise *score* key for the web app
//   3. registers that key as the app's App Check provider
//   4. sets enforcementMode=ENFORCED on firebaseml.googleapis.com (AI Logic)
//   5. writes VITE_RECAPTCHA_SITE_KEY into app/.env.production
//
// Requires: `gcloud auth login` with an Owner/Editor of the project.
// Usage:    node scripts/appcheck-setup.mjs [--dry-run]
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = resolve(ROOT, 'app/.env.production');
const PROJECT = 'comandas-charcuteria';
const KEY_NAME = 'comandas-appcheck-web';
const DOMAINS = ['comandas-charcuteria.web.app', 'comandas-charcuteria.firebaseapp.com', 'localhost'];
const AI_SERVICE = 'firebaseml.googleapis.com'; // App Check id for Firebase AI Logic
const DRY = process.argv.includes('--dry-run');

function sh(cmd) { return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }

function readEnv() {
  if (!existsSync(ENV_FILE)) throw new Error(`Missing ${ENV_FILE}`);
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

let token;
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': PROJECT },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}\n${JSON.stringify(json, null, 2)}`);
  return json;
}

const env = readEnv();
const APP_ID = env.VITE_FIREBASE_APP_ID;
if (!APP_ID || env.VITE_FIREBASE_PROJECT_ID !== PROJECT) throw new Error(`app/.env.production must point at ${PROJECT}`);
console.log(`project=${PROJECT} app=${APP_ID}${DRY ? ' (dry run)' : ''}`);

token = sh('gcloud auth print-access-token');

// 1. APIs
console.log('1/5 enabling APIs…');
if (!DRY) sh(`gcloud services enable recaptchaenterprise.googleapis.com firebaseappcheck.googleapis.com --project ${PROJECT}`);

// 2. reCAPTCHA Enterprise key (reuse by display name)
console.log('2/5 reCAPTCHA Enterprise key…');
const RE = `https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT}/keys`;
const existing = (await api('GET', RE)).keys ?? [];
let key = existing.find((k) => k.displayName === KEY_NAME && k.webSettings);
if (!key && !DRY) {
  key = await api('POST', RE, {
    displayName: KEY_NAME,
    webSettings: { integrationType: 'SCORE', allowedDomains: DOMAINS, allowAmpTraffic: false },
  });
  console.log('   created', key.name);
} else if (key) {
  const missing = DOMAINS.filter((d) => !(key.webSettings.allowedDomains ?? []).includes(d));
  if (missing.length && !DRY) {
    key = await api('PATCH', `https://recaptchaenterprise.googleapis.com/v1/${key.name}?updateMask=webSettings.allowedDomains`, {
      webSettings: { allowedDomains: [...new Set([...(key.webSettings.allowedDomains ?? []), ...DOMAINS])] },
    });
    console.log('   added domains', missing.join(', '));
  } else console.log('   reusing', key.name);
}
const siteKey = key ? key.name.split('/').pop() : '<dry-run>';

// 3. Register as App Check provider for the web app
console.log('3/5 App Check provider…');
const AC = `https://firebaseappcheck.googleapis.com/v1/projects/${PROJECT}`;
if (!DRY) {
  const cfg = await api('PATCH', `${AC}/apps/${APP_ID}/recaptchaEnterpriseConfig?updateMask=siteKey`, { siteKey });
  console.log('   ', cfg.name, 'siteKey=' + cfg.siteKey);
}

// 4. Enforce for Firebase AI Logic only (never Firestore/Auth: clients without a token would break)
console.log('4/5 enforcing App Check on', AI_SERVICE, '…');
if (!DRY) {
  const svc = await api('PATCH', `${AC}/services/${AI_SERVICE}?updateMask=enforcementMode`, { enforcementMode: 'ENFORCED' });
  console.log('   ', svc.name, svc.enforcementMode);
}
const services = (await api('GET', `${AC}/services`)).services ?? [];
for (const s of services) console.log(`    ${s.name.split('/').pop().padEnd(36)} ${s.enforcementMode}`);

// 5. Site key into .env.production (public value; file is gitignored anyway)
console.log('5/5 writing VITE_RECAPTCHA_SITE_KEY…');
if (!DRY) {
  let text = readFileSync(ENV_FILE, 'utf8');
  const line = `VITE_RECAPTCHA_SITE_KEY=${siteKey}`;
  text = /^VITE_RECAPTCHA_SITE_KEY=.*$/m.test(text)
    ? text.replace(/^VITE_RECAPTCHA_SITE_KEY=.*$/m, line)
    : text.replace(/\n*$/, `\n# reCAPTCHA Enterprise key for App Check (Firebase AI Logic). Public.\n${line}\n`);
  writeFileSync(ENV_FILE, text);
}
console.log(`\nDone. siteKey=${siteKey}\nNext: npm run deploy  (then close the PWA fully once on each device)`);
