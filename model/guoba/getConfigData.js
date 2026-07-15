import Config from '../Config.js'
import {
  buildModelOptionsFromCache,
  buildModelOptionsMapFromCache,
  getModelCacheEntriesForType
} from './modelOptions.js'

const MODEL_TYPES = ['search', 'image', 'summary', 'jsonRepair', 'video', 'audio']
const MODEL_PREVIEW_LIMIT = 40
const MODEL_FORM_FIELD_MAP = {
  search: '_apiSearchConfig',
  image: '_apiImageConfig',
  summary: '_apiSummaryConfig',
  jsonRepair: '_apiJsonRepairConfig',
  video: '_apiVideoConfig',
  audio: '_apiAudioConfig'
}
const MAX_MODEL_OPTIONS_PER_ENTRY = 500
const DEFAULT_API_PRESET_OPTIONS = [
  { label: '自定义/旧主接口', value: '' }
]
const DEFAULT_API_KEY_GROUP_OPTIONS = [
  { label: '继承接口默认密钥', value: '' }
]

const MODEL_DEFAULTS = {
  search: { model: 'perplexity-search', timeoutMs: 100000, connectTimeoutMs: 30000, retryCount: 1, endpointType: 'inherit', requestMode: 'response' },
  image: { model: 'gemini-flash-latest', timeoutMs: 120000, connectTimeoutMs: 30000, retryCount: 1, endpointType: 'inherit', requestMode: 'response' },
  summary: { model: 'gemini-flash-latest', timeoutMs: 120000, connectTimeoutMs: 30000, retryCount: 1, endpointType: 'inherit', requestMode: 'response' },
  jsonRepair: { model: 'gemini-flash-latest', timeoutMs: 60000, connectTimeoutMs: 30000, retryCount: 1, endpointType: 'inherit', requestMode: 'response' },
  video: { model: 'qwen3-vl-plus', timeoutMs: 180000, connectTimeoutMs: 30000, retryCount: 1, endpointType: 'inherit', requestMode: 'response' },
  audio: { model: 'grok-4.1-fast', timeoutMs: 60000, connectTimeoutMs: 30000, retryCount: 1, endpointType: 'inherit', requestMode: 'response' }
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

function normalizeEndpointType(value, fallback = 'openai-chat') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['inherit', 'openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-native'].includes(normalized) ? normalized : fallback
}

function normalizeFallbackEndpointType(value, fallback = 'inherit') {
  return normalizeEndpointType(value, fallback)
}

function formatApiKeyGroupFormValue(apiPresetId = '', apiKeyGroupId = '') {
  const presetId = String(apiPresetId || '').trim()
  const keyGroupId = String(apiKeyGroupId || '').trim()
  if (keyGroupId.includes('::') || keyGroupId.includes('/') || keyGroupId.includes('|')) {
    return keyGroupId
  }
  if (presetId && keyGroupId) {
    return `${presetId}::${keyGroupId}`
  }
  return keyGroupId
}

function formatOptionLabel(name = '', id = '') {
  const actualName = String(name || '').trim()
  const actualId = String(id || '').trim()
  if (!actualName) {
    return actualId
  }
  return actualName === actualId ? actualName : `${actualName}（${actualId}）`
}

function createDefaultApiKeyGroupOption(presetId = '') {
  const actualPresetId = String(presetId || '').trim()
  return actualPresetId
    ? { ...DEFAULT_API_KEY_GROUP_OPTIONS[0], presetId: actualPresetId, keyGroupId: '' }
    : { ...DEFAULT_API_KEY_GROUP_OPTIONS[0] }
}

