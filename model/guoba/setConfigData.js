import Config from '../Config.js'
import { setByPath, toPositiveNumberArray } from '../../utils/common.js'

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

    if (!Config.setAll(nextConfig)) {
      return Result.error('保存失败')
    }

    return Result.ok({}, '保存成功，定时任务 cron 变更需重载插件或重启 Yunzai')
  } catch (error) {
    logger.error('[百科查询] 锅巴保存配置失败', error)
    return Result.error(`保存失败：${error.message}`)
  }
}
