import fs from 'node:fs'
import path from 'node:path'
import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
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

  async downloadFile(url, filename) {
    if (!url) {
      return null
    }

    this.ensureTempDir()
    const filePath = path.join(this.tempDir, filename)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60000)

    try {
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

  async convertGifToVideo(gifPath) {
    const videoPath = gifPath.replace(/\.gif$/i, '.mp4')

    try {
      await exec(`ffmpeg -i "${gifPath}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,tpad=stop_mode=add:stop_duration=3:color=black" -c:v libx264 -preset fast -movflags faststart -pix_fmt yuv420p -y "${videoPath}"`, {
        timeout: 60000
      })
      return videoPath
    } catch (error) {
      logger.warn(`[${pluginName}] GIF 转视频失败，已降级为普通图片：${error.message}`)
      return null
    }
  }

  async downloadImages(images, prefix = 'img', maxCount = 20) {
    const files = []
    const targets = (images || []).slice(0, maxCount)

    for (let index = 0; index < targets.length; index += 1) {
      const image = targets[index]
      let ext = this.isGifUrl(image.url) ? 'gif' : 'jpg'
      let localPath = await this.downloadFile(image.url, `${prefix}_${Date.now()}_${index}.${ext}`)

      if (!localPath) {
        continue
      }

      try {
        const buffer = fs.readFileSync(localPath)
        const isGif = buffer.length > 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46

        if (isGif) {
          if (!localPath.endsWith('.gif')) {
            const newPath = localPath.replace(/\.[^.]+$/, '.gif')
            fs.renameSync(localPath, newPath)
            localPath = newPath
          }

          const videoPath = await this.convertGifToVideo(localPath)
          if (videoPath) {
            files.push({ type: 'video', localPath: videoPath, url: image.url })
            this.cleanupFile(localPath)
            continue
          }
        }
      } catch (error) {
        logger.warn(`[${pluginName}] 识别图片类型失败：${error.message}`)
      }

      files.push({ type: 'image', localPath, url: image.url })
    }

    return files
  }

  async downloadVideos(videos, prefix = 'video', maxCount = 3) {
    const files = []
    const targets = (videos || []).slice(0, maxCount)

    for (let index = 0; index < targets.length; index += 1) {
      const video = targets[index]
      const localPath = await this.downloadFile(video.url, `${prefix}_${Date.now()}_${index}.mp4`)
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

  async captureScreenshot(url, index = 0, mode = 'viewport') {
    let browser = null
    this.ensureTempDir()
    const imagePath = path.join(this.tempDir, `cite_${Date.now()}_${index}.png`)

    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      })

      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36')
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 })
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
      await page.screenshot({
        path: imagePath,
        fullPage: mode === 'full'
      })

      return imagePath
    } catch (error) {
      logger.warn(`[${pluginName}] 来源截图失败：${error.message}`)
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
