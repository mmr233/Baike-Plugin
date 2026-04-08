import plugin from '../../../lib/plugins/plugin.js'
import { Config, Render, pluginName, pluginTitle } from '#model'
import { style } from '../resources/help/imgs/config.js'

function padIcon(icon) {
  return String(icon).padStart(2, '0')
}

function formatTimePart(value) {
  return String(value).padStart(2, '0')
}

function formatDailyTime(config = {}) {
  return `${formatTimePart(config.hour ?? 22)}:${formatTimePart(config.minute ?? 0)}:${formatTimePart(config.second ?? 0)}`
}

function processHelpList(helpList) {
  return helpList.map(group => ({
    ...group,
    list: (group.list || []).map(item => ({
      ...item,
      iconLabel: padIcon(item.icon || 0)
    }))
  }))
}

function buildTextHelp(helpList, title) {
  const lines = [title]

  for (const group of helpList) {
    lines.push(`\n【${group.group}】`)
    if (group.desc) {
      lines.push(group.desc)
    }
    for (const item of group.list || []) {
      lines.push(`${item.title} - ${item.desc}`)
      if (item.command) {
        lines.push(`命令：${item.command}`)
      }
    }
  }

  return lines.join('\n')
}

export default class BaikeHelp extends plugin {
  constructor() {
    super({
      name: `${pluginTitle}:帮助`,
      event: 'message',
      priority: Number.MIN_SAFE_INTEGER,
      rule: [
        {
          reg: '^#?(百科查询|百科|baike)(功能|菜单|帮助|说明|指令|help)$',
          fnc: 'allHelp'
        }
      ]
    })
  }

  getThemeData(colCount = 3) {
    const width = Math.min(1440, Math.max(960, colCount * 300 + 120))
    const cssVars = [
      ':root {',
      `  --page-width: ${width}px;`,
      `  --help-col-count: ${colCount};`,
      `  --color-accent: ${style.accent};`,
      `  --color-accent-strong: ${style.accentStrong};`,
      `  --color-text: ${style.text};`,
      `  --color-text-muted: ${style.textMuted};`,
      `  --panel-bg: ${style.panelBg};`,
      `  --panel-border: ${style.panelBorder};`,
      `  --hero-bg: ${style.heroBg};`,
      `  --card-bg: ${style.cardBg};`,
      `  --card-border: ${style.cardBorder};`,
      `  --command-bg: ${style.commandBg};`,
      `  --shadow-main: ${style.shadow};`,
      '}'
    ]

    return {
      style: `<style>${cssVars.join('\n')}</style>`
    }
  }

  createHelpList(e) {
    const config = Config.getAll()
    const longImageConfig = config.fileRequest.longImageAutoSplit || {}

    const helpList = [
      {
        group: '搜索',
        desc: '支持显式搜索命令和自然语言问法，适合查概念、人物、作品和事件。',
        list: [
          { icon: 1, title: '关键词搜索', desc: '直接查资料并整理结构化结果', command: '搜索 胡桃' },
          { icon: 2, title: '自然语言提问', desc: '匹配“是什么 / 是谁 / 是啥 / 谁”句式', command: '胡桃是谁' },
          { icon: 3, title: '来源截图', desc: `当前搜索结果来源截图数量：${config.send.searchScreenshotCount}` }
        ]
      },
      {
        group: '内容总结',
        desc: '可总结引用消息、合并转发、图片、视频、语音和群文件中的媒体内容。',
        list: [
          { icon: 11, title: '引用消息总结', desc: '引用任意消息后提取文本和媒体统一分析', command: '总结 + 引用消息' },
          { icon: 12, title: '图片 / 视频总结', desc: '直接发送媒体后使用总结命令', command: '总结 + 图片/视频/语音' },
          { icon: 13, title: '语音转写总结', desc: `语音单次最多处理 ${config.fileRequest.audioMaxPerRequest} 条` },
          {
            icon: 14,
            title: '长图自动裁剪',
            desc: longImageConfig.enabled
              ? `已开启，超过 ${longImageConfig.triggerHeight || 3200}px 自动拆分`
              : '当前未启用'
          }
        ]
      },
      {
        group: '群聊总结',
        desc: '在群里直接发送“总结”可分析最近聊天，带 @ 时只总结目标成员。',
        list: [
          { icon: 21, title: '整群总结', desc: `默认抓取 ${config.chatSummary.defaultMessageCount} 条群消息`, command: '总结' },
          { icon: 22, title: '@成员总结', desc: `@成员模式默认抓取 ${config.chatSummary.atMemberMessageCount} 条消息`, command: '总结 @某人' },
          { icon: 23, title: '定时群总结', desc: config.scheduledSummary.enabled ? `已启用，每天 ${formatDailyTime(config.scheduledSummary)}` : '当前未启用' }
        ]
      },
      {
        group: '配置',
        desc: '模型、缓存、发送模式和自动群总结都可以通过锅巴面板调整。',
        list: [
          { icon: 31, title: '搜索模型', desc: config.api.search.model || '未配置' },
          { icon: 32, title: '图片模型', desc: config.api.image?.model || config.api.summary.model || '未配置' },
          { icon: 33, title: '总结模型', desc: config.api.summary.model || '未配置' },
          { icon: 34, title: '发送优先级', desc: `${config.send.primaryMode} -> 自动降级 ${config.send.autoFallback ? '已开启' : '已关闭'}` }
        ]
      }
    ]

    if (e.isMaster) {
      helpList.push({
        group: '主人视角',
        desc: '下面是当前关键配置快照，方便快速确认锅巴是否生效。',
        list: [
          { icon: 41, title: '缓存', desc: `${config.cache.enabled ? '开启' : '关闭'} / TTL ${config.cache.ttl} 分钟 / 容量 ${config.cache.maxSize}` },
          { icon: 42, title: '图片批次上限', desc: `${config.fileRequest.imageMaxPerRequest} 张 / 批，共最多 ${config.fileRequest.maxRequestLoops} 批` },
          {
            icon: 43,
            title: '长图裁剪参数',
            desc: longImageConfig.enabled
              ? `阈值 ${longImageConfig.triggerHeight || 3200}px / 单片 ${longImageConfig.chunkHeight || 2800}px / 重叠 ${longImageConfig.overlap || 96}px`
              : '已关闭'
          },
          { icon: 44, title: '定时群列表', desc: (config.scheduledSummary.groups || []).join('、') || '未设置' },
          { icon: 45, title: '更新插件', desc: '使用 Yunzai 通用更新器更新当前插件', command: '#百科更新 / #百科强制更新' }
        ]
      })
    }

    return helpList
  }

  async allHelp(e) {
    const helpCfg = {
      title: `${pluginTitle}帮助`,
      subTitle: 'BAIKE QUERY',
      description: '百科搜索、引用总结、群聊总结和定时群总结已经拆成标准插件结构，可通过锅巴面板管理主要配置。',
      colCount: 3
    }

    const helpList = this.createHelpList(e)
    const helpGroup = processHelpList(helpList)
    const themeData = this.getThemeData(helpCfg.colCount)

    try {
      const image = await Render.render('help/index', {
        helpCfg,
        helpGroup,
        ...themeData
      }, {
        e,
        scale: 1.5
      })

      return e.reply(image)
    } catch (error) {
      logger.error(`[${pluginName}] 帮助渲染失败`, error)
      return e.reply(buildTextHelp(helpList, `${pluginTitle}帮助`))
    }
  }
}
