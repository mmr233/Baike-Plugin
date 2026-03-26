export const apiSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '接口配置'
  },
  {
    field: 'api.primaryBaseUrl',
    label: '主接口地址',
    bottomHelpMessage: '搜索/总结/视频/音频未单独配置地址时都会回退到这里',
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
    component: 'Divider',
    label: '总结 / 视频 / 音频模型',
    componentProps: {
      orientation: 'left',
      plain: true
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
    field: 'api.audio.timeoutMs',
    label: '音频请求超时（毫秒）',
    component: 'InputNumber',
    defaultValue: 60000,
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000
    }
  }
]
