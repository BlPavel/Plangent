type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Value at a dot path ("a.b.c"), or undefined. */
export function getPath(source: unknown, path: string): unknown {
  let current = source
  for (const key of path.split('.')) {
    if (!isObj(current) || !Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}

/** A copy with the dot path set; undefined removes the key and any objects left empty by that. */
export function setPath(source: Obj, path: string, value: unknown): Obj {
  const [key, ...rest] = path.split('.')
  const copy = { ...source }
  if (rest.length) {
    const child = setPath(isObj(copy[key]) ? copy[key] as Obj : {}, rest.join('.'), value)
    if (Object.keys(child).length) copy[key] = child
    else delete copy[key]
  } else if (value === undefined) delete copy[key]
  else copy[key] = value
  return copy
}
