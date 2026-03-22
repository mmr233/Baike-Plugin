export const taskSchema = [
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
    field: 'scheduledSummary.cron',
    label: 'Cron 表达式',
    bottomHelpMessage: '格式：秒 分 时 日 月 周。修改后需要重载插件或重启 Yunzai',
    component: 'Input',
    componentProps: {
      placeholder: '0 0 22 * * *'
    }
  },
  {
    field: 'scheduledSummary.groups',
    label: '定时总结群列表',
    bottomHelpMessage: '可选群或手动输入群号',
    component: 'GSelectGroup',
    componentProps: {
      placeholder: '点击选择群聊',
      allowInput: true
    }
  },
  {
    field: 'scheduledSummary.messageCount',
    label: '定时总结消息数',
    bottomHelpMessage: '仅供定时任务使用，不影响手动“总结”',
    component: 'InputNumber',
    defaultValue: 300,
    componentProps: {
      min: 50,
      max: 2000,
      step: 50
    }
  }
]