function buildApiSelectionOptions(apiConfig = {}) {
  const presets = Array.isArray(apiConfig.presets) ? apiConfig.presets : []
  const apiPresetOptions = [
    ...DEFAULT_API_PRESET_OPTIONS,
    ...presets
      .filter(item => item?.id || item?.name)
      .map(item => ({
        label: formatOptionLabel(item.name, item.id),
        value: String(item.id || '').trim()
      }))
      .filter(item => item.value)
  ]
  const groupedKeyOptions = presets
    .map(preset => ({
      label: formatOptionLabel(preset.name, preset.id),
      options: (Array.isArray(preset.keyGroups) ? preset.keyGroups : [])
        .filter(group => group?.id || group?.name)
        .map(group => ({
          label: formatOptionLabel(group.name, group.id),
          value: `${preset.id}::${group.id}`,
          presetId: preset.id,
          keyGroupId: group.id
        }))
        .filter(item => item.value)
    }))
    .filter(group => group.options.length > 0)
  const keyOptionsByPreset = {}
  const defaultKeyGroupByPreset = {}
  for (const preset of presets) {
    const options = (Array.isArray(preset.keyGroups) ? preset.keyGroups : [])
      .filter(group => group?.id || group?.name)
      .map(group => ({
        label: formatOptionLabel(group.name, group.id),
        value: `${preset.id}::${group.id}`,
        presetId: preset.id,
        keyGroupId: group.id
      }))
      .filter(item => item.value)
    keyOptionsByPreset[preset.id] = [
      createDefaultApiKeyGroupOption(preset.id),
      ...options
    ]
    if (options.length > 0) {
      defaultKeyGroupByPreset[preset.id] = options[0].value
    }
  }

  return {
    apiPresetOptions,
    apiKeyGroupOptions: [
      createDefaultApiKeyGroupOption(),
      ...groupedKeyOptions
    ],
    keyOptionsByPreset,
    defaultKeyGroupByPreset
  }
}

function createApiKeyGroupModelButtons(keyGroupId = '', presetId = '') {
  const actualKeyGroupId = String(keyGroupId || '').trim()
  const actualPresetId = String(presetId || '').trim()
  const disabled = !actualKeyGroupId || !actualPresetId

  return [
    {
      label: '获取模型列表',
      type: 'primary',
      action: 'refreshApiKeyGroupModelOptions',
      args: [actualKeyGroupId, actualPresetId],
      disabled
    },
    {
      label: '检测密钥',
      action: 'refreshApiKeyGroupModelOptions',
      args: [actualKeyGroupId, actualPresetId],
      disabled
    }
  ]
}

function formatModelCacheTime(timestamp = 0) {
  const date = new Date(Number(timestamp) || 0)
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return ''
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function createApiKeyGroupModelPreview(modelOptionsCache = {}, presetId = '', keyGroupId = '') {
  const entries = getModelCacheEntriesForType(modelOptionsCache, '')
    .filter(item => item.apiPresetId === String(presetId || '').trim() && item.apiKeyGroupId === String(keyGroupId || '').trim())

  if (entries.length === 0) {
    return '暂未获取模型列表'
  }

  const latest = entries
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0]
  const models = Array.isArray(latest?.models) ? latest.models : []
  const updatedAt = formatModelCacheTime(latest?.updatedAt)
  const preview = models.slice(0, MODEL_PREVIEW_LIMIT).join('\n')
  const hiddenCount = Math.max(0, models.length - MODEL_PREVIEW_LIMIT)
  return [
    `已缓存 ${models.length} 个模型${updatedAt ? `，更新于 ${updatedAt}` : ''}`,
    preview,
    hiddenCount > 0 ? `... 还有 ${hiddenCount} 个模型未显示，可手动输入完整模型名` : ''
  ].filter(Boolean).join('\n')
}

function summarizeModelOptionsCache(modelOptionsCache = {}) {
  const cache = modelOptionsCache && typeof modelOptionsCache === 'object'
    ? modelOptionsCache
    : {}
  const result = {}
  for (const key of ['sources', ...MODEL_TYPES]) {
    const entries = Array.isArray(cache[key]) ? cache[key] : []
    result[key] = entries.map(item => ({
      baseUrl: String(item?.baseUrl || '').trim(),
      endpointType: normalizeEndpointType(item?.endpointType, 'openai-chat'),
      apiPresetId: String(item?.apiPresetId || '').trim(),
      apiKeyGroupId: String(item?.apiKeyGroupId || '').trim(),
      updatedAt: Number(item?.updatedAt) || 0,
      modelCount: Array.isArray(item?.models) ? item.models.length : 0
    }))
  }
  return result
}

