
import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationPresets } from '../integrations/presets';
import { validateAuthConfig } from '../integrations';
import { docsSourcePresets } from './presets';
import { DocsSource } from './source';
import { convertBody } from './convert';
import { validateConfig } from './config';

test('presets validate, resolve links and convert storage macros through the generic engine', async () => {
  const auth = integrationPresets[0];
  validateAuthConfig(auth.auth_strategy, auth.auth_config);
  const config = validateConfig(docsSourcePresets[0].config);
  const requests: string[] = [];
  const source = new DocsSource('https://example.test', config, async url => {
    requests.push(url);
    const node = { id: '123', title: 'Guide', version: { number: 1 }, ancestors: [] };
    return { status: 200, url: 'https://example.test'+url, body: JSON.stringify(url.includes('spaceKey=') ? { results: [node] } : node) };
  });
  for (const link of ['/pages/viewpage.action?pageId=123','/spaces/DOC/pages/123/Guide','/display/DOC/Guide']) {
    assert.equal((await source.resolveLink(link)).id, '123');
  }
  assert.ok(requests.some(url => url.includes('spaceKey=DOC&title=Guide')));
  const markdown = convertBody('<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[const x = 1;]]></ac:plain-text-body></ac:structured-macro><ac:structured-macro ac:name="info"><ac:rich-text-body><p>Read this</p></ac:rich-text-body></ac:structured-macro><ac:structured-macro ac:name="toc"></ac:structured-macro>', config, 'https://example.test/pages/viewpage.action?pageId=123');
  assert.match(markdown, /\x60{3}ts\nconst x = 1;/);
  assert.match(markdown, /> .*Read this/);
  assert.doesNotMatch(markdown, /unknown element/);
});
