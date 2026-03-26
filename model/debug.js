import Config from './Config.js'
import { pluginName } from './constant.js'

function stringifyDebugPayload(payload) {
  if (payload === undefined || payload === null) {
    return ''
  }

  if (typeof payload === 'string') {
    return payload
  }

  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

export function isDebugEnabled() {
  return Config.get('debug.enabled', false)
}

export function debugLog(scope, message, payload = undefined) {
  if (!isDebugEnabled()) {
    return
  }

  const prefix = `[${pluginName}] [调试:${scope}] ${message}`
  const suffix = stringifyDebugPayload(payload)
  logger.info(suffix ? `${prefix} ${suffix}` : prefix)
}
