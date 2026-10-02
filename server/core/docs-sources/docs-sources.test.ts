import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DocsSource } from './source';
import { convertBody } from './convert';
import { validateConfig } from './config';
import { checkedFile, readManifest, syncSource } from './sync';
import { ConfirmationRequired, DocsSourceConfig, SourceReply, SyncProgress } from './types';

const config: DocsSourceConfig = {
  document_endpoint: '/manuals/{id}/text', metadata_endpoint: '/manuals/{id}/meta',
  children: { endpoint: '/manuals/{id}/branches', items_path: 'payload.nodes', pagination: { mode: 'offset', limit: 2, offset_parameter: 'from', limit_parameter: 'count', total_path: 'payload.total' } },
  lookup: { endpoint: '/find?name={title}&area={scope}', items_path: 'hits' },
  fields: { id: 'key', title: 'label', body: 'text.html', version: 'revision', parent: 'up', url: 'href', updated: 'edited', ancestors: 'lineage' },
  document_path: 'payload', metadata_path: 'payload', original_url: '/read/{id}', body_format: 'html',
  link_patterns: [{ pattern: '/read/([^/?#]+)', id_group: 1 }, { pattern: '/area/([^/]+)/([^?#]+)', scope_group: 1, title_group: 2 }],
  conversion_rules: [
    { selector: 'widget[kind="code"]', action: 'code', content: { selector: 'raw' }, parameter: { attribute: 'lang' } },
    { selector: 'widget[kind="note"]', action: 'callout', label: 'Note' },
    { selector: 'widget[kind="expand"]', action: 'unwrap', content: { selector: 'section' } },
    { selector: 'widget[kind="nav"]', action: 'skip' },
    { selector: 'widget', action: 'unknown', parameter: { attribute: 'kind' } },
  ],
};
function fixture() {
  const docs = new Map<string, Record<string, unknown>>([
    ['root', { key: 'root', label: 'Guide', revision: 1, text: { html: '<h1>Guide</h1><p>Hello <a href="/read/a#part">child</a></p>' }, edited: '2026-10-02' }],
    ['a', { key: 'a', label: 'Child', up: 'root', revision: 1, text: { html: '<p>Original</p>' } }],
    ['b', { key: 'b', label: 'CHILD', up: 'root', revision: 1, text: { html: '<p>Other</p>' } }],
    ['nested', { key: 'nested', label: 'Nested', up: 'b', revision: 1, text: { html: '<p>Excluded branch</p>' } }],
  ]);
  const calls: string[] = [];
  let before: ((url: URL) => Promise<void>) | undefined;
  const source = (settings: DocsSourceConfig = config) => new DocsSource('https://docs.example', settings, async (endpoint, signal) => {
    const url = new URL(endpoint, 'https://docs.example'); calls.push(endpoint);
    await before?.(url); signal?.throwIfAborted();
    if (url.pathname === '/find') return reply({ hits: [strip(docs.get('a')!)] }, url);
    const match = /^\/manuals\/([^/]+)\/(text|meta|branches)$/.exec(url.pathname);
    if (!match) throw new Error('Unexpected URL ' + url.href);
    const [, id, kind] = match, document = docs.get(decodeURIComponent(id));
    if (!document) return { status: 404, body: '{}', url: url.href };
    if (kind === 'branches') {
      const children = [...docs.values()].filter(d => d.up === id).map(strip);
      const offset = Number(url.searchParams.get('from')), count = Number(url.searchParams.get('count'));
      return reply({ payload: { nodes: children.slice(offset, offset + count), total: children.length } }, url);
    }
    return reply({ payload: kind === 'meta' ? strip(document) : document }, url);
  });
  return { docs, calls, source, setBefore: (fn?: (url: URL) => Promise<void>) => { before = fn; } };
}
function strip(document: Record<string, unknown>) { const { text, ...rest } = document; return rest; }
function reply(body: unknown, url: URL): SourceReply { return { status: 200, body: JSON.stringify(body), url: url.href }; }
function temp(t: test.TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-docs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
const selection = [{ id: 'root', include_descendants: true }];

test('incremental sync, hierarchical indexes, changed pages and excluded subtrees', async t => {
  const f = fixture(), root = temp(t);
  const first = await syncSource(f.source(), root, selection);
  assert.equal(first.stats.added, 4); assert.equal(first.stats.downloaded, 4);
  const aFile = first.manifest.entries.a.path;
  assert.match(fs.readFileSync(path.join(root, first.manifest.entries.root.path), 'utf8'), /\]\(child-a-[a-f0-9]+\.md#part\)/);
  assert.match(fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8'), /Nested/);
  assert.ok(fs.existsSync(path.join(root, path.posix.dirname(aFile), 'INDEX.md')));
  f.calls.length = 0;
  const second = await syncSource(f.source(), root, selection);
  assert.equal(second.stats.downloaded, 0); assert.ok(f.calls.every(c => !c.endsWith('/text')));
  f.docs.set('a', { ...f.docs.get('a'), revision: 2, text: { html: '<p>Updated</p>' } });
  f.calls.length = 0;
  const third = await syncSource(f.source(), root, [{ ...selection[0], excluded_ids: ['b'] }]);
  assert.equal(third.stats.updated, 1); assert.equal(third.stats.downloaded, 1); assert.equal(third.stats.deleted, 2);
  assert.match(fs.readFileSync(path.join(root, third.manifest.entries.a.path), 'utf8'), /Updated/);
  assert.ok(!fs.existsSync(path.join(root, first.manifest.entries.b.path)));
  assert.ok(!fs.readFileSync(path.join(root, 'INDEX.md'), 'utf8').includes('Nested'));
  assert.ok(!f.calls.some(c => c.includes('/b/branches')));
});

test('cancellation during downloads leaves previous files and manifest byte-for-byte intact', async t => {
  const f = fixture(), root = temp(t); const first = await syncSource(f.source(), root, selection);
  const manifest = fs.readFileSync(path.join(root, '.manifest.json'), 'utf8');
  const previous = fs.readFileSync(path.join(root, first.manifest.entries.a.path), 'utf8');
  f.docs.set('a', { ...f.docs.get('a'), revision: 2, text: { html: '<p>Never publish</p>' } });
  const controller = new AbortController();
  f.setBefore(async url => { if (url.pathname.endsWith('/text')) controller.abort(); });
  await assert.rejects(syncSource(f.source(), root, selection, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(fs.readFileSync(path.join(root, '.manifest.json'), 'utf8'), manifest);
  assert.equal(fs.readFileSync(path.join(root, first.manifest.entries.a.path), 'utf8'), previous);
  f.setBefore(); assert.equal((await syncSource(f.source(), root, selection)).stats.updated, 1);
});

test('download failure retains old document; incomplete discovery never prunes', async t => {
  const f = fixture(), root = temp(t); const first = await syncSource(f.source(), root, selection);
  f.docs.set('a', { ...f.docs.get('a'), revision: 2 });
  f.setBefore(async url => { if (url.pathname === '/manuals/a/text') throw new Error('Disconnected'); });
  const partial = await syncSource(f.source(), root, selection);
  assert.equal(partial.stats.errors, 1); assert.equal(partial.manifest.entries.a.hash, first.manifest.entries.a.hash);
  const manifest = fs.readFileSync(path.join(root, '.manifest.json'), 'utf8');
  f.setBefore(async url => { if (url.pathname.endsWith('/branches')) throw new Error('Disconnected'); });
  await assert.rejects(syncSource(f.source(), root, selection), /Disconnected/);
  assert.equal(fs.readFileSync(path.join(root, '.manifest.json'), 'utf8'), manifest);
});

test('large discovery requires confirmation before body downloads or files', async t => {
  const f = fixture(), root = temp(t);
  for (let i = 0; i < 501; i++) f.docs.set('doc-' + i, { key: 'doc-' + i, label: 'Page ' + i, revision: 1, up: 'root', text: { html: 'ok' } });
  await assert.rejects(syncSource(f.source(), root, selection), e => e instanceof ConfirmationRequired && e.count > 500);
  assert.ok(!f.calls.some(c => c.endsWith('/text'))); assert.deepEqual(fs.readdirSync(root), []);
  f.calls.length = 0;
  const result = await syncSource(f.source(), root, selection, { confirmed_large: true });
  assert.equal(result.stats.added, 505);
  assert.equal(f.calls.length, 505);
  assert.ok(f.calls.every(c => c.endsWith('/text')), 'confirmation must not repeat discovery');
  f.calls.length = 0;
  const progress: SyncProgress[] = [];
  const same = await syncSource(f.source(), root, selection, { onProgress: p => progress.push(p) });
  assert.equal(same.stats.found, 505);
  assert.equal(same.stats.downloaded, 0);
  assert.ok(f.calls.every(c => !c.endsWith('/text')));
  assert.equal(progress.find(p => p.stage === 'download')?.total, 0);

  f.docs.set('a', { ...f.docs.get('a'), revision: 2 });
  f.calls.length = 0; progress.length = 0;
  const changed = await syncSource(f.source(), root, selection, { onProgress: p => progress.push(p) });
  assert.equal(changed.stats.downloaded, 1);
  assert.deepEqual(f.calls.filter(c => c.endsWith('/text')), ['/manuals/a/text']);
  assert.equal(progress.find(p => p.stage === 'download')?.total, 1);
  assert.equal(progress.at(-1)?.processed, 1);

  for (let i = 0; i < 501; i++) f.docs.get('doc-' + i)!.revision = 2;
  await assert.rejects(syncSource(f.source(), root, selection),
    e => e instanceof ConfirmationRequired && e.count === 501 && e.found === 505);
  f.calls.length = 0;
  const updated = await syncSource(f.source(), root, selection, { confirmed_large: true });
  assert.equal(updated.stats.updated, 501);
  assert.equal(f.calls.length, 501);
  assert.ok(f.calls.every(c => c.endsWith('/text')));
});

test('without versions compare body hashes; without children sync document only', async t => {
  const f = fixture(), root = temp(t), c = structuredClone(config); delete c.fields.version; delete c.children;
  const first = await syncSource(f.source(c), root, selection); assert.equal(first.stats.found, 1);
  assert.match(first.warnings.join(' '), /all bodies/); assert.match(first.warnings.join(' '), /tree is unavailable/);
  const second = await syncSource(f.source(c), root, selection); assert.equal(second.stats.downloaded, 1); assert.equal(second.stats.updated, 0);
  f.docs.get('root')!.text = { html: '<p>Changed</p>' };
  assert.equal((await syncSource(f.source(c), root, selection)).stats.updated, 1);
  await assert.rejects(f.source(c).listChildren('root'), /not configured/);
});

test('link patterns, title lookup, diagnostics and missing fields', async () => {
  const f = fixture(), source = f.source();
  assert.equal((await source.resolveLink('root')).id, 'root');
  assert.equal((await source.resolveLink('https://docs.example/read/a')).title, 'Child');
  assert.equal((await source.resolveLink('https://docs.example/area/guide/A%20title')).id, 'a');
  await assert.rejects(source.resolveLink('https://elsewhere.example/read/a'), /connection service/);
  const probe = await source.probe('/read/a'); assert.equal(probe.fields.id, 'a'); assert.equal(probe.preview, 'Original');
  assert.deepEqual(probe.urls, ['https://docs.example/manuals/a/text']);
  const c = structuredClone(config); c.fields.body = 'missing.content';
  const diagnostic = await f.source(c).probe('a'); assert.ok(diagnostic.missing.includes('missing.content')); assert.equal(diagnostic.preview, '');
});

test('HTML headings, tables, code, configurable elements, links and images', () => {
  const html = '<h2>Title</h2><ul><li>Item</li></ul><table><tr><th>Name</th></tr><tr><td><b>Value</b></td></tr></table><widget kind="code" lang="js"><raw>const x = `a`;</raw></widget><widget kind="note"><p>Read me</p></widget><widget kind="expand"><header>Hide</header><section><p>Shown</p></section></widget><widget kind="nav">Skip</widget><widget kind="future">Other</widget><a href="/read/a">page</a><img src="/image.png" alt="pic"><script>unsafe()</script>';
  const md = convertBody(html, config, 'https://docs.example/read/root', 'folder/index.md', new Map([['a', 'other/page.md']]));
  assert.match(md, /## Title/); assert.match(md, /\| \*\*Value\*\* \|/); assert.match(md, /```js\nconst x = `a`;/);
  assert.match(md, /> \*\*Note\*\*/); assert.match(md, /Shown/); assert.ok(!md.includes('Hide')); assert.ok(!md.includes('Skip'));
  assert.match(md, /unknown element: future/); assert.match(md, /\]\(\.\.\/other\/page.md\)/);
  assert.match(md, /!\[pic\]\(https:\/\/docs.example\/image.png\)/); assert.ok(!md.includes('unsafe'));
});

test('next-link pagination, retries and same-origin restriction', async () => {
  const c = structuredClone(config); c.children = { endpoint: '/tree/{id}', items_path: 'items', pagination: { mode: 'next', next_path: 'next' } };
  let attempts = 0;
  const source = new DocsSource('https://docs.example', c, async endpoint => {
    attempts++;
    if (attempts < 3) return { status: attempts === 1 ? 429 : 503, headers: new Headers({ 'retry-after': '0' }), body: '', url: endpoint };
    return { status: 200, body: JSON.stringify(endpoint.includes('?') ? { items: [{ key: 'b', label: 'B' }] } : { items: [{ key: 'a', label: 'A' }], next: '?page=2' }), url: endpoint };
  });
  assert.deepEqual((await source.listChildren('root')).map(n => n.id), ['a', 'b']); assert.equal(attempts, 4);
  const bad = new DocsSource('https://docs.example', c, async endpoint => ({ status: 200, body: '{"items":[],"next":"https://evil.example/page"}', url: endpoint }));
  await assert.rejects(bad.listChildren('root'), /connection service/);
});

test('one sync at a time; file names safe on Windows; paths cannot escape managed folder', async t => {
  const f = fixture(), root = temp(t);
  f.docs.get('a')!.label = 'CON / <> : ? ' + 'VeryLong'.repeat(80);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.setBefore(async () => { entered(); await gate; });
  const first = syncSource(f.source(), root, selection); await started;
  await assert.rejects(syncSource(f.source(), root, selection), /already running/); release();
  const result = await first;
  const names = Object.values(result.manifest.entries).map(e => e.path);
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length);
  assert.ok(names.every(n => n.length < 220 && !/[<>:"\\|?*]/.test(n)));
  assert.throws(() => checkedFile(root, '../escape.md'), /Invalid/);
  assert.equal(readManifest(root)?.format, 1);
});

test('configuration validation rejects invalid endpoints, selectors and pagination', () => {
  assert.throws(() => validateConfig({ ...config, document_endpoint: 'https://evil.example/{id}' }), /relative/);
  assert.throws(() => validateConfig({ ...config, link_patterns: [{ pattern: '[', id_group: 1 }] }), /Invalid link/);
  assert.throws(() => validateConfig({ ...config, conversion_rules: [{ selector: '[', action: 'skip' }] }), /selector/);
  assert.throws(() => validateConfig({ ...config, children: { endpoint: '/items', items_path: 'items', pagination: { mode: 'offset', limit: 0 } } }), /limit/);
});

// These cases guard behavior that is easy to break when roots overlap or layouts change.
test('overlapping roots cannot re-include an excluded ancestor branch', async t => {
  const f = fixture(), root = temp(t);
  const result = await syncSource(f.source(), root, [{ ...selection[0], excluded_ids: ['b'] }, { id: 'nested', include_descendants: true }]);
  assert.deepEqual(Object.keys(result.manifest.entries).sort(), ['a', 'root']);
});

test('renames and becoming a branch repair cached internal links without reloading unchanged bodies', async t => {
  const f = fixture(), root = temp(t); const first = await syncSource(f.source(), root, selection);
  f.docs.get('a')!.label = 'Renamed';
  f.docs.set('new', { key: 'new', label: 'New child', up: 'a', revision: 1, text: { html: '<a href="/read/root">parent</a>' } });
  f.calls.length = 0;
  const second = await syncSource(f.source(), root, selection);
  assert.equal(second.stats.downloaded, 1); assert.ok(f.calls.every(url => !url.endsWith('/a/text')));
  assert.ok(!fs.existsSync(path.join(root, first.manifest.entries.a.path)));
  const content = fs.readFileSync(path.join(root, second.manifest.entries.root.path), 'utf8');
  assert.ok(content.includes(path.posix.relative(path.posix.dirname(second.manifest.entries.root.path), second.manifest.entries.a.path) + '#part'));
  assert.equal(path.posix.basename(second.manifest.entries.a.path), 'document.md');
  assert.ok(fs.existsSync(path.join(root, path.posix.dirname(second.manifest.entries.a.path), 'INDEX.md')));
});

test('retry exhaustion, pagination cycles and body format markdown', async () => {
  let attempts = 0;
  const unavailable = new DocsSource('https://docs.example', config, async endpoint => { attempts++; return { status: 503, headers: new Headers({ 'retry-after': '0' }), body: '', url: endpoint }; });
  await assert.rejects(unavailable.getDocument('a'), /503/); assert.equal(attempts, 4);
  const c = structuredClone(config); c.children = { endpoint: '/items', items_path: 'items', pagination: { mode: 'next', next_path: 'next' } };
  const cycle = new DocsSource('https://docs.example', c, async endpoint => ({ status: 200, body: '{"items":[],"next":"/items"}', url: endpoint }));
  await assert.rejects(cycle.listChildren('root'), /cycle/);
  c.body_format = 'markdown';
  const result = convertBody('[child](/read/a)\n```text\n[example](/read/a)\n```', c, 'https://docs.example/read/root', 'one.md', new Map([['a', 'two.md']]));
  assert.equal(result, '[child](two.md)\n```text\n[example](/read/a)\n```');
});

test('empty configured elements still produce unknown labels and fenced code', () => {
  const md = convertBody('<widget kind="future"></widget><widget kind="code" lang="txt"><raw></raw></widget>', config, 'https://docs.example');
  assert.match(md, /unknown element: future/);
  assert.match(md, /```txt\n\n```/);
});

test('CDATA literal code retains operators instead of disappearing as a comment', () => {
  const md = convertBody('<widget kind="code" lang="js"><raw><![CDATA[if (a < b && b > 0) { console.log("x"); }]]></raw></widget>', config, 'https://docs.example');
  assert.ok(md.includes('if (a < b && b > 0) { console.log("x"); }'));
  assert.ok(md.includes('```js'));
});

test('confirmation rejects changed settings, expired plans and missing plans without remote requests', async t => {
  const f = fixture(), root = temp(t);
  for (let i = 0; i < 501; i++) f.docs.set('doc-' + i, { key: 'doc-' + i, label: 'Page ' + i, revision: 1, up: 'root', text: { html: 'ok' } });
  await assert.rejects(syncSource(f.source(), root, selection), ConfirmationRequired);
  f.calls.length = 0;
  await assert.rejects(syncSource(f.source(), root, [{ id: 'a', include_descendants: false }], { confirmed_large: true }), { code: 'confirmation_expired' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(syncSource(f.source(), root, selection, { confirmed_large: true }), { code: 'confirmation_expired' });
  assert.equal(f.calls.length, 0);
  await assert.rejects(syncSource(f.source(), root, selection), ConfirmationRequired);
  const now = Date.now();
  const mocked = t.mock.method(Date, 'now', () => now + 11 * 60 * 1000);
  f.calls.length = 0;
  await assert.rejects(syncSource(f.source(), root, selection, { confirmed_large: true }), { code: 'confirmation_expired' });
  mocked.mock.restore();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(root), []);
});
