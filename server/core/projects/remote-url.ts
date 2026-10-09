export interface ParsedRemote { host: string; port: string; projectPath: string; normalized: string }
/** Accept SSH scp syntax and ssh/http URLs. Credentials never enter persisted metadata. */
export function parseRemoteUrl(value: string): ParsedRemote | null {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value) || /^[a-z][a-z0-9+.-]*::/i.test(value)) return null;
  let host: string, port = '', projectPath: string;
  try {
    if (/^(https?|ssh):\/\//i.test(value)) {
      const url = new URL(value); host = url.hostname.toLowerCase(); port = url.port;
      projectPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } else {
      if (value.includes('://')) return null;
      const match = /^(?:[^@/:\s]+@)?(\[[^\]]+\]|[^/:\s]+):(.+)$/.exec(value);
      if (!match || /^[a-z]$/i.test(match[1])) return null;
      host = match[1].toLowerCase(); projectPath = match[2].replace(/^\/+/, '');
    }
    projectPath = projectPath.replace(/\/+$/, '').replace(/\.git$/, '');
    if (!projectPath || projectPath.split('/').some(part => !part || part === '.' || part === '..')) return null;
    return { host, port, projectPath, normalized: host + (port ? ':' + port : '') + '/' + projectPath };
  } catch { return null; }
}
export function sameRemote(a: string, b: string): boolean {
  const left = parseRemoteUrl(a), right = parseRemoteUrl(b);
  return left && right ? left.normalized === right.normalized : a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '');
}

export function publicRemoteUrl(value: string): string {
  if (!/^(https?|ssh):\/\//i.test(value)) return value;
  try {
    const url = new URL(value); url.password = '';
    if (url.protocol !== 'ssh:') url.username = '';
    return url.toString();
  } catch { return value; }
}
