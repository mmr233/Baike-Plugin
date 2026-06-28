import plugin from '../../../lib/plugins/plugin.js'
import baikeService from '../model/services/baikeService.js'
import { pluginTitle } from '#model'
import { createScheduledSummaryTask } from '../model/services/taskService.js'

const SUMMARY_COMMAND_REG = '^总结(?:\\s*(?:@\\S+|\\[CQ:(?:at|image|video|record|file),[^\\]]+\\]))*\\s*$'

export default class BaikeApp extends plugin {
  constructor() {
    super({
      name: `${pluginTitle}:主功能`,
      dsc: '百科搜索、内容总结与群聊总结',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^搜索(?:\\s+.*)?$',
          fnc: 'search'
        },
        {
          reg: SUMMARY_COMMAND_REG,
          fnc: 'summarize'
        },
        {
          reg: '^.+(是什么东西|是什么|是啥|什么东西|是谁|谁)[啊呀哦噢]?$',
          fnc: 'search'
        }
      ]
    })

    const scheduledTask = createScheduledSummaryTask()
    this.task = scheduledTask ? [scheduledTask] : []
  }

  async search(e) {
    return baikeService.search(e)
  }

  async summarize(e) {
    return baikeService.summarize(e)
  }
}
