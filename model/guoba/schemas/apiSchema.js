import { enhanceSchemas } from './schemaHelpers.js'
import Config from '../../Config.js'
import { buildModelOptionsFromCache, getModelCacheEntriesForType } from '../modelOptions.js'

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

function createDefaultApiKeyGroupOption(presetId = '') {
  const actualPresetId = normalizeText(presetId)
  return actualPresetId
    ? { ...defaultApiKeyGroupOptions[0], presetId: actualPresetId, keyGroupId: '' }
    : { ...defaultApiKeyGroupOptions[0] }
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
        value: `${preset.id}::${group.id}`,
        presetId: preset.id,
        keyGroupId: group.id
      }))
    }))
    .filter(group => group.options.length > 0)
  const keyOptionsByPreset = {}
  const defaultKeyGroupByPreset = {}
  for (const preset of presets) {
    const options = preset.keyGroups.map(group => ({
      label: formatOptionLabel(group.name, group.id),
      value: `${preset.id}::${group.id}`,
      presetId: preset.id,
      keyGroupId: group.id
    }))
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

function buildModelOptions(modelType = '') {
  const cache = getModelCacheEntriesForType(Config.get('api.modelOptionsCache', {}), modelType)
  return buildModelOptionsFromCache(cache)
}

function createModelOptionsRuntimeSchema() {
  return [
    {
      field: '__apiPresetOptions',
      label: '接口预设候选',
      component: 'InputTextArea',
      runtimeOnly: true,
      save: false,
      show: false,
      ifShow: false,
      componentProps: {
        disabled: true
      }
    },
    {
      field: '__apiKeyGroupOptions',
      label: '密钥分组候选',
      component: 'InputTextArea',
      runtimeOnly: true,
      save: false,
      show: false,
      ifShow: false,
      componentProps: {
        disabled: true
      }
    },
    {
      field: '__apiKeyGroupOptionsByPreset',
      label: '接口密钥分组候选映射',
      component: 'InputTextArea',
      runtimeOnly: true,
      save: false,
      show: false,
      ifShow: false,
      componentProps: {
        disabled: true
      }
    },
    {
      field: '__apiDefaultKeyGroupByPreset',
      label: '接口默认密钥分组映射',
      component: 'InputTextArea',
      runtimeOnly: true,
      save: false,
      show: false,
      ifShow: false,
      componentProps: {
        disabled: true
      }
    },
    {
      field: '__modelOptions',
      label: '当前来源模型候选',
      component: 'InputTextArea',
      runtimeOnly: true,
      save: false,
      show: false,
      ifShow: false,
      componentProps: {
        disabled: true
      }
    },
    {
      field: '__modelOptionsAll',
      label: '全部模型候选',
      component: 'InputTextArea',
      runtimeOnly: true,
      save: false,
      show: false,
      ifShow: false,
      componentProps: {
        disabled: true
      }
    },
    {
      field: '__modelOptionsMap',
      label: '来源模型候选映射',
      component: 'InputTextArea',
      runtimeOnly: true,
      save: false,
      show: false,
      ifShow: false,
      componentProps: {
        disabled: true
      }
    }
  ]
}

function createModelOptionsBindings(modelOptions = []) {
  return {
    options: {
      firstOf: [
        {
          mapPath: '__modelOptionsMap',
          keyTemplate: '${apiKeyGroupId}::${endpointType}'
        },
        {
          mapPath: '__modelOptionsMap',
          keyTemplate: '${apiKeyGroupId}'
        },
        {
          mapPath: '__modelOptionsMap',
          keyTemplate: 'base:${baseUrl}::${endpointType}'
        },
        {
          mapPath: '__modelOptionsMap',
          keyTemplate: 'base:${baseUrl}'
        },
        {
          path: '__modelOptionsAll'
        },
        {
          path: '__modelOptions'
        }
      ],
      fallback: modelOptions
    }
  }
}

function createApiPresetOptionsBindings(apiPresetOptions = []) {
  return {
    options: {
      path: '__apiPresetOptions',
      fallback: apiPresetOptions
    }
  }
}

function createApiKeyGroupOptionsBindings(apiKeyGroupOptions = []) {
  return {
    options: {
      firstOf: [
        {
          mapPath: '__apiKeyGroupOptionsByPreset',
          keyTemplate: '${apiPresetId}',
          fallbackPath: '__apiKeyGroupOptions'
        },
        {
          path: '__apiKeyGroupOptions'
        }
      ],
      fallback: apiKeyGroupOptions
    }
  }
}

function createApiPresetFieldValueBindings() {
  return [
    {
      target: 'apiKeyGroupId',
      type: 'map',
      source: 'formModel',
      mapPath: '__apiDefaultKeyGroupByPreset',
      keyTemplate: '${event.value}',
      fallback: ''
    }
  ]
}

function createApiKeyGroupFieldValueBindings() {
  return [
    {
      target: 'apiPresetId',
      type: 'path',
      source: 'option',
      path: 'presetId',
      fallback: ''
    }
  ]
}

function createModelAutoCompleteProps(modelOptions = [], placeholder = '') {
  return {
    placeholder,
    options: [],
    allowClear: true,
    optionFilterProp: 'value',
    filterOption: true,
    dropdownMatchSelectWidth: false,
    virtual: true,
    listHeight: 256
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
    ...createModelOptionsRuntimeSchema(),
    {
      field: 'model',
      label: modelLabel,
      bottomHelpMessage: '可手动输入模型名；候选列表会根据所选接口来源自动切换',
      component: 'AutoComplete',
      componentPropsBindings: createModelOptionsBindings(modelOptions),
      componentProps: createModelAutoCompleteProps(modelOptions, modelPlaceholder)
    },
    {
      field: 'apiPresetId',
      label: `${modelLabel.replace('模型名', '')}接口预设`,
      bottomHelpMessage: '选择接口预设后，会自动使用对应的地址、密钥分组和模型候选',
      component: 'Select',
      defaultValue: '',
      componentPropsBindings: createApiPresetOptionsBindings(apiPresetOptions),
      fieldValueBindings: createApiPresetFieldValueBindings(),
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
      bottomHelpMessage: '候选项会随接口预设切换',
      component: 'Select',
      defaultValue: '',
      componentPropsBindings: createApiKeyGroupOptionsBindings(apiKeyGroupOptions),
      fieldValueBindings: createApiKeyGroupFieldValueBindings(),
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
      bottomHelpMessage: '选择接口预设后会自动使用对应地址，也可在此填写自定义地址',
      component: 'Input',
      componentProps: {
        placeholder: 'https://example.com/v1'
      }
    },
    {
      field: 'apiKey',
      label: `${modelLabel.replace('模型名', '')}接口密钥`,
      bottomHelpMessage: '选择接口预设后会自动使用对应密钥，也可在此填写自定义密钥',
      component: 'InputPassword',
      componentProps: {
        placeholder: '留空使用所选密钥分组'
      }
    },
    {
      field: 'endpointType',
      label: `${modelLabel.replace('模型名', '')}接口格式`,
      bottomHelpMessage: '选择继承时使用接口预设的端点格式，也可在此单独指定',
      component: 'Select',
      defaultValue: 'inherit',
      componentProps: {
        options: modelEndpointTypeOptions
      }
    },
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
    field: '__presetId',
    label: '归属接口',
    component: 'Input',
    runtimeOnly: true,
    save: false,
    show: false,
    ifShow: false
  },
  {
    field: '__modelOptionsButtons',
    label: '模型列表按钮',
    component: 'InputTextArea',
    runtimeOnly: true,
    save: false,
    show: false,
    ifShow: false
  },
  {
    field: '__modelOptionsPreview',
    label: '已获取模型',
    bottomHelpMessage: '只显示当前密钥分组最近一次获取到的部分模型；候选项较多时不会全部加载，完整模型名可直接手动输入',
    component: 'InputTextArea',
    runtimeOnly: true,
    save: false,
    componentProps: {
      disabled: true,
      rows: 8,
      placeholder: '暂未获取模型列表'
    }
  },
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
  },
  {
    field: '__modelOptionsActions',
    label: '模型列表',
    bottomHelpMessage: '请先保存接口预设和密钥分组，再在对应密钥分组中获取模型列表；获取成功也代表接口和密钥基本可用。模型配置页会按接口/密钥分组自动显示对应候选项',
    component: 'GButtons',
    runtimeOnly: true,
    save: false,
    componentPropsBindings: {
      buttons: {
        path: '__modelOptionsButtons',
        fallback: []
      }
    },
    componentProps: {
      buttons: []
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
    bottomHelpMessage: '配置接口地址、端点格式和密钥分组；模型表单会按所选预设显示对应候选',
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
  ...createModelOptionsRuntimeSchema(),
  {
    field: 'model',
    label: '模型名',
    bottomHelpMessage: '降级时切换的模型；候选列表根据所选本地或【网关】来源切换',
    component: 'AutoComplete',
    componentPropsBindings: createModelOptionsBindings(modelOptions),
    componentProps: createModelAutoCompleteProps(modelOptions, '例如：grok-4.2')
  },
  {
    field: 'apiPresetId',
    label: '接口预设',
    bottomHelpMessage: '留空继承当前主模型；也可明确选择本地或【网关】接口',
    component: 'Select',
    defaultValue: '',
    componentPropsBindings: createApiPresetOptionsBindings(apiPresetOptions),
    fieldValueBindings: createApiPresetFieldValueBindings(),
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
    bottomHelpMessage: '留空继承当前主模型；【网关】分组的实际密钥不会保存到 Baike',
    component: 'Select',
    defaultValue: '',
    componentPropsBindings: createApiKeyGroupOptionsBindings(apiKeyGroupOptions),
    fieldValueBindings: createApiKeyGroupFieldValueBindings(),
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
    bottomHelpMessage: '仅用于 Baike 本地模式或网关失败后的本地回退',
    component: 'Input',
    componentProps: {
      placeholder: '例如：https://example.com/v1'
    }
  },
  {
    field: 'apiKey',
    label: '接口密钥',
    bottomHelpMessage: '留空时继承当前主配置的密钥',
    component: 'InputPassword',
    componentProps: {
      placeholder: '留空继承当前配置'
    }
  },
  {
    field: 'endpointType',
    label: '接口格式',
    bottomHelpMessage: '留空时继承当前类型主配置，也可为下级模型单独指定',
    component: 'Select',
    defaultValue: 'inherit',
    componentProps: {
      options: fallbackEndpointTypeOptions
    }
  },
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
    field: 'api.modelOptionsCache',
    label: '模型列表缓存',
    component: 'InputTextArea',
    runtimeOnly: true,
    save: false,
    show: false,
    ifShow: false,
    componentProps: {
      disabled: true
    }
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
