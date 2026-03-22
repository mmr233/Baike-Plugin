import { pluginInfo } from './schemas/pluginInfo.js'
import { apiSchema } from './schemas/apiSchema.js'
import { runtimeSchema } from './schemas/runtimeSchema.js'
import { summarySchema } from './schemas/summarySchema.js'
import { taskSchema } from './schemas/taskSchema.js'
import { getConfigData } from './getConfigData.js'
import { setConfigData } from './setConfigData.js'

export function supportGuoba() {
  return {
    pluginInfo,
    configInfo: {
      schemas: [
        ...apiSchema,
        ...runtimeSchema,
        ...summarySchema,
        ...taskSchema
      ],
      getConfigData,
      setConfigData
    }
  }
}
