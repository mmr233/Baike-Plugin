import Config from '../Config.js'

const MODEL_TYPES = ['search', 'image', 'summary', 'video', 'audio']
const MODEL_FORM_FIELD_MAP = {
  search: '_apiSearchConfig',
  image: '_apiImageConfig',
  summary: '_apiSummaryConfig',
  video: '_apiVideoConfig',
  audio: '_apiAudioConfig'
}

const MODEL_DEFAULTS = {
  search: { model: 'perplexity-search', timeoutMs: 100000, retryCount: 1, requestMode: 'response' },
  image: { model: 'gemini-flash-latest', timeoutMs: 120000, retryCount: 1, requestMode: 'response' },
  summary: { model: 'gemini-flash-latest', timeoutMs: 120000, retryCount: 1, requestMode: 'response' },
  video: { model: 'qwen3-vl-plus', timeoutMs: 180000, retryCount: 1, requestMode: 'response' },
  audio: { model: 'grok-4.1-fast', timeoutMs: 60000, retryCount: 1, requestMode: 'response' }
}

function normalizeRequestMode(value, fallback = 'response') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['response', 'stream'].includes(normalized) ? normalized : fallback
}

function normalizeTimeoutMs(value, fallback = 120000) {
  const timeoutMs = Number(value)
  if (Number.isFinite(timeoutMs) && timeoutMs >= 1000) {
    return Math.min(600000, Math.floor(timeoutMs))
  }
  return fallback
}

function normalizeRetryCount(value, fallback = 1) {
  const retryCount = Number(value)
  if (Number.isFinite(retryCount) && retryCount >= 0) {
    return Math.min(5, Math.floor(retryCount))
  }
  return fallback
}

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
  const modelFormConfigs = {}

  for (const modelType of MODEL_TYPES) {
    const defaults = MODEL_DEFAULTS[modelType]
    const modelConfig = { ...(api?.[modelType] || {}) }
    api[modelType] = {
      ...modelConfig,
      requestMode: normalizeRequestMode(modelConfig.requestMode, defaults.requestMode),
      timeoutMs: normalizeTimeoutMs(modelConfig.timeoutMs, defaults.timeoutMs),
      retryCount: normalizeRetryCount(modelConfig.retryCount, defaults.retryCount),
      fallbackModels: normalizeFallbackModels(modelConfig.fallbackModels)
    }

    modelFormConfigs[MODEL_FORM_FIELD_MAP[modelType]] = [{
      model: String(api[modelType].model || defaults.model).trim(),
      baseUrl: String(api[modelType].baseUrl || '').trim(),
      apiKey: String(api[modelType].apiKey || '').trim(),
      requestMode: api[modelType].requestMode,
      timeoutMs: api[modelType].timeoutMs,
      retryCount: api[modelType].retryCount
    }]
  }

  return {
    ...config,
    api,
    _apiPrimaryConfig: [{
      primaryBaseUrl: String(api.primaryBaseUrl || '').trim(),
      primaryApiKey: String(api.primaryApiKey || '').trim()
    }],
    ...modelFormConfigs,
    scheduledSummary: {
      ...config.scheduledSummary,
      groups: (config.scheduledSummary?.groups || []).map(String)
    }
  }
}
