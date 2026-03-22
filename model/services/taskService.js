import schedule from 'node-schedule'
import Config from '../Config.js'
import { pluginName } from '../constant.js'
import baikeService from './baikeService.js'

let job = null
let currentCron = ''

export function registerScheduledSummary() {
  const taskConfig = Config.get('scheduledSummary', {})
  const cron = taskConfig.cron || ''

  if (job && currentCron === cron) {
    return
  }

  if (job) {
    job.cancel()
    job = null
  }

  const groups = Array.isArray(taskConfig.groups) ? taskConfig.groups : []
  if (!taskConfig.enabled || groups.length === 0 || !cron) {
    logger.mark(`[${pluginName}] 自动群总结未启用`)
    return
  }

  currentCron = cron
  job = schedule.scheduleJob(cron, async () => {
    const latestConfig = Config.get('scheduledSummary', {})
    const latestGroups = Array.isArray(latestConfig.groups) ? latestConfig.groups : []

    logger.mark(`[${pluginName}] 自动群总结任务触发`)

    for (const groupId of latestGroups) {
      try {
        const numericGroupId = Number(groupId)
        if (!Number.isInteger(numericGroupId) || numericGroupId <= 0) {
          continue
        }

        const group = Bot.pickGroup?.(numericGroupId) || null
        const mockEvent = {
          group_id: numericGroupId,
          user_id: Bot.uin || 0,
          sender: { nickname: '定时任务助手' },
          bot: Bot,
          group,
          message: [],
          msg: '总结',
          reply: async (message) => {
            if (group) {
              return group.sendMsg(message)
            }

            if (Bot.sendApi) {
              if (message?.type === 'forward' || message?.data?.type === 'forward') {
                return Bot.sendApi('send_group_forward_msg', {
                  group_id: numericGroupId,
                  messages: message?.data?.content || message?.content || message
                })
              }

              return Bot.sendApi('send_group_msg', {
                group_id: numericGroupId,
                message: typeof message === 'string' ? [{ type: 'text', data: { text: message } }] : [message]
              })
            }

            return null
          }
        }

        await baikeService.summarizeGroupChat(mockEvent, [], {
          messageCountOverride: latestConfig.messageCount
        })
      } catch (error) {
        logger.error(`[${pluginName}] 自动群总结执行失败`, error)
      }
    }
  })

  logger.mark(`[${pluginName}] 已注册自动群总结任务，cron: ${cron}`)
}
