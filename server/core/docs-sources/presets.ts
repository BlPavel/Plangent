import { DocsSourceConfig } from './types';
export interface DocsSourcePreset { id: string; name: string; description: string; config: DocsSourceConfig }
export const docsSourcePresets: readonly DocsSourcePreset[] = [{
  id: 'confluence-server-dc', name: 'Confluence Server/DC',
  description: "Для Confluence Server/Data Center через REST API и HTML storage; не для Cloud. Пути относительны корню сервиса. При установке в подпапке добавьте её к путям.",
  config: {
    document_endpoint: '/rest/api/content/{id}?expand=body.storage,version,ancestors,space',
    metadata_endpoint: '/rest/api/content/{id}?expand=version,ancestors,space',
    children: { endpoint: '/rest/api/content/{id}/child/page?expand=version,ancestors,space', items_path: 'results', pagination: { mode: 'offset', offset_parameter: 'start', limit_parameter: 'limit', limit: 100 } },
    lookup: { endpoint: '/rest/api/content?type=page&spaceKey={scope}&title={title}&expand=version,ancestors,space', items_path: 'results', pagination: { mode: 'offset', offset_parameter: 'start', limit_parameter: 'limit', limit: 100 } },
    fields: { id: 'id', title: 'title', body: 'body.storage.value', version: 'version.number', ancestors: 'ancestors', updated: 'version.when', space: 'space.key', author: 'version.by.displayName' },
    original_url: '/pages/viewpage.action?pageId={id}', body_format: 'html',
    link_patterns: [
      { pattern: 'viewpage\\.action\\?[^#]*?pageId=([0-9]+)', id_group: 1 },
      { pattern: '/spaces/[^/]+/pages/([0-9]+)(?:[/#?]|$)', id_group: 1 },
      { pattern: '/display/([^/]+)/([^?#]+)', scope_group: 1, title_group: 2 },
    ],
    conversion_rules: [
      { selector: 'ac\\:structured-macro[ac\\:name="code"]', action: 'code', content: { selector: 'ac\\:plain-text-body' }, parameter: { selector: 'ac\\:parameter[ac\\:name="language"]' } },
      ...['info', 'note', 'warning', 'tip'].map(label => ({ selector: 'ac\\:structured-macro[ac\\:name="' + label + '"]', action: 'callout' as const, label, content: { selector: 'ac\\:rich-text-body' } })),
      { selector: 'ac\\:structured-macro[ac\\:name="expand"]', action: 'unwrap', content: { selector: 'ac\\:rich-text-body' } },
      { selector: 'ac\\:structured-macro[ac\\:name="toc"],ac\\:structured-macro[ac\\:name="children"]', action: 'skip' },
      { selector: 'ac\\:structured-macro', action: 'unknown', parameter: { attribute: 'ac:name' } },
    ],
  },
}];