function formatModelOptionsCacheSummary(modelOptionsCache = {}) {
  const summary = summarizeModelOptionsCache(modelOptionsCache)
  const lines = []
  for (const [key, entries] of Object.entries(summary)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      continue
    }
    const modelCount = entries.reduce((sum, item) => sum + (Number(item.modelCount) || 0), 0)
    lines.push(`${key}: ${entries.length} 个来源，${modelCount} 个模型`)
  }

  return lines.length > 0
    ? lines.join('\n')
    : '暂未缓存模型列表'
}

function buildModelRuntimeFields(apiConfig = {}, modelType = '', sourceConfig = {}, inherited = {}, selectionOptions = null) {
  const cacheEntries = getModelCacheEntriesForType(apiConfig.modelOptionsCache, modelType)
  const actualSelectionOptions = selectionOptions || buildApiSelectionOptions(apiConfig)

  return {
    __apiPresetOptions: actualSelectionOptions.apiPresetOptions,
    __apiKeyGroupOptions: actualSelectionOptions.apiKeyGroupOptions,
    __apiKeyGroupOptionsByPreset: actualSelectionOptions.keyOptionsByPreset,
    __apiDefaultKeyGroupByPreset: actualSelectionOptions.defaultKeyGroupByPreset,
    __modelOptions: buildModelOptionsFromCache(cacheEntries, {
      apiConfig,
      sourceConfig,
      inherited,
      fallbackToAll: true
    }),
    __modelOptionsAll: buildModelOptionsFromCache(cacheEntries, {
      apiConfig,
      sourceConfig: {},
      inherited: {},
      fallbackToAll: true
    }),
    __modelOptionsMap: buildModelOptionsMapFromCache(cacheEntries, { apiConfig })
  }
}

function normalizeApiPresets(value = [], modelOptionsCache = {}) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      const id = String(item?.id || item?.name || `preset-${index + 1}`).trim()
      const keyGroups = Array.isArray(item?.keyGroups)
        ? item.keyGroups
          .map((group, groupIndex) => ({
            id: String(group?.id || group?.name || `key-${groupIndex + 1}`).trim(),
            name: String(group?.name || group?.id || `密钥${groupIndex + 1}`).trim(),
            apiKey: String(group?.apiKey || '').trim(),
            __presetId: id,
            __modelOptionsButtons: createApiKeyGroupModelButtons(group?.id || group?.name || `key-${groupIndex + 1}`, id),
            __modelOptionsPreview: createApiKeyGroupModelPreview(modelOptionsCache, id, group?.id || group?.name || `key-${groupIndex + 1}`)
          }))
          .filter(group => group.id || group.name || group.apiKey)
        : []

      return {
        id,
        name: String(item?.name || id || `接口${index + 1}`).trim(),
        baseUrl: String(item?.baseUrl || '').trim(),
        endpointType: normalizeEndpointType(item?.endpointType, 'openai-chat'),
        keyGroups
      }
    })
    .filter(item => item.id || item.name || item.baseUrl || item.keyGroups.length > 0)
}

function normalizeModelOptionsCache(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const cache = {}

  cache.sources = Array.isArray(source.sources)
    ? source.sources
      .map(item => ({
        baseUrl: String(item?.baseUrl || '').trim(),
        endpointType: normalizeEndpointType(item?.endpointType, 'openai-chat'),
        apiPresetId: String(item?.apiPresetId || '').trim(),
        apiKeyGroupId: String(item?.apiKeyGroupId || '').trim(),
        updatedAt: Number(item?.updatedAt) || 0,
        models: Array.isArray(item?.models)
          ? [...new Set(item.models.map(model => String(model || '').trim()).filter(Boolean))]
            .slice(0, MAX_MODEL_OPTIONS_PER_ENTRY)
          : []
      }))
      .filter(item => item.models.length > 0)
      .slice(0, 30)
    : []

  for (const modelType of MODEL_TYPES) {
    const entries = Array.isArray(source[modelType]) ? source[modelType] : []
    cache[modelType] = entries
      .map(item => ({
        baseUrl: String(item?.baseUrl || '').trim(),
        endpointType: normalizeEndpointType(item?.endpointType, 'openai-chat'),
        apiPresetId: String(item?.apiPresetId || '').trim(),
        apiKeyGroupId: String(item?.apiKeyGroupId || '').trim(),
        updatedAt: Number(item?.updatedAt) || 0,
        models: Array.isArray(item?.models)
          ? [...new Set(item.models.map(model => String(model || '').trim()).filter(Boolean))]
            .slice(0, MAX_MODEL_OPTIONS_PER_ENTRY)
          : []
      }))
      .filter(item => item.models.length > 0)
      .slice(0, 12)
  }

  return cache
}

