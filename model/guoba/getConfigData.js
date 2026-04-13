import Config from '../Config.js'

const MODEL_TYPES = ['search', 'image', 'summary', 'video', 'audio']

function normalizeFallbackRequestMode(value, fallback = 'inherit') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['inherit', 'response', 'stream'].includes(normalized) ? normalized : fallback
}

function normalizeFallbackModels(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => ({
      model: String(item?.model || '').trim(),
      baseUrl: String(item?.baseUrl || '').trim(),
      apiKey: String(item?.apiKey || '').trim(),
      requestMode: normalizeFallbackRequestMode(item?.requestMode, 'inherit')
    }))
    .filter(item => item.model || item.baseUrl || item.apiKey)
}

export async function getConfigData() {
  const config = Config.getAll()
  const api = { ...(config.api || {}) }

  for (const modelType of MODEL_TYPES) {
    api[modelType] = {
      ...(api?.[modelType] || {}),
      fallbackModels: normalizeFallbackModels(api?.[modelType]?.fallbackModels)
    }
  }

  return {
    ...config,
    api,
    scheduledSummary: {
      ...config.scheduledSummary,
      groups: (config.scheduledSummary?.groups || []).map(String)
    }
  }
}
