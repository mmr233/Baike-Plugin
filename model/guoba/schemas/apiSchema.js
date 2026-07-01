import { enhanceSchemas } from './schemaHelpers.js'
import Config from '../../Config.js'

const MAX_MODEL_OPTIONS_PER_ENTRY = 500

const requestModeOptions = [
  { label: '流式请求', value: 'stream' },
  { label: '等待一次性输出', value: 'response' }
]

const fallbackRequestModeOptions = [
  { label: '继承主配置', value: 'inherit' },
  ...requestModeOptions
]

const endpointTypeOptions = [
  { label: 'OpenAI Chat Completions', value: 'openai-chat' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Claude Messages', value: 'anthropic-messages' },
  { label: 'Gemini Native', value: 'gemini-native' }
]

const fallbackEndpointTypeOptions = [
  { label: '继承主配置', value: 'inherit' },
  ...endpointTypeOptions
]

const modelEndpointTypeOptions = [
  { label: '继承接口预设', value: 'inherit' },
  ...endpointTypeOptions
]

const defaultApiPresetOptions = [
  { label: '自定义/旧主接口', value: '' }
]

const defaultApiKeyGroupOptions = [
  { label: '继承接口默认密钥', value: '' }
]

function normalizeText(value = '') {
  return String(value || '').trim()
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
            name: normalizeText(group?.name || group?.id || `密钥${groupIndex + 1}`)
          }))
          .filter(group => group.id)
        : []

      return {
        id,
        name: normalizeText(item?.name || id || `接口${index + 1}`),
        keyGroups
      }
    })
    .filter(item => item.id)
}

function formatOptionLabel(name = '', id = '') {
  const normalizedName = normalizeText(name)
  const normalizedId = normalizeText(id)
  if (!normalizedName) {
    return normalizedId
  }
  return normalizedName === normalizedId ? normalizedName : `${normalizedName}（${normalizedId}）`
}

function buildApiSelectionOptions() {
  const apiConfig = Config.get('api', {})
  const presets = normalizeApiPresets(apiConfig.presets)
  const apiPresetOptions = [
    ...defaultApiPresetOptions,
    ...presets.map(item => ({
      label: formatOptionLabel(item.name, item.id),
      value: item.id
    }))
  ]
  const groupedKeyOptions = presets
    .map(preset => ({
      label: formatOptionLabel(preset.name, preset.id),
      options: preset.keyGroups.map(group => ({
        label: formatOptionLabel(group.name, group.id),
        value: `${preset.id}::${group.id}`
      }))
    }))
    .filter(group => group.options.length > 0)

  return {
    apiPresetOptions,
    apiKeyGroupOptions: [
      ...defaultApiKeyGroupOptions,
      ...groupedKeyOptions
    ]
  }
}

