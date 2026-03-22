import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pluginName, Version } from '#model'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appsDir = path.join(__dirname, '..', '..', 'apps')

let loadedApps = {}

export async function loadApps() {
  const apps = {}

  if (!fs.existsSync(appsDir)) {
    logger.warn(`[${pluginName}] apps 目录不存在：${appsDir}`)
    loadedApps = apps
    return apps
  }

  const files = fs
    .readdirSync(appsDir)
    .filter(file => file.endsWith('.js'))

  const results = await Promise.allSettled(
    files.map(async (file) => {
      const module = await import(pathToFileURL(path.join(appsDir, file)).href)
      return { file, module }
    })
  )

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      logger.error(`[${pluginName}] 加载应用失败`, result.reason)
      continue
    }

    const { file, module } = result.value
    for (const exported of Object.values(module)) {
      if (typeof exported !== 'function' || !exported.prototype) {
        continue
      }

      const appName = `${path.basename(file, '.js')}:${exported.name || 'default'}`
      if (!apps[appName]) {
        apps[appName] = exported
      }
    }
  }

  loadedApps = apps
  return apps
}

export function logSuccess(message = '') {
  const count = Object.keys(loadedApps).length
  logger.mark(`[${pluginName}] v${Version.version} 已加载 ${count} 个应用${message ? `，${message}` : ''}`)
}
