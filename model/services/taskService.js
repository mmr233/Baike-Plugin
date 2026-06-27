import Config from '../Config.js'
import { pluginName } from '../constant.js'
import baikeService from './baikeService.js'

export const SCHEDULED_SUMMARY_TASK_NAME = '[Baike-Plugin]自动群总结'

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

function normalizeGroups(groups = []) {
  return [...new Set(
    (Array.isArray(groups) ? groups : [groups])
      .map(item => Number(item))
      .filter(item => Number.isInteger(item) && item > 0)
  )]
}

function padTime(value) {
  return String(value).padStart(2, '0')
}

export function getScheduledSummaryConfig(taskConfig = Config.get('scheduledSummary', {})) {
  return {
    enabled: taskConfig?.enabled !== false,
    hour: clampInteger(taskConfig?.hour, 0, 23, 22),
    minute: clampInteger(taskConfig?.minute, 0, 59, 0),
    second: clampInteger(taskConfig?.second, 0, 59, 0),
    groups: normalizeGroups(taskConfig?.groups || []),
    messageCount: clampInteger(taskConfig?.messageCount, 50, 2000, 300)
  }
}

export function getScheduledSummaryCron(taskConfig = Config.get('scheduledSummary', {})) {
  const normalized = getScheduledSummaryConfig(taskConfig)
  if (!normalized.enabled || normalized.groups.length === 0) {
    return ''
  }

  return `${normalized.second} ${normalized.minute} ${normalized.hour} * * *`
}

export function createScheduledSummaryTask(taskConfig = Config.get('scheduledSummary', {})) {
  const cron = getScheduledSummaryCron(taskConfig)
  if (!cron) {
    return null
  }

  return {
    cron,
    name: SCHEDULED_SUMMARY_TASK_NAME,
    fnc: () => runScheduledSummary()
  }
}

export function formatScheduledSummaryTime(taskConfig = Config.get('scheduledSummary', {})) {
  const normalized = getScheduledSummaryConfig(taskConfig)
  return `${padTime(normalized.hour)}:${padTime(normalized.minute)}:${padTime(normalized.second)}`
}

export async function runScheduledSummary() {
  const latestConfig = getScheduledSummaryConfig()
  const currentBot = globalThis.Bot || global.Bot

  logger.mark(`[${pluginName}] 自动群总结任务触发`)

  if (latestConfig.groups.length === 0) {
    logger.warn(`[${pluginName}] 自动群总结跳过：未配置目标群`)
    return
  }

  if (!currentBot?.pickGroup) {
    logger.warn(`[${pluginName}] 自动群总结跳过：Bot 未就绪`)
    return
  }

  for (const groupId of latestConfig.groups) {
    try {
      const group = currentBot.pickGroup?.(groupId) || null
      const mockEvent = {
        group_id: groupId,
        user_id: currentBot.uin || 0,
        sender: { nickname: '定时任务助手' },
        bot: currentBot,
        group,
        message: [],
        msg: '总结',
        reply: async (message) => {
          if (group) {
            return group.sendMsg(message)
          }

          if (currentBot.sendApi) {
            if (message?.type === 'forward' || message?.data?.type === 'forward') {
              return currentBot.sendApi('send_group_forward_msg', {
                group_id: groupId,
                messages: message?.data?.content || message?.content || message
              })
            }

            return currentBot.sendApi('send_group_msg', {
              group_id: groupId,
              message: typeof message === 'string' ? [{ type: 'text', data: { text: message } }] : [message]
            })
          }

          return null
        }
      }

      await baikeService.summarizeGroupChat(mockEvent, [], {
        messageCountOverride: latestConfig.messageCount,
        skipBilling: true
      })
    } catch (error) {
      logger.error(`[${pluginName}] 自动群总结执行失败`, error)
    }
  }
}
