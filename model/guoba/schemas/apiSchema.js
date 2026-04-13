import { enhanceSchemas } from './schemaHelpers.js'

const apiSchemaRaw = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '接口配置'
  },
  {
    field: 'api.primaryBaseUrl',
    label: '主接口地址',
    bottomHelpMessage: '搜索/图片/总结/视频/音频未单独配置地址时都会回退到这里',
    component: 'Input',
    componentProps: {
      placeholder: 'https://example.com/v1'
    }
  },
  {
    field: 'api.primaryApiKey',
    label: '主接口密钥',
    component: 'InputPassword',
    componentProps: {
      placeholder: '请输入主接口密钥'
    }
  },
  {
    component: 'Divider',
    label: '搜索模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'api.search.model',
    label: '搜索模型名',
    component: 'Input',
    componentProps: {
      placeholder: 'perplexity-search'
    }
  },
  {
    field: 'api.search.baseUrl',
    label: '搜索接口地址',
    bottomHelpMessage: '留空则使用主接口地址',
    component: 'Input'
  },
  {
    field: 'api.search.apiKey',
    label: '搜索接口密钥',
    bottomHelpMessage: '留空则使用主接口密钥',
    component: 'InputPassword'
  },
  {
    field: 'api.search.requestMode',
    label: '搜索请求方式',
    bottomHelpMessage: '流式请求会持续接收模型输出分片，适合 grok 这类长输出场景；若接口不支持流式，再切回等待一次性输出',
    component: 'Select',
    defaultValue: 'response',
    componentProps: {
      options: [
        { label: '流式请求', value: 'stream' },
        { label: '等待一次性输出', value: 'response' }
      ]
    }
  },
  {
    field: 'api.search.timeoutMs',
    label: '搜索请求超时（毫秒）',
    bottomHelpMessage: '该类型模型所有搜索相关请求默认共用此超时',
    component: 'InputNumber',
    defaultValue: 100000,
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000
    }
  },
  {
    field: 'api.search.retryCount',
    label: '搜索重试次数',
    bottomHelpMessage: '失败后额外重试几次；建议 0-2 次，避免重复扣费',
    component: 'InputNumber',
    defaultValue: 1,
    componentProps: {
      min: 0,
      max: 5,
      step: 1
    }
  },
  {
    component: 'Divider',
    label: '图片 / 总结 / 视频 / 音频模型',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'api.image.model',
    label: '图片模型名',
    component: 'Input',
    componentProps: {
      placeholder: 'gemini-flash-latest'
    }
  },
  {
    field: 'api.image.baseUrl',
    label: '图片接口地址',
    bottomHelpMessage: '留空则使用主接口地址',
    component: 'Input'
  },
  {
    field: 'api.image.apiKey',
    label: '图片接口密钥',
    bottomHelpMessage: '留空则使用主接口密钥',
    component: 'InputPassword'
  },
  {
    field: 'api.image.requestMode',
    label: '图片请求方式',
    bottomHelpMessage: '图片理解支持流式返回，可降低等待完整输出导致的超时风险；若识图接口不支持流式，可改回等待一次性输出',
    component: 'Select',
    defaultValue: 'response',
    componentProps: {
      options: [
        { label: '流式请求', value: 'stream' },
        { label: '等待一次性输出', value: 'response' }
      ]
    }
  },
  {
    field: 'api.image.timeoutMs',
    label: '图片请求超时（毫秒）',
    bottomHelpMessage: '图片理解、长图切片理解等请求默认共用此超时',
    component: 'InputNumber',
    defaultValue: 120000,
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000
    }
  },
  {
    field: 'api.image.retryCount',
    label: '图片重试次数',
    bottomHelpMessage: '图片理解失败后的额外重试次数',
    component: 'InputNumber',
    defaultValue: 1,
    componentProps: {
      min: 0,
      max: 5,
      step: 1
    }
  },
  {
    field: 'api.summary.model',
    label: '总结模型名',
    component: 'Input',
    componentProps: {
      placeholder: 'gemini-flash-latest'
    }
  },
  {
    field: 'api.summary.baseUrl',
    label: '总结接口地址',
    bottomHelpMessage: '留空则使用主接口地址',
    component: 'Input'
  },
  {
    field: 'api.summary.apiKey',
    label: '总结接口密钥',
    bottomHelpMessage: '留空则使用主接口密钥',
    component: 'InputPassword'
  },
  {
    field: 'api.summary.requestMode',
    label: '总结请求方式',
    bottomHelpMessage: '群聊总结、内容总结、搜索整理等长文本场景更适合流式请求，可减少长时间无输出导致的超时',
    component: 'Select',
    defaultValue: 'response',
    componentProps: {
      options: [
        { label: '流式请求', value: 'stream' },
        { label: '等待一次性输出', value: 'response' }
      ]
    }
  },
  {
    field: 'api.summary.timeoutMs',
    label: '总结请求超时（毫秒）',
    component: 'InputNumber',
    defaultValue: 120000,
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000
    }
  },
  {
    field: 'api.summary.retryCount',
    label: '总结重试次数',
    bottomHelpMessage: '群聊总结、内容总结、搜索结果整理等总结模型请求共用该重试次数',
    component: 'InputNumber',
    defaultValue: 1,
    componentProps: {
      min: 0,
      max: 5,
      step: 1
    }
  },
  {
    field: 'api.video.model',
    label: '视频模型名',
    component: 'Input',
    componentProps: {
      placeholder: 'qwen3-vl-plus'
    }
  },
  {
    field: 'api.video.baseUrl',
    label: '视频接口地址',
    bottomHelpMessage: '留空则使用主接口地址',
    component: 'Input'
  },
  {
    field: 'api.video.apiKey',
    label: '视频接口密钥',
    bottomHelpMessage: '留空则使用主接口密钥',
    component: 'InputPassword'
  },
  {
    field: 'api.video.requestMode',
    label: '视频请求方式',
    bottomHelpMessage: '视频分析通常更耗时，若你的接口支持流式返回，建议开启流式请求',
    component: 'Select',
    defaultValue: 'response',
    componentProps: {
      options: [
        { label: '流式请求', value: 'stream' },
        { label: '等待一次性输出', value: 'response' }
      ]
    }
  },
  {
    field: 'api.video.timeoutMs',
    label: '视频请求超时（毫秒）',
    component: 'InputNumber',
    defaultValue: 180000,
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000
    }
  },
  {
    field: 'api.video.retryCount',
    label: '视频重试次数',
    bottomHelpMessage: '视频分析失败后的额外重试次数',
    component: 'InputNumber',
    defaultValue: 1,
    componentProps: {
      min: 0,
      max: 5,
      step: 1
    }
  },
  {
    field: 'api.audio.model',
    label: '音频模型名',
    component: 'Input',
    componentProps: {
      placeholder: 'grok-4.1-fast'
    }
  },
  {
    field: 'api.audio.baseUrl',
    label: '音频接口地址',
    bottomHelpMessage: '留空则使用主接口地址',
    component: 'Input'
  },
  {
    field: 'api.audio.apiKey',
    label: '音频接口密钥',
    bottomHelpMessage: '留空则使用主接口密钥',
    component: 'InputPassword'
  },
  {
    field: 'api.audio.requestMode',
    label: '音频请求方式',
    bottomHelpMessage: '语音转写也可切到流式请求；若接口只支持一次性返回，请保持默认',
    component: 'Select',
    defaultValue: 'response',
    componentProps: {
      options: [
        { label: '流式请求', value: 'stream' },
        { label: '等待一次性输出', value: 'response' }
      ]
    }
  },
  {
    field: 'api.audio.timeoutMs',
    label: '音频请求超时（毫秒）',
    component: 'InputNumber',
    defaultValue: 60000,
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000
    }
  },
  {
    field: 'api.audio.retryCount',
    label: '音频重试次数',
    bottomHelpMessage: '语音转写失败后的额外重试次数',
    component: 'InputNumber',
    defaultValue: 1,
    componentProps: {
      min: 0,
      max: 5,
      step: 1
    }
  }
]

const apiRecommendationMap = {
  'api.primaryBaseUrl': 'https://your-api.example.com/v1',
  'api.primaryApiKey': '按需填写',
  'api.search.baseUrl': '留空使用主接口地址',
  'api.search.apiKey': '留空使用主接口密钥',
  'api.search.requestMode': '流式请求',
  'api.image.baseUrl': '留空使用主接口地址',
  'api.image.apiKey': '留空使用主接口密钥',
  'api.image.requestMode': '流式请求',
  'api.summary.baseUrl': '留空使用主接口地址',
  'api.summary.apiKey': '留空使用主接口密钥',
  'api.summary.requestMode': '流式请求',
  'api.video.baseUrl': '留空使用主接口地址',
  'api.video.apiKey': '留空使用主接口密钥',
  'api.video.requestMode': '流式请求',
  'api.audio.baseUrl': '留空使用主接口地址',
  'api.audio.apiKey': '留空使用主接口密钥',
  'api.audio.requestMode': '流式请求'
}

export const apiSchema = enhanceSchemas(apiSchemaRaw, {
  recommendationMap: apiRecommendationMap
})
