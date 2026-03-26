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
    label: '总结图片补充提示词',
    bottomHelpMessage: '支持 {count} 占位符，表示本次上传的图片数量',
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
    bottomHelpMessage: '支持 {statsText}、{extraContext}、{botProfile}、{messageTexts} 占位符',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入群聊总结提示词'
    }
  },
  {
    field: 'prompt.groupMember',
    label: '@成员总结提示词',
    bottomHelpMessage: '支持 {statsText}、{extraContext}、{memberProfiles}、{botProfile}、{messageTexts} 占位符',
    component: 'InputTextArea',
    componentProps: {
      ...textAreaProps,
      placeholder: '请输入成员总结提示词'
    }
  }
]

const promptRecommendationMap = {
  'prompt.search': '保持默认模板',
  'prompt.summaryDefault': '保持默认模板',
  'prompt.summaryImageAppend': '保持默认模板',
  'prompt.video': '保持默认模板',
  'prompt.groupChat': '保持默认模板',
  'prompt.groupMember': '保持默认模板'
}

export const promptSchema = enhanceSchemas(promptSchemaRaw, {
  recommendationMap: promptRecommendationMap
})
