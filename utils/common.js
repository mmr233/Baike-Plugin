export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function cloneDeep(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return cloneDeep(source)
  }

  const merged = { ...target }

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      merged[key] = [...value]
      continue
    }

    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value)
      continue
    }

    merged[key] = cloneDeep(value)
  }

  return merged
}

export function setByPath(target, path, value) {
  const keys = String(path).split('.')
  let current = target

  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]
    if (!isPlainObject(current[key])) {
      current[key] = {}
    }
    current = current[key]
  }

  current[keys[keys.length - 1]] = value
  return target
}

export function getByPath(target, path, fallback = undefined) {
  const keys = String(path).split('.')
  let current = target

  for (const key of keys) {
    if (current == null || !(key in current)) {
      return fallback
    }
    current = current[key]
  }

  return current
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function toPositiveNumberArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(
      value
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item > 0)
    )]
  }

  if (typeof value === 'string') {
    return [...new Set(
      value
        .split(/[,\s]+/)
        .map(item => Number(item))
        .filter(item => Number.isInteger(item) && item > 0)
    )]
  }

  if (Number.isInteger(Number(value)) && Number(value) > 0) {
    return [Number(value)]
  }

  return []
}
