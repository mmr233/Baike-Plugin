const sendOptions = [
  { label: '跟随主发送方式', value: '' },
  { label: 'HTML 图片', value: 'html' },
  { label: '合并转发', value: 'forward' },
  { label: '纯文本', value: 'text' }
]

export const runtimeSchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '缓存与发送'
  },
  {
    field: 'cache.enabled',
    label: '启用缓存',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'cache.ttl',
    label: '缓存时长（分钟）',
    component: 'InputNumber',
    defaultValue: 10,
    componentProps: {
      min: 0,
      max: 1440,
      step: 1
    }
  },
  {
    field: 'cache.maxSize',
    label: '缓存容量',
    component: 'InputNumber',
    defaultValue: 100,
    componentProps: {
      min: 10,
      max: 1000,
      step: 10
    }
  },
  {
    field: 'debug.enabled',
    label: '调试日志',
    bottomHelpMessage: '开启后会输出接口请求、上下文注入和文件解析等调试日志',
    component: 'Switch',
    defaultValue: false
  },
  {
    component: 'Divider',
    label: '发送方式',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'send.primaryMode',
    label: '主发送方式',
    component: 'Select',
    defaultValue: 'html',
    componentProps: {
      options: sendOptions.filter(item => item.value)
    }
  },
  {
    field: 'send.autoFallback',
    label: '自动降级发送',
    bottomHelpMessage: '按 HTML -> 合并转发 -> 纯文本 的顺序回退',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'send.search',
    label: '搜索结果发送方式',
    component: 'Select',
    componentProps: {
      options: sendOptions
    }
  },
  {
    field: 'send.contentSummary',
    label: '内容总结发送方式',
    component: 'Select',
    componentProps: {
      options: sendOptions
    }
  },
  {
    field: 'send.groupChatSummary',
    label: '群聊总结发送方式',
    component: 'Select',
    componentProps: {
      options: sendOptions
    }
  },
  {
    field: 'send.memberSummary',
    label: '@成员总结发送方式',
    component: 'Select',
    componentProps: {
      options: sendOptions
    }
  },
  {
    field: 'send.searchScreenshotCount',
    label: '搜索来源截图数量',
    bottomHelpMessage: '-1 表示全部截图，0 表示关闭截图',
    component: 'InputNumber',
    defaultValue: -1,
    componentProps: {
      min: -1,
      max: 20,
      step: 1
    }
  },
  {
    field: 'send.searchScreenshotMode',
    label: '来源截图模式',
    component: 'Select',
    defaultValue: 'viewport',
    componentProps: {
      options: [
        { label: '视口截图', value: 'viewport' },
        { label: '整页截图', value: 'full' }
      ]
    }
  },
  {
    field: 'send.searchScreenshotTimeoutMs',
    label: '来源截图超时（毫秒）',
    bottomHelpMessage: '超时后会跳过该来源截图，避免拖慢整体搜索返回',
    component: 'InputNumber',
    defaultValue: 10000,
    componentProps: {
      min: 1000,
      max: 60000,
      step: 1000
    }
  }
]
