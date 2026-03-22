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
    field: 'api.video.model',
    label: '视频模型名',
    component: 'Input',
    componentProps: {
      placeholder: 'qwen3-vl-plus'
    }
  },
  {
    field: 'api.audio.model',
    label: '音频模型名',
    component: 'Input',
    componentProps: {
      placeholder: 'grok-4.1-fast'
    }
  }
]
