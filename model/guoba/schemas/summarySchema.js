export const summarySchema = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '总结与媒体'
  },
  {
    field: 'fileRequest.imageMaxPerRequest',
    label: '单次图片上限',
    component: 'InputNumber',
    defaultValue: 20,
    componentProps: {
      min: 1,
      max: 50,
      step: 1
    }
  },
  {
    field: 'fileRequest.videoMaxPerRequest',
    label: '单次视频上限',
    component: 'InputNumber',
    defaultValue: 3,
    componentProps: {
      min: 1,
      max: 10,
      step: 1
    }
  },
  {
    field: 'fileRequest.audioMaxPerRequest',
    label: '单次语音上限',
    component: 'InputNumber',
    defaultValue: 5,
    componentProps: {
      min: 1,
      max: 20,
      step: 1
    }
  },
  {
    field: 'fileRequest.otherMaxPerRequest',
    label: '其他附件上限',
    bottomHelpMessage: '内容总结时最多处理多少个非图片/视频/语音附件，如 txt、md、json、pdf、docx 等',
    component: 'InputNumber',
    defaultValue: 5,
    componentProps: {
      min: 0,
      max: 20,
      step: 1
    }
  },
  {
    field: 'fileRequest.maxRequestLoops',
    label: '批次循环次数',
    bottomHelpMessage: '超出单次上限时最多继续请求多少轮',
    component: 'InputNumber',
    defaultValue: 2,
    componentProps: {
      min: 1,
      max: 10,
      step: 1
    }
  },
  {
    component: 'Divider',
    label: '群聊总结',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'chatSummary.defaultMessageCount',
    label: '整群默认消息数',
    component: 'InputNumber',
    defaultValue: 800,
    componentProps: {
      min: 50,
      max: 2000,
      step: 50
    }
  },
  {
    field: 'chatSummary.atMemberMessageCount',
    label: '@成员默认消息数',
    component: 'InputNumber',
    defaultValue: 200,
    componentProps: {
      min: 20,
      max: 1000,
      step: 20
    }
  },
  {
    field: 'chatSummary.maxMessageCount',
    label: '单次最大可取消息数',
    component: 'InputNumber',
    defaultValue: 500,
    componentProps: {
      min: 50,
      max: 3000,
      step: 50
    }
  },
  {
    field: 'chatSummary.docMaxChars',
    label: '文档截取字符数',
    component: 'InputNumber',
    defaultValue: 2000,
    componentProps: {
      min: 200,
      max: 10000,
      step: 100
    }
  },
  {
    field: 'chatSummary.historyHoursLimit',
    label: '历史时间范围（小时）',
    bottomHelpMessage: '群聊总结仅统计最近 N 小时内的消息，0 表示不限制时间范围',
    component: 'InputNumber',
    defaultValue: 24,
    componentProps: {
      min: 0,
      max: 720,
      step: 1
    }
  },
  {
    component: 'Divider',
    label: '自然语言搜索',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'searchContext.historyMessageCount',
    label: '前文注入条数',
    bottomHelpMessage: '仅对“xx是什么 / xx是谁 / xx是啥 / 谁”这类自然语言搜索生效，0 为关闭前文注入；引用消息会继续单独注入',
    component: 'InputNumber',
    defaultValue: 5,
    componentProps: {
      min: 0,
      max: 20,
      step: 1
    }
  }
]
