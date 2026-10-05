const BASE = '/api'

async function response(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' }, signal }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const result = await fetch(BASE + path, opts)
  if (!result.ok) {
    const data = await result.json().catch(() => null)
    throw new Error(data?.error || result.statusText)
  }
  return result
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const result = await response(method, path, body, signal)
  return result.status === 204 ? null as T : result.json()
}

/** NDJSON consumed incrementally, including records split across network chunks. */
async function* stream<T>(path: string, signal?: AbortSignal): AsyncGenerator<T> {
  const result = await response('GET', path, undefined, signal)
  if (!result.body) throw new Error('Missing response stream')
  const reader = result.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const parse = (line: string): T => {
    const event = JSON.parse(line)
    if (event.type === 'error') throw new Error(event.error || 'Stream failed')
    return event as T
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim()
        pending = pending.slice(end + 1)
        if (line) yield parse(line)
      }
      if (done) break
    }
    if (pending.trim()) yield parse(pending)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  stream,
}
