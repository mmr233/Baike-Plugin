import { enhanceSchemas } from './schemaHelpers.js'

const textAreaProps = {
  rows: 8,
  autosize: {
    minRows: 4,
    maxRows: 16
  }
}

const promptSchemaRaw = [
  {
    component: 'SOFT_GROUP_BEGIN',
    label: '提示词'
  },
  {
    field: '_promptActions',
    label: '提示词操作',
    component: 'GButtons',
    runtimeOnly: true,
    save: false,
    componentProps: {
      buttons: [
        {
          label: '恢复默认提示词',
          type: 'primary',
          action: 'resetDefaultPrompts',
          confirm: {
            title: '恢复默认提示词',
            content: '确认将所有提示词恢复为 Baike-Plugin 当前默认模板？'
          }
        }
      ]
    }
  },
  {
    field: 'prompt.search',
    label: '搜索结果整理提示词',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入搜索结果结构化提示词'
    }
  },
  {
    field: 'prompt.summaryDefault',
    label: '总结默认提示词',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入总结默认提示词'
    }
  },
  {
    field: 'prompt.summaryImageAppend',
    label: '图片分析补充提示词',
    bottomHelpMessage: '支持 {count} 占位符，表示本次上传的图片数量；图片模型请求时会自动追加',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入图片补充提示词'
    }
  },
  {
    field: 'prompt.video',
    label: '视频总结提示词',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入视频分析提示词'
    }
  },
  {
    field: 'prompt.groupChat',
    label: '群聊总结提示词',
    bottomHelpMessage: '支持 {statsText}、{extraContext}、{botProfile}、{messageTexts} 占位符；默认模板会解析 今日话题/话题总结/消息精选/用户画像/群聊质量锐评',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入群聊总结提示词'
    }
  },
  {
    field: 'prompt.groupMember',
    label: '@成员总结提示词',
    bottomHelpMessage: '支持 {statsText}、{extraContext}、{memberProfiles}、{botProfile}、{messageTexts} 占位符；默认模板偏个人画像与公正评判，会解析 今日话题/话题总结/消息精选/用户画像/互动质量锐评',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员总结提示词'
    }
  },
  {
    field: 'prompt.groupTopics',
    label: '增强今日话题提示词',
    bottomHelpMessage: '增强总结模块使用；支持 {maxTopics}、{statsText}、{extraContext}、{botProfile}、{messageTexts} 占位符，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强今日话题提示词'
    }
  },
  {
    field: 'prompt.groupHighlights',
    label: '增强消息精选提示词',
    bottomHelpMessage: '增强总结模块使用；支持 {maxHighlights}、{extraContext}、{messageTexts} 占位符，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强消息精选提示词'
    }
  },
  {
    field: 'prompt.groupUserPortraits',
    label: '增强用户画像提示词',
    bottomHelpMessage: '增强总结模块使用；支持 {maxPortraits}、{userStatsText}、{extraContext}、{messageTexts} 占位符，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强用户画像提示词'
    }
  },
  {
    field: 'prompt.groupQualityReview',
    label: '增强质量锐评提示词',
    bottomHelpMessage: '增强总结模块使用；支持 {statsText}、{extraContext}、{messageTexts} 占位符，要求返回 JSON 对象',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强质量锐评提示词'
    }
  },
  {
    field: 'prompt.groupMemberTopics',
    label: '成员增强话题提示词',
    bottomHelpMessage: '成员总结增强模块使用；支持 {maxTopics}、{statsText}、{extraContext}、{botProfile}、{messageTexts} 占位符，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员增强话题提示词'
    }
  },
  {
    field: 'prompt.groupMemberHighlights',
    label: '成员增强精选提示词',
    bottomHelpMessage: '成员总结增强模块使用；支持 {maxHighlights}、{extraContext}、{messageTexts} 占位符，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员增强精选提示词'
    }
  },
  {
    field: 'prompt.groupMemberUserPortraits',
    label: '成员增强画像提示词',
    bottomHelpMessage: '成员总结增强模块使用；支持 {maxPortraits}、{userStatsText}、{extraContext}、{messageTexts} 占位符，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员增强画像提示词'
    }
  },
  {
    field: 'prompt.groupMemberQualityReview',
    label: '成员增强锐评提示词',
    bottomHelpMessage: '成员总结增强模块使用；支持 {statsText}、{extraContext}、{messageTexts} 占位符，要求返回 JSON 对象',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员增强锐评提示词'
    }
  }
]

const promptRecommendationMap = {
  'prompt.search': '保持默认模板',
  'prompt.summaryDefault': '保持默认模板',
  'prompt.summaryImageAppend': '保持默认模板',
  'prompt.video': '保持默认模板',
  'prompt.groupChat': '保持默认模板',
  'prompt.groupMember': '保持默认模板',
  'prompt.groupTopics': '保持默认模板',
  'prompt.groupHighlights': '保持默认模板',
  'prompt.groupUserPortraits': '保持默认模板',
  'prompt.groupQualityReview': '保持默认模板',
  'prompt.groupMemberTopics': '保持默认模板',
  'prompt.groupMemberHighlights': '保持默认模板',
  'prompt.groupMemberUserPortraits': '保持默认模板',
  'prompt.groupMemberQualityReview': '保持默认模板'
}

export const promptSchema = enhanceSchemas(promptSchemaRaw, {
  recommendationMap: promptRecommendationMap
})
