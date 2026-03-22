import plugin from '../../../lib/plugins/plugin.js'
import { pluginName, pluginTitle } from '#model'

let UpdateHandler = null
try {
  UpdateHandler = (await import('../../other/update.js').catch(() => null))?.update
  UpdateHandler ||= (await import('../../system/apps/update.ts').catch(() => null))?.update
} catch {
  logger.error(`[${pluginName}] 未获取到 Yunzai 通用更新模块，更新功能不可用`)
}

function createUpdater(e) {
  if (!UpdateHandler) {
    e?.reply?.('未获取到 Yunzai 通用更新模块，无法执行更新')
    return null
  }

  const updater = new UpdateHandler(e)
  updater.e = e
  return updater
}

export default class BaikeUpdate extends plugin {
  constructor() {
    super({
      name: `${pluginTitle}:更新`,
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [
        {
          reg: '^#?(百科查询|百科|baike)(强制)?更新$|^#?(强制)?(百科查询|百科|baike)更新$',
          fnc: 'update'
        },
        {
          reg: '^#?(百科查询|百科|baike)更新日志$',
          fnc: 'updateLog'
        }
      ]
    })
  }

  async update(e = this.e) {
    if (!e.isMaster) {
      return false
    }

    const updater = createUpdater(e)
    if (!updater) {
      return true
    }

    e.msg = `#${e.msg.includes('强制') ? '强制' : ''}更新${pluginName}`
    return updater.update()
  }

  async updateLog(e = this.e) {
    if (!e.isMaster) {
      return false
    }

    const updater = createUpdater(e)
    if (!updater) {
      return true
    }

    const currentPlugin = await updater.getPlugin(pluginName)
    if (currentPlugin === false) {
      await e.reply(`${pluginTitle} 插件目录不存在或不是 Git 仓库`)
      return true
    }

    return e.reply(await updater.getLog(pluginName))
  }
}
