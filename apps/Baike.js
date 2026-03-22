import plugin from '../../../lib/plugins/plugin.js'
import baikeService from '../model/services/baikeService.js'
import { pluginTitle } from '#model'
import { registerScheduledSummary } from '../model/services/taskService.js'

registerScheduledSummary()

export default class BaikeApp extends plugin {
  constructor() {
    super({
      name: `${pluginTitle}:主功能`,
      dsc: '百科搜索、内容总结与群聊总结',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^搜索',
          fnc: 'search'
        },
        {
          reg: '^总结',
          fnc: 'summarize'
        },
        {
          reg: '^.+(是什么东西|是什么|是啥|什么东西|是谁|谁)[啊呀哦噢]?$',
          fnc: 'search'
        }
      ]
    })
  }

  async search(e) {
    return baikeService.search(e)
  }

  async summarize(e) {
    return baikeService.summarize(e)
  }
}