function normalizeFallbackModels(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => ({
      model: String(item?.model || '').trim(),
      apiPresetId: String(item?.apiPresetId || '').trim(),
      apiKeyGroupId: formatApiKeyGroupFormValue(item?.apiPresetId, item?.apiKeyGroupId),
      baseUrl: String(item?.baseUrl || '').trim(),
      apiKey: String(item?.apiKey || '').trim(),
      endpointType: normalizeFallbackEndpointType(item?.endpointType, 'inherit'),
      requestMode: normalizeFallbackRequestMode(item?.requestMode, 'inherit')
    }))
    .filter(item => item.model || item.apiPresetId || item.apiKeyGroupId || item.baseUrl || item.apiKey)
}

export async function getConfigData() {
  const config = Config.getAll()
  const { prompt: _prompt, ...configForGuoba } = config
  const api = { ...(config.api || {}) }
  api.modelOptionsCache = normalizeModelOptionsCache(api.modelOptionsCache)
  api.presets = normalizeApiPresets(api.presets, api.modelOptionsCache)
  const selectionOptions = buildApiSelectionOptions(api)
  const modelFormConfigs = {}

  for (const modelType of MODEL_TYPES) {
    const defaults = MODEL_DEFAULTS[modelType]
    const modelConfig = { ...(api?.[modelType] || {}) }
    const fallbackModels = normalizeFallbackModels(modelConfig.fallbackModels)
    api[modelType] = {
      ...modelConfig,
      apiPresetId: String(modelConfig.apiPresetId || '').trim(),
      apiKeyGroupId: String(modelConfig.apiKeyGroupId || '').trim(),
      endpointType: normalizeEndpointType(modelConfig.endpointType, defaults.endpointType),
      requestMode: normalizeRequestMode(modelConfig.requestMode, defaults.requestMode),
      timeoutMs: normalizeTimeoutMs(modelConfig.timeoutMs, defaults.timeoutMs),
      connectTimeoutMs: normalizeTimeoutMs(modelConfig.connectTimeoutMs, defaults.connectTimeoutMs),
      retryCount: normalizeRetryCount(modelConfig.retryCount, defaults.retryCount),
      fallbackModels
    }
    api[modelType].fallbackModels = fallbackModels.map(item => ({
      ...item,
      ...buildModelRuntimeFields(api, modelType, item, api[modelType], selectionOptions)
    }))

    modelFormConfigs[MODEL_FORM_FIELD_MAP[modelType]] = [{
      ...buildModelRuntimeFields(api, modelType, api[modelType], {}, selectionOptions),
      model: String(api[modelType].model || defaults.model).trim(),
      apiPresetId: api[modelType].apiPresetId,
      apiKeyGroupId: formatApiKeyGroupFormValue(api[modelType].apiPresetId, api[modelType].apiKeyGroupId),
      baseUrl: String(api[modelType].baseUrl || '').trim(),
      apiKey: String(api[modelType].apiKey || '').trim(),
      endpointType: api[modelType].endpointType,
      requestMode: api[modelType].requestMode,
      timeoutMs: api[modelType].timeoutMs,
      connectTimeoutMs: api[modelType].connectTimeoutMs,
      retryCount: api[modelType].retryCount
    }]
  }

  return {
    ...configForGuoba,
    api: {
      ...api,
      modelOptionsCache: formatModelOptionsCacheSummary(api.modelOptionsCache)
    },
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
