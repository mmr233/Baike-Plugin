import { pluginInfo } from './schemas/pluginInfo.js'
import { getApiSchema } from './schemas/apiSchema.js'
import { runtimeSchema } from './schemas/runtimeSchema.js'
import { summarySchema } from './schemas/summarySchema.js'
import { taskSchema } from './schemas/taskSchema.js'
import { promptSchema } from './schemas/promptSchema.js'
import { getConfigData } from './getConfigData.js'
import { setConfigData } from './setConfigData.js'
import Config from '../Config.js'
import ApiService from '../services/apiService.js'

const apiService = new ApiService()
const MODEL_TYPES = ['search', 'image', 'summary', 'jsonRepair', 'video', 'audio']
const MAX_MODEL_OPTIONS_PER_ENTRY = 500

function cleanActionArg(value = '') {
  const text = String(value || '').trim()
  return /^#\{[^}]+\}$/.test(text) ? '' : text
}

async function resetDefaultPrompts(_args, { Result }) {
  try {
    const nextConfig = Config.getAll()
    const defaults = Config.getDefault()
    nextConfig.prompt = { ...(defaults.prompt || {}) }
    if (!Config.setAll(nextConfig)) {
      return Result.error('恢复默认提示词失败')
    }
    return Result.ok({}, '已恢复默认提示词，刷新配置页后可查看最新模板')
  } catch (error) {
    logger.error('[百科查询] 恢复默认提示词失败', error)
    return Result.error(`恢复默认提示词失败：${error.message}`)
  }
}

function parseModelActionArgs(args = []) {
  const [
    modelType,
    scope,
    apiPresetId,
    apiKeyGroupId,
    baseUrl,
    apiKey,
    endpointType,
    connectTimeoutMs,
    timeoutMs
  ] = Array.isArray(args) ? args : []

  return {
    modelType: cleanActionArg(modelType),
    scope: cleanActionArg(scope) || 'primary',
    sourceConfig: {
      apiPresetId: cleanActionArg(apiPresetId),
      apiKeyGroupId: cleanActionArg(apiKeyGroupId),
      baseUrl: cleanActionArg(baseUrl),
      apiKey: cleanActionArg(apiKey),
      endpointType: cleanActionArg(endpointType) || 'inherit',
      connectTimeoutMs,
      timeoutMs
    }
  }
}

function normalizeModelOptionsCache(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => ({
      baseUrl: String(item?.baseUrl || '').trim(),
      endpointType: String(item?.endpointType || '').trim(),
      apiPresetId: String(item?.apiPresetId || '').trim(),
      apiKeyGroupId: String(item?.apiKeyGroupId || '').trim(),
      updatedAt: Number(item?.updatedAt) || 0,
      models: Array.isArray(item?.models)
        ? [...new Set(item.models.map(model => String(model || '').trim()).filter(Boolean))]
          .slice(0, MAX_MODEL_OPTIONS_PER_ENTRY)
        : []
    }))
    .filter(item => item.models.length > 0)
}

function createModelOptionsCacheEntryKey(entry = {}) {
  return [
    String(entry.endpointType || '').trim(),
    String(entry.apiPresetId || '').trim(),
    String(entry.apiKeyGroupId || '').trim(),
    String(entry.baseUrl || '').trim().replace(/\/+$/, '')
  ].join('|')
}

async function refreshModelOptions(args, { Result }) {
  try {
    const { modelType, sourceConfig } = parseModelActionArgs(args)
    if (!MODEL_TYPES.includes(modelType)) {
      return Result.error('模型类型无效，无法刷新模型列表')
    }

    const currentConfig = Config.getAll()
    const modelConfig = currentConfig.api?.[modelType] || {}
    const result = await apiService.fetchModelList(sourceConfig, {
      apiConfig: currentConfig.api || {},
      inherited: modelConfig,
      defaultTimeoutMs: 30000,
      connectTimeoutMs: sourceConfig.connectTimeoutMs || modelConfig.connectTimeoutMs || 30000
    })

    if (result.models.length === 0) {
      return Result.error('接口已返回，但没有解析到可用模型')
    }

    const nextConfig = Config.getAll()
    nextConfig.api = { ...(nextConfig.api || {}) }
    nextConfig.api.modelOptionsCache = { ...(nextConfig.api.modelOptionsCache || {}) }

    const entry = {
      baseUrl: result.baseUrl,
      endpointType: result.endpointType,
      apiPresetId: result.apiPresetId,
      apiKeyGroupId: result.apiKeyGroupId,
      updatedAt: Date.now(),
      models: result.models.slice(0, MAX_MODEL_OPTIONS_PER_ENTRY)
    }
    const entryKey = createModelOptionsCacheEntryKey(entry)
    const previousEntries = normalizeModelOptionsCache(nextConfig.api.modelOptionsCache[modelType])
      .filter(item => createModelOptionsCacheEntryKey(item) !== entryKey)

    nextConfig.api.modelOptionsCache[modelType] = [entry, ...previousEntries].slice(0, 12)

    if (!Config.setAll(nextConfig)) {
      return Result.error('模型列表获取成功，但写入缓存失败')
    }

    const sourceText = result.apiPresetId
      ? `${result.apiPresetId}${result.apiKeyGroupId ? `/${result.apiKeyGroupId}` : ''}`
      : result.baseUrl
    return Result.ok(
      { count: result.models.length },
      `已获取 ${result.models.length} 个模型（${sourceText}）。请刷新或重新打开配置页后，在模型名输入框中选择。`
    )
  } catch (error) {
    logger.error('[百科查询] 刷新模型列表失败', error)
    return Result.error(`刷新模型列表失败：${error.message}`)
  }
}

export function supportGuoba() {
  return {
    pluginInfo,
    configInfo: {
      schemas: [
        ...getApiSchema(),
        ...runtimeSchema,
        ...summarySchema,
        ...taskSchema,
        ...promptSchema
      ],
      getConfigData,
      setConfigData,
      actions: {
        resetDefaultPrompts,
        refreshModelOptions
      }
    }
  }
}
