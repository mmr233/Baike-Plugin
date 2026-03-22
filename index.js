import { pluginName } from '#model'
import { loadApps, logSuccess } from './lib/load/loadApps.js'

const apps = await loadApps()

logSuccess(`${pluginName} 加载完成`)

export { apps }
