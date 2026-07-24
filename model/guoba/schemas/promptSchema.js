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
    field: 'prompt.groupContentAnalysis',
    label: '群聊内容分析提示词',
    bottomHelpMessage: '双路结构化总结的内容请求；一次生成话题、整体总结和消息精选',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入群聊内容分析提示词'
    }
  },
  {
    field: 'prompt.groupPeopleAnalysis',
    label: '群聊人物分析提示词',
    bottomHelpMessage: '双路结构化总结的人物请求；支持 {identityContext} 可选身份信息，一次生成用户画像和群聊质量锐评',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入群聊人物分析提示词'
    }
  },
  {
    field: 'prompt.groupMemberContentAnalysis',
    label: '成员内容分析提示词',
    bottomHelpMessage: '@成员总结的内容请求；一次生成个人相关话题、表现总结和代表消息',
    component: 'InputTextArea',
    componentProps: { ...textAreaProps, placeholder: '请输入成员内容分析提示词' }
  },
  {
    field: 'prompt.groupMemberPeopleAnalysis',
    label: '成员人物分析提示词',
    bottomHelpMessage: '@成员总结的人物请求；支持 {identityContext} 可选身份信息，一次生成个人画像和个人表现锐评',
    component: 'InputTextArea',
    componentProps: { ...textAreaProps, placeholder: '请输入成员人物分析提示词' }
  },
  {
    field: 'prompt.groupTopicSummary',
    label: '话题总结局部补修提示词',
    bottomHelpMessage: '内容请求缺少 topicSummary 字段时才会调用',
    component: 'InputTextArea',
    componentProps: { ...textAreaProps, placeholder: '请输入话题总结补修提示词' }
  },
  {
    field: 'prompt.groupMemberTopicSummary',
    label: '成员总结局部补修提示词',
    bottomHelpMessage: '成员内容请求缺少 topicSummary 字段时才会调用',
    component: 'InputTextArea',
    componentProps: { ...textAreaProps, placeholder: '请输入成员总结补修提示词' }
  },
  {
    field: 'prompt.groupTopics',
    label: '话题局部补修提示词',
    bottomHelpMessage: '内容请求缺少 topics 字段时才会调用，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强今日话题提示词'
    }
  },
  {
    field: 'prompt.groupHighlights',
    label: '精选局部补修提示词',
    bottomHelpMessage: '内容请求缺少 highlights 字段时才会调用，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强消息精选提示词'
    }
  },
  {
    field: 'prompt.groupUserPortraits',
    label: '画像局部补修提示词',
    bottomHelpMessage: '人物请求缺少 userPortraits 字段时才会调用；支持 {identityContext}，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强用户画像提示词'
    }
  },
  {
    field: 'prompt.groupQualityReview',
    label: '锐评局部补修提示词',
    bottomHelpMessage: '人物请求缺少 qualityReview 字段时才会调用；支持 {identityContext}，要求返回 JSON 对象',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入增强质量锐评提示词'
    }
  },
  {
    field: 'prompt.groupMemberTopics',
    label: '成员话题局部补修提示词',
    bottomHelpMessage: '成员内容请求缺少 topics 字段时才会调用，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员增强话题提示词'
    }
  },
  {
    field: 'prompt.groupMemberHighlights',
    label: '成员精选局部补修提示词',
    bottomHelpMessage: '成员内容请求缺少 highlights 字段时才会调用，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员增强精选提示词'
    }
  },
  {
    field: 'prompt.groupMemberUserPortraits',
    label: '成员画像局部补修提示词',
    bottomHelpMessage: '成员人物请求缺少 userPortraits 字段时才会调用；支持 {identityContext}，要求返回 JSON 数组',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员增强画像提示词'
    }
  },
  {
    field: 'prompt.groupMemberQualityReview',
    label: '成员锐评局部补修提示词',
    bottomHelpMessage: '成员人物请求缺少 qualityReview 字段时才会调用；支持 {identityContext}，要求返回 JSON 对象',
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
  'prompt.groupContentAnalysis': '保持默认模板',
  'prompt.groupPeopleAnalysis': '保持默认模板',
  'prompt.groupMemberContentAnalysis': '保持默认模板',
  'prompt.groupMemberPeopleAnalysis': '保持默认模板',
  'prompt.groupTopicSummary': '保持默认模板',
  'prompt.groupMemberTopicSummary': '保持默认模板',
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
