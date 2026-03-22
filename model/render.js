import fs from 'node:fs'
import path from 'node:path'
import puppeteer from '../../../lib/puppeteer/puppeteer.js'
import Version from './Version.js'
import { pluginName, pluginRoot, pluginTitle } from './constant.js'

function getScale(scale = 1.5) {
  const value = Math.min(2, Math.max(0.6, Number(scale) || 1.5))
  return `style="transform:scale(${value});transform-origin:top left;"`
}

const renderCounter = new Map()

function getSaveId(name) {
  const count = (renderCounter.get(name) || 0) + 1
  renderCounter.set(name, count)

  setTimeout(() => {
    renderCounter.set(name, 0)
  }, 10000)

  return `${name}_${count}`
}

class Render {
  buildPayload(template, params = {}, options = {}) {
    const normalized = String(template || '').replace(/\.html$/, '')
    const parts = normalized.split('/').filter(Boolean)
    const resourcePrefix = `../../../${'../'.repeat(parts.length)}plugins/${pluginName}/resources/`
    const layoutPath = path.join(pluginRoot, 'resources', 'common', 'layout')

    return {
      ...params,
      pluginName,
      pluginTitle,
      _res_path: resourcePrefix,
      _layout_path: layoutPath,
      defaultLayout: path.join(layoutPath, 'default.html'),
      elemLayout: path.join(layoutPath, 'elem.html'),
      tplFile: `./plugins/${pluginName}/resources/${normalized}.html`,
      sys: {
        scale: getScale(options.scale)
      },
      quality: 100,
      saveId: getSaveId(options.saveId || parts[parts.length - 1] || 'render'),
      copyright: `Created By TRSS-Yunzai & ${pluginTitle}<span class="version">${Version.version}</span>`
    }
  }

  async render(template, params = {}, options = {}) {
    const payload = this.buildPayload(template, params, options)
    const { e, retType = 'default' } = options

    if (e?.runtime?.render) {
      return e.runtime.render(pluginName, template, params, {
        retType,
        beforeRender: ({ data }) => ({
          ...payload,
          ...data,
          saveId: getSaveId(data.saveId || payload.saveId)
        })
      })
    }

    if (!fs.existsSync(payload.tplFile.replace('./', `${process.cwd()}/`))) {
      logger.warn(`[${pluginName}] 模板不存在：${payload.tplFile}`)
    }

    return puppeteer.screenshot(`${pluginName}/${template}`, payload)
  }
}

export default new Render()
