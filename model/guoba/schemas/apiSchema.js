import { enhanceSchemas } from './schemaHelpers.js'

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
  { label: 'Claude Messages', value: 'anthropic-messages' }
]

const fallbackEndpointTypeOptions = [
  { label: '继承主配置', value: 'inherit' },
  ...endpointTypeOptions
]

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
  modelLabel,
  modelPlaceholder,
  timeoutLabel,
  timeoutHelp,
  timeoutDefault,
  retryLabel,
  retryHelp
}) {
  return [
    {
      field: 'model',
      label: modelLabel,
      component: 'Input',
      componentProps: {
        placeholder: modelPlaceholder
      }
    },
    {
      field: 'baseUrl',
      label: `${modelLabel.replace('模型名', '')}接口地址`,
      bottomHelpMessage: '留空则使用主接口地址',
      component: 'Input',
      componentProps: {
        placeholder: 'https://example.com/v1'
      }
    },
    {
      field: 'apiKey',
      label: `${modelLabel.replace('模型名', '')}接口密钥`,
      bottomHelpMessage: '留空则使用主接口密钥',
      component: 'InputPassword',
      componentProps: {
        placeholder: '留空使用主接口密钥'
      }
    },
    {
      field: 'endpointType',
      label: `${modelLabel.replace('模型名', '')}接口格式`,
      bottomHelpMessage: '不同服务商端口请求体不同：OpenAI Chat 使用 /chat/completions，OpenAI Responses 使用 /responses，Claude Messages 使用 /messages',
      component: 'Select',
      defaultValue: 'openai-chat',
      componentProps: {
        options: endpointTypeOptions
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
    label: '主接口地址',
    bottomHelpMessage: '搜索/图片/总结/视频/音频未单独配置地址时都会回退到这里',
    component: 'Input',
    componentProps: {
      placeholder: 'https://example.com/v1'
    }
  },
  {
    field: 'primaryApiKey',
    label: '主接口密钥',
    component: 'InputPassword',
    componentProps: {
      placeholder: '请输入主接口密钥'
    }
  }
]

const fallbackModelItemSchemas = [
  {
    field: 'model',
    label: '模型名',
    bottomHelpMessage: '降级时要切换到的模型名',
    component: 'Input',
    componentProps: {
      placeholder: '例如：grok-4.2'
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
    bottomHelpMessage: '留空则继承当前类型配置的接口密钥，再留空则继续回退到主接口密钥',
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

function createFallbackModelsSchema(modelType, label) {
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
      schemas: fallbackModelItemSchemas,
      removeConfirm: {
        title: '确认删除',
        content: '确定要删除这条下级模型配置吗？',
        okText: '确定',
        cancelText: '取消'
      }
    }
  }
}

const apiSchemaRaw = [
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
      modelLabel: '搜索模型名',
      modelPlaceholder: 'perplexity-search',
      timeoutLabel: '搜索请求超时（毫秒）',
      timeoutHelp: '该类型模型所有搜索相关请求默认共用此超时',
      timeoutDefault: 100000,
      retryLabel: '搜索重试次数',
      retryHelp: '失败后额外重试几次；建议 0-2 次，避免重复扣费'
    })
  ),
  createFallbackModelsSchema('search', '搜索'),
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
      modelLabel: '图片模型名',
      modelPlaceholder: 'gemini-flash-latest',
      timeoutLabel: '图片请求超时（毫秒）',
      timeoutHelp: '图片理解、长图切片理解等请求默认共用此超时',
      timeoutDefault: 120000,
      retryLabel: '图片重试次数',
      retryHelp: '图片理解失败后的额外重试次数'
    })
  ),
  createFallbackModelsSchema('image', '图片'),
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
      modelLabel: '总结模型名',
      modelPlaceholder: 'gemini-flash-latest',
      timeoutLabel: '总结请求超时（毫秒）',
      timeoutHelp: '群聊总结、内容总结、搜索整理等请求默认共用此超时',
      timeoutDefault: 120000,
      retryLabel: '总结重试次数',
      retryHelp: '群聊总结、内容总结、搜索结果整理等总结模型请求共用该重试次数'
    })
  ),
  createFallbackModelsSchema('summary', '总结'),
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
      modelLabel: '视频模型名',
      modelPlaceholder: 'qwen3-vl-plus',
      timeoutLabel: '视频请求超时（毫秒）',
      timeoutHelp: '视频分析通常更耗时，建议结合流式请求一起配置',
      timeoutDefault: 180000,
      retryLabel: '视频重试次数',
      retryHelp: '视频分析失败后的额外重试次数'
    })
  ),
  createFallbackModelsSchema('video', '视频'),
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
      modelLabel: '音频模型名',
      modelPlaceholder: 'grok-4.1-fast',
      timeoutLabel: '音频请求超时（毫秒）',
      timeoutHelp: '语音转写建议结合流式请求一起配置',
      timeoutDefault: 60000,
      retryLabel: '音频重试次数',
      retryHelp: '语音转写失败后的额外重试次数'
    })
  ),
  createFallbackModelsSchema('audio', '音频')
]

const apiRecommendationMap = {
  'api.search.fallbackModels': '按需添加 1-3 个备用搜索模型',
  'api.image.fallbackModels': '按需添加 1-3 个备用图片模型',
  'api.summary.fallbackModels': '按需添加 1-3 个备用总结模型',
  'api.video.fallbackModels': '按需添加 1-2 个备用视频模型',
  'api.audio.fallbackModels': '按需添加 1-2 个备用音频模型'
}

export const apiSchema = enhanceSchemas(apiSchemaRaw, {
  recommendationMap: apiRecommendationMap
})
