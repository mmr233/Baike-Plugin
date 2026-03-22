import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pluginRoot = path.join(__dirname, '..')
const pluginName = path.basename(pluginRoot)
const pluginTitle = '百科查询'
const pluginResources = path.join(pluginRoot, 'resources')
const packagePath = path.join(pluginRoot, 'package.json')

let packageInfo = { version: '1.0.0' }
try {
  packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
} catch (error) {
  logger?.warn?.(`[${pluginTitle}] 读取 package.json 失败：${error.message}`)
}

export {
  packageInfo,
  pluginName,
  pluginResources,
  pluginRoot,
  pluginTitle
}
