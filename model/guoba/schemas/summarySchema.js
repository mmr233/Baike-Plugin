import { enhanceSchemas } from './schemaHelpers.js'

const summarySchemaRaw = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '总结与媒体'
  },
  {
    field: 'fileRequest.imageMaxPerRequest',
    label: '单次图片上限',
    bottomHelpMessage: '单批图片过多会让请求体变大，部分接口网关更容易 ECONNRESET；建议 6-10',
    component: 'InputNumber',
    defaultValue: 10,
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
    label: '单次其他附件上限',
    bottomHelpMessage: '内容总结时单批最多处理多少个非图片/视频/语音附件，如 txt、md、json、js、py、docx、pdf 等；总上限 = 本值 × 批次循环次数',
    component: 'InputNumber',
    defaultValue: 5,
    componentProps: {
      min: 0,
      max: 20,
      step: 1
    }
  },
  {
    field: 'fileRequest.otherTextPreviewChars',
    label: '文本附件截取字数',
    bottomHelpMessage: '文本类附件或文档正文单文件最多截取多少字符参与内容总结；txt、docx、pdf 都会受此值限制',
    component: 'InputNumber',
    defaultValue: 1500,
    componentProps: {
      min: 100,
      max: 20000,
      step: 100
    }
  },
  {
    field: 'fileRequest.documentPageMaxPerFile',
    label: '文档最大页数',
    bottomHelpMessage: 'PDF 单文件最多读取多少页正文；超出后会截断并在结果中提示',
    component: 'InputNumber',
    defaultValue: 10,
    componentProps: {
      min: 1,
      max: 50,
      step: 1
    }
  },
  {
    field: 'fileRequest.documentImageMaxPerFile',
    label: '文档图片上限',
    bottomHelpMessage: 'DOCX 内嵌图片或 PDF 页面截图，单文件最多提交多少张给图片模型分析',
    component: 'InputNumber',
    defaultValue: 4,
    componentProps: {
      min: 0,
      max: 12,
      step: 1
    }
  },
  {
    field: 'fileRequest.maxRequestLoops',
    label: '批次循环次数',
    bottomHelpMessage: '总结与媒体处理最多执行多少批，包含首批请求；总处理上限 = 各单次上限 × 本值',
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
    label: '长图自动裁剪',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'fileRequest.longImageAutoSplit.enabled',
    label: '启用长图自动裁剪',
    bottomHelpMessage: '当输入图片高度超过阈值时，自动拆成多张再发给模型，适用于图片总结和搜索上下文图片理解',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'fileRequest.longImageAutoSplit.triggerHeight',
    label: '长图触发高度',
    bottomHelpMessage: '图片高度超过这个值时才会触发自动裁剪，单位为像素',
    component: 'InputNumber',
    defaultValue: 3200,
    componentProps: {
      min: 1200,
      max: 24000,
      step: 100
    }
  },
  {
    field: 'fileRequest.longImageAutoSplit.chunkHeight',
    label: '单片目标高度',
    bottomHelpMessage: '长图裁剪后每一片的大致高度，插件会在这个高度附近寻找更适合的切点，尽量避开文字行',
    component: 'InputNumber',
    defaultValue: 2800,
    componentProps: {
      min: 800,
      max: 12000,
      step: 100
    }
  },
  {
    field: 'fileRequest.longImageAutoSplit.overlap',
    label: '片段重叠高度',
    bottomHelpMessage: '相邻裁剪片段会保留少量重叠区域，降低切到文字时的信息丢失风险',
    component: 'InputNumber',
    defaultValue: 96,
    componentProps: {
      min: 0,
      max: 600,
      step: 8
    }
  },
  {
    field: 'fileRequest.longImageAutoSplit.maxSegments',
    label: '单张最大分片数',
    bottomHelpMessage: '用于限制单张超长图片最多拆成多少片，避免请求数量被极端长图拉爆',
    component: 'InputNumber',
    defaultValue: 8,
    componentProps: {
      min: 1,
      max: 12,
      step: 1
    }
  },
  {
    component: 'Divider',
    label: '视频自动预处理',
    componentProps: {
      orientation: 'left',
      plain: true
    }
  },
  {
    field: 'fileRequest.videoPreprocess.enabled',
    label: '启用视频自动预处理',
    bottomHelpMessage: '在视频送入 LLM 前自动探测、压缩和切分长视频，避免单次请求体积过大或长时间无响应',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'fileRequest.videoPreprocess.compressTriggerSizeMb',
    label: '视频压缩触发大小（MB）',
    bottomHelpMessage: '当单个视频或单个视频片段超过这个大小时，先压缩再请求模型；适合控制大文件直接把接口跑爆',
    component: 'InputNumber',
    defaultValue: 18,
    componentProps: {
      min: 5,
      max: 200,
      step: 1
    }
  },
  {
    field: 'fileRequest.videoPreprocess.compressTargetSizeMb',
    label: '视频压缩目标大小（MB）',
    bottomHelpMessage: '压缩时会尽量把单个视频片段压到这个体积附近，数值越小越省流量，但画质也会更激进',
    component: 'InputNumber',
    defaultValue: 12,
    componentProps: {
      min: 4,
      max: 100,
      step: 1
    }
  },
  {
    field: 'fileRequest.videoPreprocess.splitTriggerDurationSeconds',
    label: '长视频切分触发时长（秒）',
    bottomHelpMessage: '当视频时长超过这个值时，会先切成多段再分批请求模型，降低单次超时和上下文压力',
    component: 'InputNumber',
    defaultValue: 90,
    componentProps: {
      min: 15,
      max: 7200,
      step: 5
    }
  },
  {
    field: 'fileRequest.videoPreprocess.segmentDurationSeconds',
    label: '单段目标时长（秒）',
    bottomHelpMessage: '长视频切分后每段的大致时长；插件会根据总时长和最大分段数做微调，保证分段数量不会失控',
    component: 'InputNumber',
    defaultValue: 45,
    componentProps: {
      min: 10,
      max: 3600,
      step: 5
    }
  },
  {
    field: 'fileRequest.videoPreprocess.maxSegments',
    label: '单视频最大分段数',
    bottomHelpMessage: '用于限制单个超长视频最多切成多少段，避免一次任务产生过多视频请求',
    component: 'InputNumber',
    defaultValue: 6,
    componentProps: {
      min: 1,
      max: 24,
      step: 1
    }
  },
  {
    field: 'fileRequest.videoPreprocess.useImageModel',
    label: '使用识图模型理解视频',
    bottomHelpMessage: '开启后会先把视频片段抽成关键帧，再调用图片模型理解；抽帧或识图失败时会自动回退视频模型',
    component: 'Switch',
    defaultValue: false
  },
  {
    field: 'fileRequest.videoPreprocess.imageFramesPerSegment',
    label: '每段视频抽帧数',
    bottomHelpMessage: '使用识图模型理解视频时，每个视频片段抽取多少张关键帧；数值越大越细，但图片请求成本也越高',
    component: 'InputNumber',
    defaultValue: 4,
    componentProps: {
      min: 1,
      max: 8,
      step: 1
    }
  },
  {
    field: 'fileRequest.videoPreprocess.imageFrameStrategy',
    label: '视频抽帧策略',
    bottomHelpMessage: '均匀抽帧更稳定；场景变化抽帧更容易抓到画面变化，但静态视频会自动回退均匀抽帧',
    component: 'Select',
    defaultValue: 'uniform',
    componentProps: {
      options: [
        { label: '均匀抽帧', value: 'uniform' },
        { label: '场景变化抽帧', value: 'scene' }
      ]
    }
  },
  {
    field: 'fileRequest.videoPreprocess.imageSceneThreshold',
    label: '场景变化阈值',
    bottomHelpMessage: '仅场景变化抽帧使用；越低越容易抽到更多帧，建议 0.15-0.35',
    component: 'InputNumber',
    defaultValue: 0.25,
    componentProps: {
      min: 0.05,
      max: 0.8,
      step: 0.05
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
    field: 'chatSummary.inflightDedup.enabled',
    label: '等待同类总结完成',
    bottomHelpMessage: '开启后，同群同范围的群聊总结正在生成时，后续触发会等待前一个结果并复用缓存，避免重复扣费和重复请求模型',
    component: 'Switch',
    defaultValue: true
  },
  {
    field: 'chatSummary.inflightDedup.waitMs',
    label: '同类总结等待时间（毫秒）',
    bottomHelpMessage: '默认 120000 毫秒，即 2 分钟；超过后会转为独立处理',
    component: 'InputNumber',
    defaultValue: 120000,
    componentProps: {
      min: 0,
      max: 600000,
      step: 1000
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
    field: 'searchContext.enableConvenientCommand',
    label: '开启搜索便捷命令',
    bottomHelpMessage: '关闭后，只能使用“搜索关键词 / 搜索 关键词”触发搜索；“xx是什么 / xx是谁”等自然语言问法不会触发，避免误触扣费',
    component: 'Switch',
    defaultValue: false
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
  },
  {
    field: 'searchContext.replyNearbyMessageCount',
    label: '引用附近注入条数',
    bottomHelpMessage: '使用引用消息搜索时，额外注入引用消息附近的上下文消息总条数，优先按时间顺序从引用消息两侧取值，0 为关闭',
    component: 'InputNumber',
    defaultValue: 6,
    componentProps: {
      min: 0,
      max: 20,
      step: 1
    }
  },
  {
    field: 'searchContext.filterBotMessages',
    label: '过滤机器人消息',
    bottomHelpMessage: '搜索上下文注入时是否过滤机器人本人消息（包含引用附近与前文注入）',
    component: 'Switch',
    defaultValue: true
  }
]

const summaryRecommendationMap = {
  'fileRequest.videoPreprocess.enabled': true,
  'fileRequest.videoPreprocess.compressTriggerSizeMb': 18,
  'fileRequest.videoPreprocess.compressTargetSizeMb': 12,
  'fileRequest.videoPreprocess.splitTriggerDurationSeconds': 90,
  'fileRequest.videoPreprocess.segmentDurationSeconds': 45,
  'fileRequest.videoPreprocess.maxSegments': 6,
  'fileRequest.videoPreprocess.useImageModel': false,
  'fileRequest.videoPreprocess.imageFramesPerSegment': 4,
  'fileRequest.videoPreprocess.imageFrameStrategy': 'uniform',
  'fileRequest.videoPreprocess.imageSceneThreshold': 0.25
}

export const summarySchema = enhanceSchemas(summarySchemaRaw, {
  recommendationMap: summaryRecommendationMap
})
