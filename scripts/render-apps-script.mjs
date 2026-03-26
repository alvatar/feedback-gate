#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function escapeJsString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
}

const args = parseArgs(process.argv);
const templatePath = resolve(args.template ?? 'examples/google-apps-script/Code.js');
const manifestPath = resolve(args.manifest ?? 'examples/google-apps-script/appsscript.json');
const outDir = resolve(args['out-dir']);
const sheetName = args['sheet-name'];
const notifyEmail = args['notify-email'];
const sharedSecret = args['shared-secret'];

if (!outDir || !sheetName || notifyEmail === undefined || !sharedSecret) {
  throw new Error('Required args: --out-dir --sheet-name --notify-email --shared-secret');
}

mkdirSync(outDir, { recursive: true });
const template = readFileSync(templatePath, 'utf8');
const rendered = template
  .replace(/^const SHEET_NAME = .*;$/m, `const SHEET_NAME = '${escapeJsString(sheetName)}';`)
  .replace(/^const NOTIFY_EMAIL = .*;$/m, `const NOTIFY_EMAIL = '${escapeJsString(notifyEmail)}';`)
  .replace(/^const SHARED_SECRET = .*;$/m, `const SHARED_SECRET = '${escapeJsString(sharedSecret)}';`);

writeFileSync(join(outDir, 'Code.js'), rendered);
copyFileSync(manifestPath, join(outDir, 'appsscript.json'));
writeFileSync(join(outDir, '.claspignore'), '');

console.log(`Rendered Apps Script into ${outDir}`);