function normalizeModelCacheEntries(value = []) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(item => ({
      baseUrl: normalizeText(item?.baseUrl),
      endpointType: normalizeText(item?.endpointType),
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

function formatModelCacheSource(entry = {}) {
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

function buildModelOptions(modelType = '') {
  const cache = Config.get(`api.modelOptionsCache.${modelType}`, [])
  const entries = normalizeModelCacheEntries(cache)
  const seen = new Set()
  const options = []

  for (const entry of entries) {
    const source = formatModelCacheSource(entry)
    for (const model of entry.models) {
      if (seen.has(model)) {
        continue
      }
      seen.add(model)
      options.push({
        value: model,
        label: source ? `${model}（${source}）` : model
      })
    }
  }

  return options
}

function createRefreshModelOptionsSchema(modelType = '', scope = 'primary') {
  return {
    field: `__refreshModelOptions_${modelType}_${scope}`,
    label: '模型列表',
    bottomHelpMessage: '按当前接口预设、密钥分组、自定义地址和接口格式获取模型列表；获取后刷新或重新打开配置页即可在模型名输入框中选择，仍可手动输入自定义模型',
    component: 'GButtons',
    runtimeOnly: true,
    save: false,
    componentProps: {
      buttons: [
        {
          label: '刷新模型列表',
          type: 'primary',
          action: 'refreshModelOptions',
          args: [
            modelType,
            scope,
            '#{apiPresetId}',
            '#{apiKeyGroupId}',
            '#{baseUrl}',
            '#{apiKey}',
            '#{endpointType}',
            '#{connectTimeoutMs}',
            '#{timeoutMs}'
          ]
        }
      ]
    }
  }
}

function createSingleConfigForm(field, label, bottomHelpMessage, schemas) {
  return {
    field,
    label,
    bottomHelpMessage,
    component: 'GSubForm',
    defaultValue: [{}],
    componentProps: {
      multiple: true,
      showAdd: false,
      showRemove: false,
      schemas
    }
  }
}

function createModelConfigSchemas({
  modelType,
  modelLabel,
  modelPlaceholder,
  timeoutLabel,
  timeoutHelp,
  timeoutDefault,
  retryLabel,
  retryHelp,
  apiPresetOptions,
  apiKeyGroupOptions
}) {
  const modelOptions = buildModelOptions(modelType)

  return [
    {
      field: 'model',
      label: modelLabel,
      bottomHelpMessage: '可手动输入模型名；也可先刷新模型列表，再从候选项中快速选择',
      component: 'AutoComplete',
      componentProps: {
        placeholder: modelPlaceholder,
        options: modelOptions,
        allowClear: true
      }
    },
    {
      field: 'apiPresetId',
      label: `${modelLabel.replace('模型名', '')}接口预设`,
      bottomHelpMessage: '选择在“接口预设”中配置的接口；留空则使用下面的自定义地址，或回退旧主接口地址',
      component: 'Select',
      defaultValue: '',
      componentProps: {
        options: apiPresetOptions,
        showSearch: true,
        optionFilterProp: 'label',
        placeholder: '自定义/旧主接口'
      }
    },
    {
      field: 'apiKeyGroupId',
      label: `${modelLabel.replace('模型名', '')}密钥分组`,
      bottomHelpMessage: '选择接口预设下的密钥分组；留空则使用所选接口的第一个可用密钥，或回退旧主接口密钥',
      component: 'Select',
      defaultValue: '',
      componentProps: {
        options: apiKeyGroupOptions,
        showSearch: true,
        optionFilterProp: 'label',
        placeholder: '继承接口默认密钥'
      }
    },
    {
      field: 'baseUrl',
      label: `${modelLabel.replace('模型名', '')}接口地址`,
      bottomHelpMessage: '自定义地址优先级最高；留空则使用所选接口预设，再回退旧主接口地址',
      component: 'Input',
      componentProps: {
        placeholder: 'https://example.com/v1'
      }
    },
    {
      field: 'apiKey',
      label: `${modelLabel.replace('模型名', '')}接口密钥`,
      bottomHelpMessage: '自定义密钥优先级最高；留空则使用所选密钥分组，再回退旧主接口密钥',
      component: 'InputPassword',
      componentProps: {
        placeholder: '留空使用所选密钥分组'
      }
    },
    {
      field: 'endpointType',
      label: `${modelLabel.replace('模型名', '')}接口格式`,
      bottomHelpMessage: '默认继承接口预设；需要覆盖时可指定端点格式：OpenAI Chat、OpenAI Responses、Claude Messages、Gemini Native',
      component: 'Select',
      defaultValue: 'inherit',
      componentProps: {
        options: modelEndpointTypeOptions
      }
    },
    createRefreshModelOptionsSchema(modelType, 'primary'),
    {
      field: 'requestMode',
      label: `${modelLabel.replace('模型名', '')}请求方式`,
      bottomHelpMessage: '建议优先使用流式请求，避免长输出无返回导致超时',
      component: 'Select',
      defaultValue: 'response',
      componentProps: {
        options: requestModeOptions
      }
    },
    {
      field: 'timeoutMs',
      label: timeoutLabel,
      bottomHelpMessage: timeoutHelp,
      component: 'InputNumber',
      defaultValue: timeoutDefault,
      componentProps: {
        min: 1000,
        max: 600000,
        step: 1000
      }
    },
    {
      field: 'connectTimeoutMs',
      label: `${modelLabel.replace('模型名', '')}连接超时（毫秒）`,
      bottomHelpMessage: '只控制建立连接阶段的等待时间；流式输出期间仍由请求超时控制',
      component: 'InputNumber',
      defaultValue: 30000,
      componentProps: {
        min: 1000,
        max: 600000,
        step: 1000
      }
    },
    {
      field: 'retryCount',
      label: retryLabel,
      bottomHelpMessage: retryHelp,
      component: 'InputNumber',
      defaultValue: 1,
      componentProps: {
        min: 0,
        max: 5,
        step: 1
      }
    }
  ]
}

const primaryApiSchemas = [
  {
    field: 'primaryBaseUrl',
    label: '旧主接口地址',
    bottomHelpMessage: '兼容旧配置；模型未选择接口预设且未自定义地址时会回退到这里',
    component: 'Input',
    componentProps: {
      placeholder: 'https://example.com/v1'
    }
  },
  {
    field: 'primaryApiKey',
    label: '旧主接口密钥',
    bottomHelpMessage: '兼容旧配置；模型未选择密钥分组且未自定义密钥时会回退到这里',
    component: 'InputPassword',
    componentProps: {
      placeholder: '请输入旧主接口密钥'
    }
  }
]

const apiPresetKeyGroupSchemas = [
  {
    field: 'id',
    label: '分组ID',
    bottomHelpMessage: '用于模型配置选择密钥分组，建议使用英文、数字、短横线或下划线',
    component: 'Input',
    componentProps: {
      placeholder: 'default'
    }
  },
  {
    field: 'name',
    label: '分组名称',
    component: 'Input',
    componentProps: {
      placeholder: '默认密钥'
    }
  },
  {
    field: 'apiKey',
    label: '接口密钥',
    component: 'InputPassword',
    componentProps: {
      placeholder: '请输入接口密钥'
    }
  }
]

const apiPresetSchemas = [
  {
    field: 'id',
    label: '接口ID',
    bottomHelpMessage: '用于模型配置选择接口，建议使用英文、数字、短横线或下划线',
    component: 'Input',
    componentProps: {
      placeholder: 'senerapi'
    }
  },
  {
    field: 'name',
    label: '接口名称',
    component: 'Input',
    componentProps: {
      placeholder: 'Sener API'
    }
  },
  {
    field: 'baseUrl',
    label: '接口地址',
    bottomHelpMessage: '按所选接口格式填写基础地址即可，插件会自动拼接具体端点',
    component: 'Input',
    componentProps: {
      placeholder: 'https://example.com/v1'
    }
  },
  {
    field: 'endpointType',
    label: '接口格式',
    bottomHelpMessage: '该接口预设默认使用的端点格式；模型配置选择“继承接口预设”时会使用这里',
    component: 'Select',
    defaultValue: 'openai-chat',
    componentProps: {
      options: endpointTypeOptions
    }
  },
  {
    field: 'keyGroups',
    label: '密钥分组',
    bottomHelpMessage: '同一个接口可配置多组密钥，模型配置中可按用途选择不同分组',
    component: 'GSubForm',
    defaultValue: [],
    componentProps: {
      multiple: true,
      titleField: 'name',
      summaryFields: ['id', 'name'],
      searchFields: ['id', 'name'],
      showAdd: true,
      showRemove: true,
      schemas: apiPresetKeyGroupSchemas,
      removeConfirm: {
        title: '确认删除',
        content: '确定要删除这组接口密钥吗？',
        okText: '确定',
        cancelText: '取消'
      }
    }
  }
]

function createApiPresetsSchema() {
  return {
    field: 'api.presets',
    label: '接口预设',
    bottomHelpMessage: '可配置多个接口；同一接口可配置多组密钥。模型配置选择接口和密钥分组后，会自动使用这里的地址和密钥',
    component: 'GSubForm',
    defaultValue: [],
    componentProps: {
      multiple: true,
      titleField: 'name',
      summaryFields: ['id', 'name', 'endpointType'],
      searchFields: ['id', 'name', 'baseUrl'],
      showAdd: true,
      showRemove: true,
      schemas: apiPresetSchemas,
      removeConfirm: {
        title: '确认删除',
        content: '确定要删除这条接口预设吗？已选择它的模型会回退到自定义或旧主接口配置。',
        okText: '确定',
        cancelText: '取消'
      }
    }
  }
}

function createFallbackModelItemSchemas({ modelType, apiPresetOptions, apiKeyGroupOptions }) {
  const modelOptions = buildModelOptions(modelType)

  return [
  {
    field: 'model',
    label: '模型名',
    bottomHelpMessage: '降级时要切换到的模型名；可手动输入，也可使用已刷新缓存中的候选项',
    component: 'AutoComplete',
    componentProps: {
      placeholder: '例如：grok-4.2',
      options: modelOptions,
      allowClear: true
    }
  },
  {
    field: 'apiPresetId',
    label: '接口预设',
    bottomHelpMessage: '留空继承当前类型主配置；也可选择其他接口预设作为下级模型接口',
    component: 'Select',
    defaultValue: '',
    componentProps: {
      options: apiPresetOptions,
      showSearch: true,
      optionFilterProp: 'label',
      placeholder: '继承主配置'
    }
  },
  {
    field: 'apiKeyGroupId',
    label: '密钥分组',
    bottomHelpMessage: '留空继承当前类型主配置；也可选择其他接口预设下的密钥分组',
    component: 'Select',
    defaultValue: '',
    componentProps: {
      options: apiKeyGroupOptions,
      showSearch: true,
      optionFilterProp: 'label',
      placeholder: '继承主配置'
    }
  },
  {
    field: 'baseUrl',
    label: '接口地址',
    bottomHelpMessage: '留空则继承当前类型配置的接口地址，再留空则继续回退到主接口地址',
    component: 'Input',
    componentProps: {
      placeholder: '例如：https://example.com/v1'
    }
  },
  {
    field: 'apiKey',
    label: '接口密钥',
    bottomHelpMessage: '自定义密钥优先级最高；留空则使用所选密钥分组或继承当前类型配置',
    component: 'InputPassword',
    componentProps: {
      placeholder: '留空继承当前配置'
    }
  },
  {
    field: 'endpointType',
    label: '接口格式',
    bottomHelpMessage: '默认继承当前类型主配置；下级模型接入不同服务商时可单独指定',
    component: 'Select',
    defaultValue: 'inherit',
    componentProps: {
      options: fallbackEndpointTypeOptions
    }
  },
  createRefreshModelOptionsSchema(modelType, 'fallback'),
  {
    field: 'requestMode',
    label: '请求方式',
    bottomHelpMessage: '默认继承当前类型主配置；如果下级模型所在接口不支持流式，可单独改成等待一次性输出',
    component: 'Select',
    defaultValue: 'inherit',
    componentProps: {
      options: fallbackRequestModeOptions
    }
  }
  ]
}

function createFallbackModelsSchema(modelType, label, selectionOptions) {
  return {
    field: `api.${modelType}.fallbackModels`,
    label: `${label}下级模型`,
    bottomHelpMessage: `当${label}主模型在当前重试次数内仍然失败时，会自动按顺序降级到这里配置的下级模型，保证服务可用性`,
    component: 'GSubForm',
    defaultValue: [],
    componentProps: {
      multiple: true,
      showAdd: true,
      showRemove: true,
      schemas: createFallbackModelItemSchemas({ modelType, ...selectionOptions }),
      removeConfirm: {
        title: '确认删除',
        content: '确定要删除这条下级模型配置吗？',
        okText: '确定',
        cancelText: '取消'
      }
    }
  }
}

function buildApiSchemaRaw() {
  const selectionOptions = buildApiSelectionOptions()

  return [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '接口配置'
  },
  {
    component: 'Divider',
    label: '主接口',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  createSingleConfigForm(
    '_apiPrimaryConfig',
    '主接口配置',
    '点击行内编辑按钮打开弹窗，统一配置主接口地址和主接口密钥',
    primaryApiSchemas
  ),
  createApiPresetsSchema(),
  {
    component: 'Divider',
    label: '搜索模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  createSingleConfigForm(
    '_apiSearchConfig',
    '搜索主模型配置',
    '点击行内编辑按钮打开弹窗，统一编辑搜索模型、地址、密钥、请求方式、超时和重试',
    createModelConfigSchemas({
      modelType: 'search',
      modelLabel: '搜索模型名',
      modelPlaceholder: 'perplexity-search',
      timeoutLabel: '搜索请求超时（毫秒）',
      timeoutHelp: '该类型模型所有搜索相关请求默认共用此超时',
      timeoutDefault: 100000,
      retryLabel: '搜索重试次数',
      retryHelp: '失败后额外重试几次；建议 0-2 次，避免重复扣费',
      ...selectionOptions
    })
  ),
  createFallbackModelsSchema('search', '搜索', selectionOptions),
  {
    component: 'Divider',
    label: '图片模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  createSingleConfigForm(
    '_apiImageConfig',
    '图片主模型配置',
    '点击行内编辑按钮打开弹窗，统一编辑图片模型、地址、密钥、请求方式、超时和重试',
    createModelConfigSchemas({
      modelType: 'image',
      modelLabel: '图片模型名',
      modelPlaceholder: 'gemini-flash-latest',
      timeoutLabel: '图片请求超时（毫秒）',
      timeoutHelp: '图片理解、长图切片理解等请求默认共用此超时',
      timeoutDefault: 120000,
      retryLabel: '图片重试次数',
      retryHelp: '图片理解失败后的额外重试次数',
      ...selectionOptions
    })
  ),
  createFallbackModelsSchema('image', '图片', selectionOptions),
  {
    component: 'Divider',
    label: '总结模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  createSingleConfigForm(
    '_apiSummaryConfig',
    '总结主模型配置',
    '点击行内编辑按钮打开弹窗，统一编辑总结模型、地址、密钥、请求方式、超时和重试',
    createModelConfigSchemas({
      modelType: 'summary',
      modelLabel: '总结模型名',
      modelPlaceholder: 'gemini-flash-latest',
      timeoutLabel: '总结请求超时（毫秒）',
      timeoutHelp: '群聊总结、内容总结、搜索整理等请求默认共用此超时',
      timeoutDefault: 120000,
      retryLabel: '总结重试次数',
      retryHelp: '群聊总结、内容总结、搜索结果整理等总结模型请求共用该重试次数',
      ...selectionOptions
    })
  ),
  createFallbackModelsSchema('summary', '总结', selectionOptions),
  {
    component: 'Divider',
    label: 'JSON修复模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  createSingleConfigForm(
    '_apiJsonRepairConfig',
    'JSON修复模型配置',
    '点击行内编辑按钮打开弹窗，单独编辑增强总结 JSON 修复使用的模型、地址、密钥、请求方式、超时和重试',
    createModelConfigSchemas({
      modelType: 'jsonRepair',
      modelLabel: 'JSON修复模型名',
      modelPlaceholder: 'gemini-flash-latest',
      timeoutLabel: 'JSON修复请求超时（毫秒）',
      timeoutHelp: '增强总结模块输出不是合法 JSON 时，修复请求默认使用此超时',
      timeoutDefault: 60000,
      retryLabel: 'JSON修复重试次数',
      retryHelp: '单次 JSON 修复请求失败后的额外重试次数；结构修复轮数仍由“JSON修复重试次数”控制',
      ...selectionOptions
    })
  ),
  createFallbackModelsSchema('jsonRepair', 'JSON修复', selectionOptions),
  {
    component: 'Divider',
    label: '视频模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  createSingleConfigForm(
    '_apiVideoConfig',
    '视频主模型配置',
    '点击行内编辑按钮打开弹窗，统一编辑视频模型、地址、密钥、请求方式、超时和重试',
    createModelConfigSchemas({
      modelType: 'video',
      modelLabel: '视频模型名',
      modelPlaceholder: 'qwen3-vl-plus',
      timeoutLabel: '视频请求超时（毫秒）',
      timeoutHelp: '视频分析通常更耗时，建议结合流式请求一起配置',
      timeoutDefault: 180000,
      retryLabel: '视频重试次数',
      retryHelp: '视频分析失败后的额外重试次数',
      ...selectionOptions
    })
  ),
  createFallbackModelsSchema('video', '视频', selectionOptions),
  {
    component: 'Divider',
    label: '音频模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  createSingleConfigForm(
    '_apiAudioConfig',
    '音频主模型配置',
    '点击行内编辑按钮打开弹窗，统一编辑音频模型、地址、密钥、请求方式、超时和重试',
    createModelConfigSchemas({
      modelType: 'audio',
      modelLabel: '音频模型名',
      modelPlaceholder: 'grok-4.1-fast',
      timeoutLabel: '音频请求超时（毫秒）',
      timeoutHelp: '语音转写建议结合流式请求一起配置',
      timeoutDefault: 60000,
      retryLabel: '音频重试次数',
      retryHelp: '语音转写失败后的额外重试次数',
      ...selectionOptions
    })
  ),
  createFallbackModelsSchema('audio', '音频', selectionOptions)
  ]
}

const apiRecommendationMap = {
  'api.search.fallbackModels': '按需添加 1-3 个备用搜索模型',
  'api.image.fallbackModels': '按需添加 1-3 个备用图片模型',
  'api.summary.fallbackModels': '按需添加 1-3 个备用总结模型',
  'api.jsonRepair.fallbackModels': '按需添加 1-2 个备用 JSON 修复模型',
  'api.video.fallbackModels': '按需添加 1-2 个备用视频模型',
  'api.audio.fallbackModels': '按需添加 1-2 个备用音频模型'
}

export function getApiSchema() {
  return enhanceSchemas(buildApiSchemaRaw(), {
    recommendationMap: apiRecommendationMap
  })
}
