import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { setByPath, toPositiveNumberArray } from '../../utils/common.js'
import {
  createScheduledSummaryTask,
  SCHEDULED_SUMMARY_TASK_NAME
} from '../services/taskService.js'

const MODEL_DEFAULTS = {
  search: { model: 'perplexity-search', endpointType: 'inherit', requestMode: 'response', timeoutMs: 100000, connectTimeoutMs: 30000, retryCount: 1 },
  image: { model: 'gemini-flash-latest', endpointType: 'inherit', requestMode: 'response', timeoutMs: 120000, connectTimeoutMs: 30000, retryCount: 1 },
  summary: { model: 'gemini-flash-latest', endpointType: 'inherit', requestMode: 'response', timeoutMs: 120000, connectTimeoutMs: 30000, retryCount: 1 },
  jsonRepair: { model: 'gemini-flash-latest', endpointType: 'inherit', requestMode: 'response', timeoutMs: 60000, connectTimeoutMs: 30000, retryCount: 1 },
  video: { model: 'qwen3-vl-plus', endpointType: 'inherit', requestMode: 'response', timeoutMs: 180000, connectTimeoutMs: 30000, retryCount: 1 },
  audio: { model: 'grok-4.1-fast', endpointType: 'inherit', requestMode: 'response', timeoutMs: 60000, connectTimeoutMs: 30000, retryCount: 1 }
}
const MAX_MODEL_OPTIONS_PER_ENTRY = 500

