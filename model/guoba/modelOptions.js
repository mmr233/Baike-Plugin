const MAX_MODEL_OPTIONS_PER_ENTRY = 500

function normalizeText(value = '') {
  return String(value || '').trim()
}

function normalizeBaseUrl(value = '') {
  return normalizeText(value).replace(/\/+$/, '')
}

function normalizeEndpointType(value = '', fallback = 'openai-chat') {
  const normalized = normalizeText(value).toLowerCase()
  return ['inherit', 'openai-chat', 'openai-responses', 'anthropic-messages', 'gemini-native'].includes(normalized)
    ? normalized
    : fallback
}

export function parseApiKeyGroupRef(value = '') {
  const raw = normalizeText(value)
  if (!raw) {
    return { presetId: '', keyGroupId: '' }
  }

  for (const delimiter of ['::', '/', '|']) {
    if (raw.includes(delimiter)) {
      const [presetId, ...rest] = raw.split(delimiter)
      return {
        presetId: normalizeText(presetId),
        keyGroupId: normalizeText(rest.join(delimiter))
      }
    }
  }

  return { presetId: '', keyGroupId: raw }
}

export function normalizeModelCacheEntries(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => ({
      baseUrl: normalizeBaseUrl(item?.baseUrl),
      endpointType: normalizeEndpointType(item?.endpointType, 'openai-chat'),
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

export function getModelCacheEntriesForType(modelOptionsCache = {}, modelType = '') {
  const cache = modelOptionsCache && typeof modelOptionsCache === 'object'
    ? modelOptionsCache
    : {}
  const sharedEntries = normalizeModelCacheEntries(cache.sources)
  const scopedEntries = normalizeModelCacheEntries(cache[normalizeText(modelType)])
  return [...sharedEntries, ...scopedEntries]
}

function normalizeApiPresets(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => {
      const id = normalizeText(item?.id || item?.name || `preset-${index + 1}`)
      const keyGroups = Array.isArray(item?.keyGroups)
        ? item.keyGroups
          .map((group, groupIndex) => ({
            id: normalizeText(group?.id || group?.name || `key-${groupIndex + 1}`),
            name: normalizeText(group?.name || group?.id || `密钥${groupIndex + 1}`),
            apiKey: normalizeText(group?.apiKey)
          }))
          .filter(group => group.id || group.name || group.apiKey)
        : []

      return {
        id,
        name: normalizeText(item?.name || id || `接口${index + 1}`),
        baseUrl: normalizeBaseUrl(item?.baseUrl),
        endpointType: normalizeEndpointType(item?.endpointType, 'openai-chat'),
        keyGroups
      }
    })
    .filter(item => item.id || item.name || item.baseUrl || item.keyGroups.length > 0)
}

function findApiPreset(apiConfig = {}, presetId = '') {
  const actualPresetId = normalizeText(presetId)
  if (!actualPresetId) {
    return null
  }

  return normalizeApiPresets(apiConfig.presets)
    .find(item => item.id === actualPresetId) || null
}

function findApiKeyGroup(preset = null, keyGroupId = '') {
  if (!preset || !Array.isArray(preset.keyGroups) || preset.keyGroups.length === 0) {
    return null
  }

  const actualKeyGroupId = normalizeText(keyGroupId)
  if (!actualKeyGroupId) {
    return preset.keyGroups.find(item => item.apiKey) || preset.keyGroups[0] || null
  }

  return preset.keyGroups.find(item => item.id === actualKeyGroupId) || null
}

export function resolveModelOptionSource(apiConfig = {}, sourceConfig = {}, inherited = {}) {
  const groupRef = parseApiKeyGroupRef(sourceConfig.apiKeyGroupId)
  const explicitPresetId = normalizeText(groupRef.presetId || sourceConfig.apiPresetId)
  const explicitKeyGroupId = normalizeText(groupRef.keyGroupId)
  const hasExplicitPreset = Boolean(explicitPresetId)
  const apiPresetId = normalizeText(explicitPresetId || inherited.apiPresetId)
  const requestedApiKeyGroupId = normalizeText(
    explicitKeyGroupId
    || (hasExplicitPreset ? '' : inherited.apiKeyGroupId)
  )
  const preset = findApiPreset(apiConfig, apiPresetId)
  const keyGroup = findApiKeyGroup(preset, requestedApiKeyGroupId)
  const apiKeyGroupId = normalizeText(keyGroup?.id || requestedApiKeyGroupId)
  const explicitEndpointType = normalizeEndpointType(sourceConfig.endpointType, 'inherit')
  const presetEndpointType = preset?.endpointType
    ? normalizeEndpointType(preset.endpointType, 'openai-chat')
    : ''
  const inheritedEndpointType = inherited.endpointType
    ? normalizeEndpointType(inherited.endpointType, 'openai-chat')
    : ''
  const endpointType = explicitEndpointType === 'inherit'
    ? (hasExplicitPreset
        ? (presetEndpointType || inheritedEndpointType || 'openai-chat')
        : (inheritedEndpointType || presetEndpointType || 'openai-chat'))
    : normalizeEndpointType(explicitEndpointType, presetEndpointType || inheritedEndpointType || 'openai-chat')
  const baseUrl = normalizeBaseUrl(
    sourceConfig.baseUrl
    || (hasExplicitPreset ? preset?.baseUrl : inherited.baseUrl)
    || (hasExplicitPreset ? inherited.baseUrl : preset?.baseUrl)
    || apiConfig.primaryBaseUrl
  )

  return {
    apiPresetId,
    apiKeyGroupId,
    baseUrl,
    endpointType
  }
}

export function formatModelCacheSource(entry = {}) {
  if (entry.apiPresetId && entry.apiKeyGroupId) {
    return `${entry.apiPresetId}/${entry.apiKeyGroupId}`
  }
  if (entry.apiPresetId) {
    return entry.apiPresetId
  }
  if (entry.baseUrl) {
    return entry.baseUrl.replace(/^https?:\/\//i, '')
  }
  return entry.endpointType || '模型列表'
}

function createOptionsForEntries(entries = []) {
  const seen = new Set()
  const modelOptions = []

  for (const entry of entries) {
    const sourceLabel = formatModelCacheSource(entry)
    for (const model of entry.models || []) {
      if (seen.has(model)) {
        continue
      }
      seen.add(model)
      modelOptions.push({
        value: model,
        label: sourceLabel ? `${model}（${sourceLabel}）` : model
      })
    }
  }

  return modelOptions
}

function addOptionsMapEntry(map = {}, key = '', options = []) {
  const actualKey = normalizeText(key)
  if (!actualKey || options.length === 0) {
    return
  }

  const seen = new Set((map[actualKey] || []).map(item => item?.value).filter(Boolean))
  const merged = [...(map[actualKey] || [])]
  for (const option of options) {
    if (!option?.value || seen.has(option.value)) {
      continue
    }
    seen.add(option.value)
    merged.push(option)
  }
  map[actualKey] = merged
}

function addEndpointVariants(map = {}, keyPrefix = '', endpointType = '', options = []) {
  const prefix = normalizeText(keyPrefix)
  const endpoint = normalizeEndpointType(endpointType, 'openai-chat')
  if (!prefix) {
    return
  }

  addOptionsMapEntry(map, `${prefix}::${endpoint}`, options)
  addOptionsMapEntry(map, `${prefix}::inherit`, options)
}

function getDefaultKeyGroupIdByPreset(apiConfig = {}) {
  const result = {}
  for (const preset of normalizeApiPresets(apiConfig.presets)) {
    const keyGroup = findApiKeyGroup(preset, '')
    if (preset.id && keyGroup?.id) {
      result[preset.id] = keyGroup.id
    }
  }
  return result
}

export function buildModelOptionsMapFromCache(cacheEntries = [], options = {}) {
  const entries = normalizeModelCacheEntries(cacheEntries)
  const map = {}
  const defaultKeyGroupIdByPreset = getDefaultKeyGroupIdByPreset(options.apiConfig || {})
  const entriesByEndpoint = new Map()

  for (const entry of entries) {
    const entryOptions = createOptionsForEntries([entry])
    const endpointType = entry.endpointType || 'openai-chat'
    if (!entriesByEndpoint.has(endpointType)) {
      entriesByEndpoint.set(endpointType, [])
    }
    entriesByEndpoint.get(endpointType).push(entry)

    if (entry.baseUrl) {
      addEndpointVariants(map, `base:${entry.baseUrl}`, endpointType, entryOptions)
    }

    if (entry.apiPresetId) {
      const keyGroupId = entry.apiKeyGroupId || defaultKeyGroupIdByPreset[entry.apiPresetId] || ''
      if (keyGroupId) {
        addEndpointVariants(map, `${entry.apiPresetId}::${keyGroupId}`, endpointType, entryOptions)
        addEndpointVariants(map, `${entry.apiPresetId}::${entry.apiPresetId}::${keyGroupId}`, endpointType, entryOptions)
        addEndpointVariants(map, `::${entry.apiPresetId}::${keyGroupId}`, endpointType, entryOptions)
      }
      if (!entry.apiKeyGroupId || entry.apiKeyGroupId === defaultKeyGroupIdByPreset[entry.apiPresetId]) {
        addEndpointVariants(map, `${entry.apiPresetId}::`, endpointType, entryOptions)
      }
    }
  }

  const allOptions = createOptionsForEntries(entries)
  addOptionsMapEntry(map, 'empty:|||', allOptions)
  addOptionsMapEntry(map, 'empty:|||inherit', allOptions)
  for (const [endpointType, endpointEntries] of entriesByEndpoint.entries()) {
    addOptionsMapEntry(map, `empty:|||${endpointType}`, createOptionsForEntries(endpointEntries))
  }

  return map
}

function sourceHasIdentity(source = {}) {
  return Boolean(source.apiPresetId || source.apiKeyGroupId || source.baseUrl)
}

function isSameSource(entry = {}, source = {}) {
  if (!sourceHasIdentity(source)) {
    return false
  }

  if (source.apiPresetId) {
    if (entry.apiPresetId !== source.apiPresetId) {
      return false
    }
    if (source.apiKeyGroupId && entry.apiKeyGroupId !== source.apiKeyGroupId) {
      return false
    }
  } else if (source.baseUrl) {
    if (normalizeBaseUrl(entry.baseUrl) !== source.baseUrl) {
      return false
    }
  }

  if (source.endpointType && entry.endpointType && entry.endpointType !== source.endpointType) {
    return false
  }

  return true
}

export function buildModelOptionsFromCache(cacheEntries = [], options = {}) {
  const entries = normalizeModelCacheEntries(cacheEntries)
  const source = options.source
    || resolveModelOptionSource(options.apiConfig || {}, options.sourceConfig || {}, options.inherited || {})
  const matchedEntries = entries.filter(entry => isSameSource(entry, source))
  const fallbackToAll = options.fallbackToAll !== false
  const actualEntries = matchedEntries.length > 0
    ? matchedEntries
    : (fallbackToAll || !sourceHasIdentity(source) ? entries : [])

  return createOptionsForEntries(actualEntries)
}
