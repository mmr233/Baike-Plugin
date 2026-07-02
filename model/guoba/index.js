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
const MAX_MODEL_OPTIONS_PER_ENTRY = 500

function cleanActionArg(value = '') {
  const text = String(value || '').trim()
  return /^#\{[^}]+\}$/.test(text) ? '' : text
}

function normalizeText(value = '') {
  return String(value || '').trim()
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

function normalizeModelOptionsEntries(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => ({
      baseUrl: normalizeText(item?.baseUrl).replace(/\/+$/, ''),
      endpointType: normalizeText(item?.endpointType) || 'openai-chat',
      apiPresetId: normalizeText(item?.apiPresetId),
      apiKeyGroupId: normalizeText(item?.apiKeyGroupId),
      updatedAt: Number(item?.updatedAt) || 0,
      models: Array.isArray(item?.models)
        ? [...new Set(item.models.map(model => normalizeText(model)).filter(Boolean))]
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

function upsertModelOptionsCacheEntry(modelOptionsCache = {}, entry = {}, legacyModelType = '') {
  const cache = modelOptionsCache && typeof modelOptionsCache === 'object'
    ? { ...modelOptionsCache }
    : {}
  const normalizedEntry = normalizeModelOptionsEntries([entry])[0]
  if (!normalizedEntry) {
    return cache
  }

  const entryKey = createModelOptionsCacheEntryKey(normalizedEntry)
  const sourceEntries = normalizeModelOptionsEntries(cache.sources)
    .filter(item => createModelOptionsCacheEntryKey(item) !== entryKey)
  cache.sources = [normalizedEntry, ...sourceEntries].slice(0, 30)

  if (legacyModelType) {
    const previousEntries = normalizeModelOptionsEntries(cache[legacyModelType])
      .filter(item => createModelOptionsCacheEntryKey(item) !== entryKey)
    cache[legacyModelType] = [normalizedEntry, ...previousEntries].slice(0, 12)
  }

  return cache
}

async function refreshModelOptions(args, { Result }) {
  try {
    const { modelType, sourceConfig } = parseModelActionArgs(args)
    const currentConfig = Config.getAll()
    const modelConfig = currentConfig.api?.[modelType] || {}
    const result = await apiService.fetchModelList(sourceConfig, {
      apiConfig: currentConfig.api || {},
      inherited: modelConfig,
      defaultTimeoutMs: 30000,
      connectTimeoutMs: sourceConfig.connectTimeoutMs || modelConfig.connectTimeoutMs || 30000,
      retryCount: 2
    })

    if (result.models.length === 0) {
      return Result.error('接口已返回，但没有解析到可用模型')
    }

    const nextConfig = Config.getAll()
    nextConfig.api = { ...(nextConfig.api || {}) }
    nextConfig.api.modelOptionsCache = { ...(nextConfig.api.modelOptionsCache || {}) }

    nextConfig.api.modelOptionsCache = upsertModelOptionsCacheEntry(nextConfig.api.modelOptionsCache, {
      baseUrl: result.baseUrl,
      endpointType: result.endpointType,
      apiPresetId: result.apiPresetId,
      apiKeyGroupId: result.apiKeyGroupId,
      updatedAt: Date.now(),
      models: result.models.slice(0, MAX_MODEL_OPTIONS_PER_ENTRY)
    }, modelType)

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
    return Result.error(`刷新模型列表失败：${apiService.formatErrorWithCause(error)}`)
  }
}

function resolveApiKeyGroupSource(args = []) {
  const [rawKeyGroupId, rawPresetId] = Array.isArray(args) ? args : []
  const keyGroupId = cleanActionArg(rawKeyGroupId)
  const presetId = cleanActionArg(rawPresetId)
  const apiConfig = Config.get('api', {})

  if (presetId) {
    return { apiPresetId: presetId, apiKeyGroupId: keyGroupId }
  }

  const presets = Array.isArray(apiConfig.presets) ? apiConfig.presets : []
  const matches = presets
    .map(preset => {
      const matchedGroup = Array.isArray(preset?.keyGroups)
        ? preset.keyGroups.find(group => normalizeText(group?.id) === keyGroupId)
        : null
      return matchedGroup ? { preset, matchedGroup } : null
    })
    .filter(Boolean)

  if (matches.length === 1) {
    return {
      apiPresetId: normalizeText(matches[0].preset?.id),
      apiKeyGroupId: keyGroupId
    }
  }

  if (matches.length > 1) {
    throw new Error(`密钥分组 ID「${keyGroupId}」存在于多个接口中，请为密钥分组设置唯一 ID 后再获取模型列表`)
  }

  return { apiPresetId: '', apiKeyGroupId: keyGroupId }
}

async function refreshApiKeyGroupModelOptions(args, { Result }) {
  try {
    const sourceConfig = resolveApiKeyGroupSource(args)
    if (!sourceConfig.apiPresetId || !sourceConfig.apiKeyGroupId) {
      return Result.error('请先保存接口预设和密钥分组，再在对应密钥分组中获取模型列表')
    }

    const currentConfig = Config.getAll()
    const result = await apiService.fetchModelList(sourceConfig, {
      apiConfig: currentConfig.api || {},
      defaultTimeoutMs: 30000,
      connectTimeoutMs: 30000,
      retryCount: 2
    })

    if (result.models.length === 0) {
      return Result.error('接口已连通，但没有解析到可用模型')
    }

    const nextConfig = Config.getAll()
    nextConfig.api = { ...(nextConfig.api || {}) }
    nextConfig.api.modelOptionsCache = upsertModelOptionsCacheEntry(nextConfig.api.modelOptionsCache, {
      baseUrl: result.baseUrl,
      endpointType: result.endpointType,
      apiPresetId: result.apiPresetId,
      apiKeyGroupId: result.apiKeyGroupId,
      updatedAt: Date.now(),
      models: result.models.slice(0, MAX_MODEL_OPTIONS_PER_ENTRY)
    })

    if (!Config.setAll(nextConfig)) {
      return Result.error('模型列表获取成功，但写入缓存失败')
    }

    const sourceText = `${result.apiPresetId}/${result.apiKeyGroupId}`
    return Result.ok(
      { count: result.models.length },
      `接口密钥可用，已获取 ${result.models.length} 个模型（${sourceText}）。刷新或重新打开配置页后即可在各模型配置中选择。`
    )
  } catch (error) {
    logger.error('[百科查询] 获取接口密钥分组模型列表失败', error)
    return Result.error(`获取模型列表失败：${apiService.formatErrorWithCause(error)}`)
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
        refreshModelOptions,
        refreshApiKeyGroupModelOptions
      }
    }
  }
}