const MODEL_FORM_FIELD_MAP = {
  _apiSearchConfig: { type: 'search', ...MODEL_DEFAULTS.search },
  _apiImageConfig: { type: 'image', ...MODEL_DEFAULTS.image },
  _apiSummaryConfig: { type: 'summary', ...MODEL_DEFAULTS.summary },
  _apiJsonRepairConfig: { type: 'jsonRepair', ...MODEL_DEFAULTS.jsonRepair },
  _apiVideoConfig: { type: 'video', ...MODEL_DEFAULTS.video },
  _apiAudioConfig: { type: 'audio', ...MODEL_DEFAULTS.audio }
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

function normalizeRequestMode(value, fallback = 'response') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['response', 'stream'].includes(normalized) ? normalized : fallback
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

function parseApiKeyGroupRef(value = '') {
  const raw = String(value || '').trim()
  if (!raw) {
    return { presetId: '', keyGroupId: '' }
  }

  for (const delimiter of ['::', '/', '|']) {
    if (raw.includes(delimiter)) {
      const [presetId, ...rest] = raw.split(delimiter)
      return {
        presetId: String(presetId || '').trim(),
        keyGroupId: String(rest.join(delimiter) || '').trim()
      }
    }
  }

  return { presetId: '', keyGroupId: raw }
}

function slugifyId(value = '', fallback = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || fallback
}

function normalizeApiPresets(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      const id = slugifyId(item?.id || item?.name, `preset-${index + 1}`)
      const keyGroups = Array.isArray(item?.keyGroups)
        ? item.keyGroups
          .map((group, groupIndex) => {
            const groupId = slugifyId(group?.id || group?.name, `key-${groupIndex + 1}`)
            return {
              id: groupId,
              name: String(group?.name || groupId || `密钥${groupIndex + 1}`).trim(),
              apiKey: String(group?.apiKey || '').trim()
            }
          })
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

  cache.sources = Array.isArray(source.sources) ? source.sources
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
    .slice(0, 30) : []

  for (const modelType of Object.keys(MODEL_DEFAULTS)) {
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
    .map(item => {
      const keyGroupRef = parseApiKeyGroupRef(item?.apiKeyGroupId)
      return {
        model: String(item?.model || '').trim(),
        apiPresetId: String(keyGroupRef.presetId || item?.apiPresetId || '').trim(),
        apiKeyGroupId: String(keyGroupRef.keyGroupId || item?.apiKeyGroupId || '').trim(),
        baseUrl: String(item?.baseUrl || '').trim(),
        apiKey: String(item?.apiKey || '').trim(),
        endpointType: normalizeFallbackEndpointType(item?.endpointType, 'inherit'),
        requestMode: normalizeFallbackRequestMode(item?.requestMode, 'inherit')
      }
    })
    .filter(item => item.model || item.apiPresetId || item.apiKeyGroupId || item.baseUrl || item.apiKey)
}

function getSingleFormItem(value) {
  if (Array.isArray(value)) {
    return (value.find(item => item && typeof item === 'object') || {})
  }

  return (value && typeof value === 'object') ? value : {}
}

async function refreshPluginTasks() {
  try {
    if (!globalThis.Bot?.stat && !global.Bot?.stat) {
      return false
    }

    const { default: PluginsLoader } = await import('../../../../lib/plugins/loader.js')
    if (PluginsLoader && Array.isArray(PluginsLoader.task)) {
      PluginsLoader.task = PluginsLoader.task.filter(item => {
        if (String(item?.name || '') !== SCHEDULED_SUMMARY_TASK_NAME) {
          return true
        }

        try {
          item?.job?.cancel?.()
        } catch {}

        return false
      })

      const scheduledTask = createScheduledSummaryTask()
      if (scheduledTask) {
        PluginsLoader.task.push(scheduledTask)
      }
    }

    if (typeof PluginsLoader?.createTask === 'function') {
      PluginsLoader.createTask()
      return true
    }
  } catch (error) {
    logger.debug?.('[百科查询] 定时任务刷新跳过', error)
  }

  return false
}

export async function setConfigData(data, { Result }) {
  try {
    const nextConfig = Config.getAll()
    nextConfig.api = { ...(nextConfig.api || {}) }
    const preservedModelOptionsCache = nextConfig.api.modelOptionsCache

    for (const [key, value] of Object.entries(data || {})) {
      if (key === 'prompt' || key.startsWith('prompt.')) {
        continue
      }

      if (key === 'api.modelOptionsCache' || key.startsWith('api.modelOptionsCache.')) {
        continue
      }

      if (key === 'api') {
        const apiValue = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
        delete apiValue.modelOptionsCache
        nextConfig.api = {
          ...nextConfig.api,
          ...apiValue,
          modelOptionsCache: preservedModelOptionsCache
        }
        continue
      }

      if (key === 'scheduledSummary.groups') {
        setByPath(nextConfig, key, toPositiveNumberArray(value))
        continue
      }

      if (key === '_apiPrimaryConfig') {
        const item = getSingleFormItem(value)
        nextConfig.api.primaryBaseUrl = String(item.primaryBaseUrl ?? nextConfig.api.primaryBaseUrl ?? '').trim()
        nextConfig.api.primaryApiKey = String(item.primaryApiKey ?? nextConfig.api.primaryApiKey ?? '').trim()
        continue
      }

      if (key === 'api.presets') {
        nextConfig.api.presets = normalizeApiPresets(value)
        continue
      }

      if (MODEL_FORM_FIELD_MAP[key]) {
        const meta = MODEL_FORM_FIELD_MAP[key]
        const current = { ...(nextConfig.api?.[meta.type] || {}) }
        const item = getSingleFormItem(value)
        const keyGroupRef = parseApiKeyGroupRef(item.apiKeyGroupId)

        nextConfig.api[meta.type] = {
          ...current,
          model: String(item.model ?? current.model ?? meta.model).trim() || meta.model,
          apiPresetId: String(keyGroupRef.presetId || (item.apiPresetId ?? current.apiPresetId ?? '')).trim(),
          apiKeyGroupId: String(keyGroupRef.keyGroupId || (item.apiKeyGroupId ?? current.apiKeyGroupId ?? '')).trim(),
          baseUrl: String(item.baseUrl ?? current.baseUrl ?? '').trim(),
          apiKey: String(item.apiKey ?? current.apiKey ?? '').trim(),
          endpointType: normalizeEndpointType(item.endpointType ?? current.endpointType ?? meta.endpointType, meta.endpointType),
          requestMode: normalizeRequestMode(item.requestMode ?? current.requestMode ?? meta.requestMode, meta.requestMode),
          timeoutMs: clampInteger(item.timeoutMs ?? current.timeoutMs, 1000, 600000, meta.timeoutMs),
          connectTimeoutMs: clampInteger(item.connectTimeoutMs ?? current.connectTimeoutMs, 1000, 600000, meta.connectTimeoutMs),
          retryCount: clampInteger(item.retryCount ?? current.retryCount, 0, 5, meta.retryCount)
        }
        continue
      }

      setByPath(nextConfig, key, value)
    }

    nextConfig.scheduledSummary = {
      ...(nextConfig.scheduledSummary || {}),
      groups: toPositiveNumberArray(nextConfig.scheduledSummary?.groups),
      hour: clampInteger(nextConfig.scheduledSummary?.hour, 0, 23, 22),
      minute: clampInteger(nextConfig.scheduledSummary?.minute, 0, 59, 0),
      second: clampInteger(nextConfig.scheduledSummary?.second, 0, 59, 0),
      messageCount: clampInteger(nextConfig.scheduledSummary?.messageCount, 50, 2000, 300)
    }

    nextConfig.api.primaryBaseUrl = String(nextConfig.api.primaryBaseUrl || '').trim()
    nextConfig.api.primaryApiKey = String(nextConfig.api.primaryApiKey || '').trim()
    nextConfig.api.presets = normalizeApiPresets(nextConfig.api.presets)
    nextConfig.api.modelOptionsCache = normalizeModelOptionsCache(preservedModelOptionsCache)

    for (const modelType of Object.keys(MODEL_DEFAULTS)) {
      const defaults = MODEL_DEFAULTS[modelType]
      const current = { ...(nextConfig.api?.[modelType] || {}) }
      nextConfig.api[modelType] = {
        ...current,
        model: String(current.model || defaults.model).trim() || defaults.model,
        apiPresetId: String(current.apiPresetId || '').trim(),
        apiKeyGroupId: String(current.apiKeyGroupId || '').trim(),
        baseUrl: String(current.baseUrl || '').trim(),
        apiKey: String(current.apiKey || '').trim(),
        endpointType: normalizeEndpointType(current.endpointType, defaults.endpointType),
        requestMode: normalizeRequestMode(current.requestMode, defaults.requestMode),
        timeoutMs: clampInteger(current.timeoutMs, 1000, 600000, defaults.timeoutMs),
        connectTimeoutMs: clampInteger(current.connectTimeoutMs, 1000, 600000, defaults.connectTimeoutMs),
        fallbackModels: normalizeFallbackModels(current.fallbackModels),
        retryCount: clampInteger(current.retryCount, 0, 5, defaults.retryCount)
      }
    }

    if (!Config.setAll(nextConfig)) {
      return Result.error('保存失败')
    }

    const taskRefreshed = await refreshPluginTasks()
    logger.mark(
      `[${pluginName}] 锅巴配置保存成功${taskRefreshed ? '，定时任务已刷新' : ''}`
    )
    return Result.ok({}, taskRefreshed ? '保存成功，定时任务已刷新' : '保存成功')
  } catch (error) {
    logger.error('[百科查询] 锅巴保存配置失败', error)
    return Result.error(`保存失败：${error.message}`)
  }
}
