import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { setByPath, toPositiveNumberArray } from '../../utils/common.js'
import {
  createScheduledSummaryTask,
  SCHEDULED_SUMMARY_TASK_NAME
} from '../services/taskService.js'

const MODEL_DEFAULTS = {
  search: { model: 'perplexity-search', requestMode: 'response', timeoutMs: 100000, retryCount: 1 },
  image: { model: 'gemini-flash-latest', requestMode: 'response', timeoutMs: 120000, retryCount: 1 },
  summary: { model: 'gemini-flash-latest', requestMode: 'response', timeoutMs: 120000, retryCount: 1 },
  video: { model: 'qwen3-vl-plus', requestMode: 'response', timeoutMs: 180000, retryCount: 1 },
  audio: { model: 'grok-4.1-fast', requestMode: 'response', timeoutMs: 60000, retryCount: 1 }
}

const MODEL_FORM_FIELD_MAP = {
  _apiSearchConfig: { type: 'search', ...MODEL_DEFAULTS.search },
  _apiImageConfig: { type: 'image', ...MODEL_DEFAULTS.image },
  _apiSummaryConfig: { type: 'summary', ...MODEL_DEFAULTS.summary },
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

    for (const [key, value] of Object.entries(data || {})) {
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

      if (MODEL_FORM_FIELD_MAP[key]) {
        const meta = MODEL_FORM_FIELD_MAP[key]
        const current = { ...(nextConfig.api?.[meta.type] || {}) }
        const item = getSingleFormItem(value)

        nextConfig.api[meta.type] = {
          ...current,
          model: String(item.model ?? current.model ?? meta.model).trim() || meta.model,
          baseUrl: String(item.baseUrl ?? current.baseUrl ?? '').trim(),
          apiKey: String(item.apiKey ?? current.apiKey ?? '').trim(),
          requestMode: normalizeRequestMode(item.requestMode ?? current.requestMode ?? meta.requestMode, meta.requestMode),
          timeoutMs: clampInteger(item.timeoutMs ?? current.timeoutMs, 1000, 600000, meta.timeoutMs),
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

    for (const modelType of Object.keys(MODEL_DEFAULTS)) {
      const defaults = MODEL_DEFAULTS[modelType]
      const current = { ...(nextConfig.api?.[modelType] || {}) }
      nextConfig.api[modelType] = {
        ...current,
        model: String(current.model || defaults.model).trim() || defaults.model,
        baseUrl: String(current.baseUrl || '').trim(),
        apiKey: String(current.apiKey || '').trim(),
        requestMode: normalizeRequestMode(current.requestMode, defaults.requestMode),
        timeoutMs: clampInteger(current.timeoutMs, 1000, 600000, defaults.timeoutMs),
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
