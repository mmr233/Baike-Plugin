import { enhanceSchemas } from './schemaHelpers.js'

const sendOptions = [
  { label: '跟随主发送方式', value: '' },
  { label: 'HTML 图片', value: 'html' },
  { label: '合并转发', value: 'forward' },
  { label: '纯文本', value: 'text' }
]

const runtimeSchemaRaw = [
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
    component: 'Divider',
    label: '总结计费',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'summaryBilling.enabled',
    label: '启用总结计费',
    bottomHelpMessage: '开启后，非缓存且成功完成的总结会通过 Iris-Sign-Plugin 好感度商城扣费',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'summaryBilling.itemId',
    label: '计费商品 ID',
    bottomHelpMessage: 'Baike 会向 Iris 商城注册同 ID 商品；如需统一改价，可在 Iris 商城配置里添加同 ID 商品覆盖默认价格',
    component: 'Input',
    defaultValue: 'baike:summary_service'
  },
  {
    field: 'summaryBilling.itemName',
    label: '计费商品名称',
    component: 'Input',
    defaultValue: '百科总结服务'
  },
  {
    field: 'summaryBilling.itemAliases',
    label: '计费商品别名',
    bottomHelpMessage: 'Baike 注册到 Iris 商城的商品别名；可用于 #总结说明 等短命令，保存到 Iris 商城配置后以 Iris 为准',
    component: 'Select',
    defaultValue: ['总结', '群聊总结', '群友总结', '内容总结', '媒体总结', '百科总结'],
    componentProps: {
      mode: 'tags',
      placeholder: '输入别名后回车'
    }
  },
  {
    field: 'summaryBilling.defaultCostFavor',
    label: '默认消耗好感度',
    bottomHelpMessage: '仅在 Iris 商城没有同 ID 商品时使用；正式价格优先读取 Iris 商城配置',
    component: 'InputNumber',
    defaultValue: 3,
    componentProps: {
      min: 0,
      max: 9999,
      step: 1
    }
  },
  {
    field: 'summaryBilling.exemptMaster',
    label: '主人免计费',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'summaryBilling.chargeCached',
    label: '缓存命中也计费',
    bottomHelpMessage: '默认关闭；关闭时命中缓存不会扣好感度',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'summaryBilling.chargeFailed',
    label: '失败也计费',
    bottomHelpMessage: '默认关闭；关闭时总结失败或模型降级为规则摘要会自动退回好感度',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'summaryBilling.allowWhenUnavailable',
    label: '商城不可用时放行',
    bottomHelpMessage: '默认关闭；关闭时 Iris 商城不可用会阻止非豁免用户使用总结',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'summaryBilling.respectIrisBaseEnable',
    label: '遵守 Iris 总开关',
    bottomHelpMessage: '开启后 Iris-Sign-Plugin 总开关关闭时会阻止计费总结',
    component: 'Switch',
    defaultValue: true
  },
  {
    component: 'Divider',
    label: '总结次数限制',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'summaryBilling.limit.enabled',
    label: '启用次数限制',
    bottomHelpMessage: '默认只统计成功完成、非缓存、非主人触发的总结',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'summaryBilling.limit.maxUses',
    label: '周期内最多次数',
    component: 'InputNumber',
    defaultValue: 20,
    componentProps: {
      min: 0,
      max: 9999,
      step: 1
    }
  },
  {
    field: 'summaryBilling.limit.periodHours',
    label: '统计周期（小时）',
    component: 'InputNumber',
    defaultValue: 24,
    componentProps: {
      min: 1,
      max: 8760,
      step: 1
    }
  },
  {
    field: 'summaryBilling.limit.scope',
    label: '限制范围',
    component: 'Select',
    defaultValue: 'groupUser',
    componentProps: {
      options: [
        { label: '每个群内用户', value: 'groupUser' },
        { label: '每个用户', value: 'user' },
        { label: '每个群', value: 'group' }
      ]
    }
  },
  {
    field: 'summaryBilling.limit.countCached',
    label: '缓存命中计入次数',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'summaryBilling.limit.countFailed',
    label: '失败计入次数',
    bottomHelpMessage: '默认关闭；关闭时模型失败、发送失败或规则摘要降级不会占用次数',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'summaryBilling.limit.countMaster',
    label: '主人计入次数',
    component: 'Switch',
    defaultValue: false
  },
  {
    component: 'Divider',
    label: '搜索计费',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'searchBilling.enabled',
    label: '启用搜索计费',
    bottomHelpMessage: '开启后，非缓存且成功完成的搜索会通过 Iris-Sign-Plugin 好感度商城扣费',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'searchBilling.itemId',
    label: '搜索商品 ID',
    bottomHelpMessage: 'Baike 会向 Iris 商城注册同 ID 商品；如需统一改价，可在 Iris 商城配置里添加同 ID 商品覆盖默认价格',
    component: 'Input',
    defaultValue: 'baike:search_service'
  },
  {
    field: 'searchBilling.itemName',
    label: '搜索商品名称',
    component: 'Input',
    defaultValue: '百科搜索服务'
  },
  {
    field: 'searchBilling.itemAliases',
    label: '搜索商品别名',
    bottomHelpMessage: 'Baike 注册到 Iris 商城的搜索商品别名；保存到 Iris 商城配置后以 Iris 为准',
    component: 'Select',
    defaultValue: ['搜索', '百科搜索', '查询', '百科查询'],
    componentProps: {
      mode: 'tags',
      placeholder: '输入别名后回车'
    }
  },
  {
    field: 'searchBilling.defaultCostFavor',
    label: '搜索默认消耗好感度',
    bottomHelpMessage: '仅在 Iris 商城没有同 ID 商品时使用；正式价格优先读取 Iris 商城配置',
    component: 'InputNumber',
    defaultValue: 2,
    componentProps: {
      min: 0,
      max: 9999,
      step: 1
    }
  },
  {
    field: 'searchBilling.exemptMaster',
    label: '搜索主人免计费',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'searchBilling.chargeCached',
    label: '搜索缓存命中也计费',
    bottomHelpMessage: '默认关闭；关闭时命中完整缓存不会扣好感度',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'searchBilling.chargeFailed',
    label: '搜索失败也计费',
    bottomHelpMessage: '默认关闭；关闭时搜索请求、整理或发送失败会自动退回好感度',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'searchBilling.allowWhenUnavailable',
    label: '搜索商城不可用时放行',
    bottomHelpMessage: '默认关闭；关闭时 Iris 商城不可用会阻止非豁免用户使用搜索',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'searchBilling.respectIrisBaseEnable',
    label: '搜索遵守 Iris 总开关',
    bottomHelpMessage: '开启后 Iris-Sign-Plugin 总开关关闭时会阻止计费搜索',
    component: 'Switch',
    defaultValue: true
  },
  {
    component: 'Divider',
    label: '搜索次数限制',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'searchBilling.limit.enabled',
    label: '启用搜索次数限制',
    bottomHelpMessage: '默认关闭；开启后只统计成功完成、非缓存、非主人触发的搜索',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'searchBilling.limit.maxUses',
    label: '搜索周期内最多次数',
    component: 'InputNumber',
    defaultValue: 50,
    componentProps: {
      min: 0,
      max: 9999,
      step: 1
    }
  },
  {
    field: 'searchBilling.limit.periodHours',
    label: '搜索统计周期（小时）',
    component: 'InputNumber',
    defaultValue: 24,
    componentProps: {
      min: 1,
      max: 8760,
      step: 1
    }
  },
  {
    field: 'searchBilling.limit.scope',
    label: '搜索限制范围',
    component: 'Select',
    defaultValue: 'groupUser',
    componentProps: {
      options: [
        { label: '每个群内用户', value: 'groupUser' },
        { label: '每个用户', value: 'user' },
        { label: '每个群', value: 'group' }
      ]
    }
  },
  {
    field: 'searchBilling.limit.countCached',
    label: '搜索缓存命中计入次数',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'searchBilling.limit.countFailed',
    label: '搜索失败计入次数',
    bottomHelpMessage: '默认关闭；关闭时搜索失败不会占用次数',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'searchBilling.limit.countMaster',
    label: '搜索主人计入次数',
    component: 'Switch',
    defaultValue: false
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

const runtimeRecommendationMap = {
  'send.search': '跟随主发送方式',
  'send.contentSummary': '跟随主发送方式',
  'send.groupChatSummary': '跟随主发送方式',
  'send.memberSummary': '跟随主发送方式'
}

export const runtimeSchema = enhanceSchemas(runtimeSchemaRaw, {
  recommendationMap: runtimeRecommendationMap
})
