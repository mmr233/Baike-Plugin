import fs from 'node:fs'
import path from 'node:path'
import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { pluginName } from '../constant.js'

const exec = promisify(execCallback)

class MediaService {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp', pluginName)
  }

  ensureTempDir() {
    fs.mkdirSync(this.tempDir, { recursive: true })
  }

  cleanupFile(filePath, delay = 0) {
    if (!filePath) {
      return
    }

    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 清理临时文件失败：${error.message}`)
      }
    }, delay)
  }

  cleanupFiles(files, delay = 0) {
    for (const file of files) {
      const filePath = typeof file === 'string' ? file : file?.localPath
      this.cleanupFile(filePath, delay)
    }
  }

  isGifUrl(url = '') {
    return String(url).toLowerCase().includes('.gif') || String(url).toLowerCase().includes('gif')
  }

  isHttpUrl(url = '') {
    return /^https?:\/\//i.test(String(url || '').trim())
  }

  isDataUrl(url = '') {
    return /^data:/i.test(String(url || '').trim())
  }

  escapeShellArg(value = '') {
    return String(value).replace(/"/g, '\\"')
  }

  normalizeLocalPath(source = '') {
    const value = String(source || '').trim()
    if (!value) {
      return ''
    }

    if (/^file:\/\//i.test(value)) {
      try {
        return fileURLToPath(value)
      } catch {
        return value.replace(/^file:\/+/, '')
      }
    }

    return value
  }

  looksLikeGif(buffer) {
    return Buffer.isBuffer(buffer)
      && buffer.length > 3
      && buffer[0] === 0x47
      && buffer[1] === 0x49
      && buffer[2] === 0x46
  }

  async convertGifToStaticImage(gifPath) {
    const targetPath = `${gifPath.replace(/\.[^.]+$/, '')}_static.png`

    try {
      await exec(`ffmpeg -i "${this.escapeShellArg(gifPath)}" -frames:v 1 -update 1 -y "${this.escapeShellArg(targetPath)}"`, {
        timeout: 60000
      })

      if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
        return targetPath
      }
    } catch (error) {
      logger.warn(`[${pluginName}] GIF 静态化失败：${error.message}`)
    }

    this.cleanupFile(targetPath)
    return null
  }

  async downloadFile(url, filename, options = {}) {
    if (!url) {
      return null
    }

    this.ensureTempDir()
    const filePath = path.join(this.tempDir, filename)
    const controller = new AbortController()
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000)
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      if (this.isDataUrl(url)) {
        const base64 = String(url).split(',')[1] || ''
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
        return filePath
      }

      if (!this.isHttpUrl(url)) {
        const localPath = this.normalizeLocalPath(url)
        if (localPath && fs.existsSync(localPath)) {
          fs.copyFileSync(localPath, filePath)
          return filePath
        }

        return null
      }

      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      fs.writeFileSync(filePath, buffer)
      return filePath
    } catch (error) {
      logger.error(`[${pluginName}] 下载文件失败：${error.message}`)
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async downloadImages(images, prefix = 'img', maxCount = 20) {
    const files = []
    const targets = (images || []).slice(0, maxCount)

    for (let index = 0; index < targets.length; index += 1) {
      const image = targets[index]
      let ext = this.isGifUrl(image.url) ? 'gif' : 'jpg'
      let localPath = await this.downloadFile(image.url, `${prefix}_${Date.now()}_${index}.${ext}`)
      let isGif = ext === 'gif'

      if (!localPath) {
        continue
      }

      try {
        const buffer = fs.readFileSync(localPath)
        isGif = this.looksLikeGif(buffer)

        if (isGif && !localPath.endsWith('.gif')) {
          const newPath = localPath.replace(/\.[^.]+$/, '.gif')
          fs.renameSync(localPath, newPath)
          localPath = newPath
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 识别图片类型失败：${error.message}`)
      }

      if (isGif) {
        const staticPath = await this.convertGifToStaticImage(localPath)
        if (!staticPath) {
          logger.warn(`[${pluginName}] GIF 无法转为静态图，已跳过：${image.url}`)
          this.cleanupFile(localPath)
          continue
        }

        this.cleanupFile(localPath)
        localPath = staticPath
      }

      files.push({ type: 'image', localPath, url: image.url, name: image.name || '' })
    }

    return files
  }

  async downloadVideos(videos, prefix = 'video', maxCount = 3, options = {}) {
    const files = []
    const targets = (videos || []).slice(0, maxCount)
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 60000)

    for (let index = 0; index < targets.length; index += 1) {
      const video = targets[index]
      const localPath = await this.downloadFile(video.url, `${prefix}_${Date.now()}_${index}.mp4`, {
        timeoutMs
      })
      if (!localPath) {
        continue
      }

      const stats = fs.statSync(localPath)
      if (stats.size > 50 * 1024 * 1024) {
        this.cleanupFile(localPath)
        logger.warn(`[${pluginName}] 视频文件过大，已跳过：${video.url}`)
        continue
      }

      files.push({ type: 'video', localPath, url: video.url })
    }

    return files
  }

  async downloadAudios(audios, prefix = 'audio', maxCount = 5) {
    const files = []
    const targets = (audios || []).slice(0, maxCount)

    for (let index = 0; index < targets.length; index += 1) {
      const audio = targets[index]
      const localPath = await this.downloadFile(audio.url, `${prefix}_${Date.now()}_${index}.mp3`)
      if (localPath) {
        files.push({ type: 'audio', localPath, url: audio.url })
      }
    }

    return files
  }

  async convertAudioToMp3(audioPath) {
    const targetPath = audioPath.replace(/\.[^.]+$/, '_converted.mp3')

    try {
      await exec(`ffmpeg -i "${audioPath}" -ac 1 -ar 16000 -acodec libmp3lame -y "${targetPath}"`, {
        timeout: 60000
      })
      return targetPath
    } catch (error) {
      logger.warn(`[${pluginName}] 音频转 MP3 失败：${error.message}`)
      return null
    }
  }

  async renderHtmlToImage(html) {
    let browser = null
    this.ensureTempDir()
    const imagePath = path.join(this.tempDir, `render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`)

    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      })

      const page = await browser.newPage()
      await page.setViewport({ width: 760, height: 1200, deviceScaleFactor: 2 })
      await page.setContent(html, { waitUntil: 'networkidle0' })
      await page.screenshot({ path: imagePath, fullPage: true, type: 'png' })
      return imagePath
    } catch (error) {
      logger.error(`[${pluginName}] HTML 转图片失败：${error.message}`)
      this.cleanupFile(imagePath)
      return null
    } finally {
      if (browser) {
        await browser.close()
      }
    }
  }

  async captureScreenshot(url, index = 0, mode = 'viewport', options = {}) {
    let browser = null
    this.ensureTempDir()
    const imagePath = path.join(this.tempDir, `cite_${Date.now()}_${index}.png`)
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 10000)
    const waitUntil = options.waitUntil || 'domcontentloaded'

    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      })

      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 })
      await page.goto(url, { waitUntil, timeout: timeoutMs })
      await page.screenshot({
        path: imagePath,
        fullPage: mode === 'full'
      })

      return imagePath
    } catch (error) {
      logger.warn(`[${pluginName}] 来源截图失败：${error.message} (${url})`)
      this.cleanupFile(imagePath)
      return null
    } finally {
      if (browser) {
        await browser.close()
      }
    }
  }
}

export default MediaService
