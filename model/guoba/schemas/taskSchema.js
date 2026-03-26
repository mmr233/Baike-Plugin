import { enhanceSchemas } from './schemaHelpers.js'

const taskSchemaRaw = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '定时群总结'
  },
  {
    field: 'scheduledSummary.enabled',
    label: '启用定时群总结',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'scheduledSummary.hour',
    label: '执行小时',
    bottomHelpMessage: '每天几点执行自动群总结（0-23）',
    component: 'InputNumber',
    defaultValue: 22,
    componentProps: {
      min: 0,
      max: 23,
      step: 1
    }
  },
  {
    field: 'scheduledSummary.minute',
    label: '执行分钟',
    bottomHelpMessage: '每小时第几分钟执行（0-59）',
    component: 'InputNumber',
    defaultValue: 0,
    componentProps: {
      min: 0,
      max: 59,
      step: 1
    }
  },
  {
    field: 'scheduledSummary.second',
    label: '执行秒数',
    bottomHelpMessage: '每分钟第几秒执行，建议避开 0 秒高峰（0-59）',
    component: 'InputNumber',
    defaultValue: 0,
    componentProps: {
      min: 0,
      max: 59,
      step: 1
    }
  },
  {
    field: 'scheduledSummary.groups',
    label: '定时总结群列表',
    bottomHelpMessage: '可选群或手动输入群号，启用后会每天在上方时间自动总结这些群',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择群聊',
      allowInput: true
    }
  },
  {
    field: 'scheduledSummary.messageCount',
    label: '定时总结消息数',
    bottomHelpMessage: '仅供定时任务使用，不影响手动“总结”；历史时间范围仍沿用群聊总结配置',
    component: 'InputNumber',
    defaultValue: 300,
    componentProps: {
      min: 50,
      max: 2000,
      step: 50
    }
  }
]

const taskRecommendationMap = {
  'scheduledSummary.groups': '按需选择群聊'
}

export const taskSchema = enhanceSchemas(taskSchemaRaw, {
  recommendationMap: taskRecommendationMap
})
