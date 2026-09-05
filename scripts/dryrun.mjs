/**
 * Runs the real indexer over a vault on disk, outside Obsidian.
 *
 * The point is to check the scan against a live vault before shipping — counts,
 * the tag-boundary fixes and the folder-boundary fix are all things a unit test
 * can assert in the abstract but only a real vault can confirm.
 *
 *   node scripts/dryrun.mjs "/path/to/vault" [EntityKey]
 */
import esbuild from 'esbuild';
import { readFile, readdir, stat, writeFile, rm } from 'fs/promises';
import path from 'path';

const vaultRoot = process.argv[2];
const focus = process.argv[3]?.toLowerCase();
if (!vaultRoot) {
  console.error('usage: node scripts/dryrun.mjs <vault path> [Type/Name]');
  process.exit(1);
}

// Minimal stand-in for the handful of Obsidian APIs the scanner touches.
const stub = `
export class TFile {}
export class App {}
export const requestUrl = async () => { throw new Error('no network in dryrun'); };
`;
await writeFile('/tmp/rolodex-obsidian-stub.mjs', stub);

await esbuild.build({
  entryPoints: ['src/scanner.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: '/tmp/rolodex-scanner.mjs',
  alias: { obsidian: '/tmp/rolodex-obsidian-stub.mjs' },
  logLevel: 'warning',
});

const { buildIndex } = await import('/tmp/rolodex-scanner.mjs');

async function walk(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

const paths = await walk(vaultRoot);
const files = await Promise.all(paths.map(async p => {
  const s = await stat(path.join(vaultRoot, p));
  return {
    path: p,
    basename: path.basename(p, '.md'),
    stat: { ctime: s.birthtimeMs || s.ctimeMs, mtime: s.mtimeMs },
  };
}));

// The scanner uses instanceof TFile in attachEntityNotes; the stub class is what
// the bundle checks against, so tag the plain objects with it.
const { TFile } = await import('/tmp/rolodex-obsidian-stub.mjs');
for (const f of files) Object.setPrototypeOf(f, TFile.prototype);

const app = {
  vault: {
    configDir: '.obsidian',
    getMarkdownFiles: () => files,
    cachedRead: f => readFile(path.join(vaultRoot, f.path), 'utf8'),
  },
  metadataCache: { getFileCache: () => undefined },
};

const settings = {
  entityTypes: [],
  includeFolders: [],
  excludeFolders: ['Attachments', 'Template', 'Templates', '.trash'],
  entityNoteFolders: ['Customers', 'Projects', 'Partners', 'Organization'],
  defaultDays: 30,
  geminiApiKey: '',
  geminiModel: '',
  defaultPrompt: '',
  typeAliases: ['Projects=Project', 'Customers=Customer'],
  ignoredTypes: ['chat', 'inbox', 'all', 'slide'],
};

const t0 = Date.now();
const index = await buildIndex(app, settings);
const ms = Date.now() - t0;

console.log(`scanned ${index.scannedFiles} notes in ${ms} ms`);
console.log(`entities: ${index.entities.size}`);
console.log('types:', [...index.typesSeen.entries()].sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `${t} ${n}`).join(' · '));

const rows = [...index.entities.values()]
  .map(e => ({
    key: `${e.type}/${e.name}`,
    open: e.tasks.filter(t => t.status === 'open').length,
    tasks: e.tasks.length,
    acts: e.activities.length,
    mentions: e.noteCount,
    last: e.lastSeen,
    note: e.notePath ? '📄' : '',
    rel: [...e.related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, n]) => `${index.entities.get(k)?.name ?? k}:${n}`).join(' '),
  }))
  .sort((a, b) => b.mentions - a.mentions);

console.log('\ntop 20 by mentions');
for (const r of rows.slice(0, 20)) {
  console.log(`  ${r.key.padEnd(28)} ${String(r.mentions).padStart(5)}m ${String(r.open).padStart(4)} open ${String(r.acts).padStart(5)} acts ${r.last} ${r.note} ${r.rel}`);
}

if (focus) {
  const e = index.entities.get(focus);
  if (!e) console.log(`\n${focus}: not found`);
  else {
    console.log(`\n${e.type}/${e.name}: ${e.noteCount} notes, ${e.activities.length} activities, note=${e.notePath ?? 'none'}`);
    console.log('subs:', [...e.subs].join(', ') || 'none');
    console.log('related:', [...e.related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, n]) => `${index.entities.get(k)?.name ?? k} ${n}`).join(', '));
    for (const t of e.tasks.filter(t => t.status === 'open').slice(0, 10)) {
      console.log(`  - [ ] ${t.text}${t.due ? ` (due ${t.due})` : ''} @ ${t.path}:${t.line}`);
    }
  }
}

await rm('/tmp/rolodex-scanner.mjs', { force: true });
await rm('/tmp/rolodex-obsidian-stub.mjs', { force: true });
