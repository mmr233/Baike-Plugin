import { pluginInfo } from './schemas/pluginInfo.js'
import { getApiSchema } from './schemas/apiSchema.js'
import { runtimeSchema } from './schemas/runtimeSchema.js'
import { summarySchema } from './schemas/summarySchema.js'
import { taskSchema } from './schemas/taskSchema.js'
import { promptSchema } from './schemas/promptSchema.js'
import { getConfigData } from './getConfigData.js'
import { setConfigData } from './setConfigData.js'
import Config from '../Config.js'

async function resetDefaultPrompts(_args, { Result }) {
  try {
    const nextConfig = Config.getAll()
    const defaults = Config.getDefault()
    nextConfig.prompt = { ...(defaults.prompt || {}) }
    if (!Config.setAll(nextConfig)) {
      return Result.error('恢复默认提示词失败')
    }
    return Result.ok({}, '已恢复默认提示词，刷新配置页后可查看最新模板')
  } catch (error) {
    logger.error('[百科查询] 恢复默认提示词失败', error)
    return Result.error(`恢复默认提示词失败：${error.message}`)
  }
}

export function supportGuoba() {
  return {
    pluginInfo,
    configInfo: {
      schemas: [
        ...getApiSchema(),
        ...runtimeSchema,
        ...summarySchema,
        ...taskSchema,
        ...promptSchema
      ],
      getConfigData,
      setConfigData,
      actions: {
        resetDefaultPrompts
      }
    }
  }
}
