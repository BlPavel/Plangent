import type { Endpoints, EndpointKey } from '@contracts'
import { api } from './index'

type Input<K extends EndpointKey> = {
  params: Endpoints[K]['params'] extends Record<string, never> ? Record<string, never> : { [P in keyof Endpoints[K]['params']]: string | number }
  query?: (Endpoints[K]['query'] extends Record<string, never> ? object : Endpoints[K]['query']) & { workspace?: string }
  signal?: AbortSignal
  keepalive?: boolean
} & ([Endpoints[K]['body']] extends [never] ? { body?: never } : Record<string, never> extends Endpoints[K]['body'] ? { body?: Endpoints[K]['body'] } : { body: Endpoints[K]['body'] })

/** Feature APIs bind a contract key once; callers provide only parameters and input. */
export function endpoint<K extends EndpointKey>(key: K) {
  return (input: Input<K>): Promise<Endpoints[K]['response']> => {
    const [method, template] = key.split(' ') as [string, string]
    let path = template.replace(/^\/api/, '').replace(/:([\w]+)/g, (_, name: string) => {
      const value = (input.params as Record<string, string>)[name]
      if (value === undefined) throw new Error(`Missing endpoint parameter: ${name}`)
      return encodeURIComponent(value)
    })
    const query = new URLSearchParams()
    for (const [name, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined && value !== null) query.set(name, String(value))
    }
    if (query.size) path += '?' + query.toString()
    switch (method) {
      case 'GET': return api.get(path, input.signal)
      case 'POST': return api.post(path, input.body)
      case 'PUT': return api.put(path, input.body, input.keepalive)
      case 'PATCH': return api.patch(path, input.body)
      case 'DELETE': return api.delete(path)
      default: throw new Error(`Unsupported method: ${method}`)
    }
  }
}
