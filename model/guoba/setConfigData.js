import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { setByPath, toPositiveNumberArray } from '../../utils/common.js'
import {
  createScheduledSummaryTask,
  SCHEDULED_SUMMARY_TASK_NAME
} from '../services/taskService.js'

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

function normalizeRequestMode(value, fallback = 'response') {
  const normalized = String(value || '').trim().toLowerCase()
  return ['response', 'stream'].includes(normalized) ? normalized : fallback
}

async function refreshPluginTasks() {
  try {
    if (!globalThis.Bot?.stat && !global.Bot?.stat) {
      return false
    }

    const { default: PluginsLoader } = await import('../../../../lib/plugins/loader.js')
    if (PluginsLoader && Array.isArray(PluginsLoader.task)) {
      PluginsLoader.task = PluginsLoader.task.filter(item => {
        if (String(item?.name || '') !== SCHEDULED_SUMMARY_TASK_NAME) {
          return true
        }

        try {
          item?.job?.cancel?.()
        } catch {}

        return false
      })

      const scheduledTask = createScheduledSummaryTask()
      if (scheduledTask) {
        PluginsLoader.task.push(scheduledTask)
      }
    }

    if (typeof PluginsLoader?.createTask === 'function') {
      PluginsLoader.createTask()
      return true
    }
  } catch (error) {
    logger.debug?.('[百科查询] 定时任务刷新跳过', error)
  }

  return false
}

export async function setConfigData(data, { Result }) {
  try {
    const nextConfig = Config.getAll()

    for (const [key, value] of Object.entries(data || {})) {
      if (key === 'scheduledSummary.groups') {
        setByPath(nextConfig, key, toPositiveNumberArray(value))
        continue
      }

      setByPath(nextConfig, key, value)
    }

    nextConfig.scheduledSummary = {
      ...(nextConfig.scheduledSummary || {}),
      groups: toPositiveNumberArray(nextConfig.scheduledSummary?.groups),
      hour: clampInteger(nextConfig.scheduledSummary?.hour, 0, 23, 22),
      minute: clampInteger(nextConfig.scheduledSummary?.minute, 0, 59, 0),
      second: clampInteger(nextConfig.scheduledSummary?.second, 0, 59, 0),
      messageCount: clampInteger(nextConfig.scheduledSummary?.messageCount, 50, 2000, 300)
    }

    for (const modelType of ['search', 'image', 'summary', 'video', 'audio']) {
      nextConfig.api[modelType] = {
        ...(nextConfig.api?.[modelType] || {}),
        requestMode: normalizeRequestMode(nextConfig.api?.[modelType]?.requestMode, 'response'),
        retryCount: clampInteger(nextConfig.api?.[modelType]?.retryCount, 0, 5, 1)
      }
    }

    if (!Config.setAll(nextConfig)) {
      return Result.error('保存失败')
    }

    const taskRefreshed = await refreshPluginTasks()
    logger.mark(
      `[${pluginName}] 锅巴配置保存成功${taskRefreshed ? '，定时任务已刷新' : ''}`
    )
    return Result.ok({}, taskRefreshed ? '保存成功，定时任务已刷新' : '保存成功')
  } catch (error) {
    logger.error('[百科查询] 锅巴保存配置失败', error)
    return Result.error(`保存失败：${error.message}`)
  }
}
