import fs from 'node:fs'
import path from 'node:path'
import Config from '../Config.js'
import { pluginName } from '../constant.js'
import { debugLog } from '../debug.js'

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.floor(numeric)))
}

function normalizeText(text = '') {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

class DocumentService {
  constructor(mediaService, messageService) {
    this.mediaService = mediaService
    this.messageService = messageService
  }

  getProcessingConfig() {
    const fileConfig = Config.get('fileRequest', {})

    return {
      textPreviewChars: Math.max(100, Number(fileConfig.otherTextPreviewChars) || 1500),
      documentPageMaxPerFile: clampInteger(fileConfig.documentPageMaxPerFile, 1, 50, 10),
      documentImageMaxPerFile: clampInteger(fileConfig.documentImageMaxPerFile, 0, 12, 4),
      pdfRenderScale: 1.5
    }
  }

  buildTextResult(text = '', limit = 1500) {
    const normalized = normalizeText(text)
    if (!normalized) {
      return {
        text: '',
        truncated: false,
        isEmpty: true,
        fullLength: 0
      }
    }

    const actualLimit = Math.max(100, Number(limit) || 1500)
    const truncatedText = normalized.slice(0, actualLimit)

    return {
      text: truncatedText,
      truncated: normalized.length > truncatedText.length,
      isEmpty: false,
      fullLength: normalized.length
    }
  }

  createTempFilePath(prefix = 'doc', name = '', ext = '.tmp') {
    this.mediaService.ensureTempDir()
    const safeName = String(name || prefix).replace(/[^\w.-]+/g, '_').slice(-48) || prefix
    return path.join(
      this.mediaService.tempDir,
      `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}${ext}`
    )
  }

  async loadDocxModules() {
    try {
      const [mammothModule, admZipModule] = await Promise.all([
        import('mammoth'),
        import('adm-zip')
      ])

      return {
        mammoth: mammothModule.default || mammothModule,
        AdmZip: admZipModule.default || admZipModule
      }
    } catch (error) {
      throw new Error(`缺少 DOCX 解析依赖，请安装 mammoth 和 adm-zip：${error.message}`)
    }
  }

  async loadPdfModules() {
    try {
      const [pdfModule, canvasModule] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('@napi-rs/canvas')
      ])
      const createCanvas = canvasModule.createCanvas || canvasModule.default?.createCanvas

      if (typeof createCanvas !== 'function') {
        throw new Error('未找到 createCanvas')
      }

      return {
        getDocument: pdfModule.getDocument,
        createCanvas
      }
    } catch (error) {
      throw new Error(`缺少 PDF 解析依赖，请安装 pdfjs-dist 和 @napi-rs/canvas：${error.message}`)
    }
  }

  async prepareImageForAnalysis(localPath, imageMeta = {}, remainingSlots = Infinity) {
    const preparedImages = await this.mediaService.splitLongImage(localPath, {
      type: 'image',
      ...imageMeta
    })

    if (!Number.isFinite(remainingSlots) || remainingSlots >= preparedImages.length) {
      return {
        images: preparedImages,
        truncated: false,
        skippedCount: 0
      }
    }

    this.mediaService.cleanupFiles(preparedImages.slice(remainingSlots))

    return {
      images: preparedImages.slice(0, remainingSlots),
      truncated: true,
      skippedCount: preparedImages.length - remainingSlots
    }
  }

  async extractTextLikeFile(localPath, limit) {
    const content = fs.readFileSync(localPath, 'utf8')
    return {
      kind: 'text',
      textResult: this.buildTextResult(content, limit),
      images: [],
      notes: []
    }
  }

  async extractDocxContent(localPath, fileName, options = {}) {
    const { mammoth, AdmZip } = await this.loadDocxModules()
    const textLimit = Math.max(100, Number(options.textLimit) || this.getProcessingConfig().textPreviewChars)
    const imageLimit = Math.max(0, Number(options.imageLimit) || 0)
    const notes = []
    let textResult = this.buildTextResult('', textLimit)

    try {
      const result = await mammoth.extractRawText({ path: localPath })
      textResult = this.buildTextResult(result?.value || '', textLimit)
      if (Array.isArray(result?.messages) && result.messages.length > 0) {
        notes.push(`DOCX 解析提示 ${result.messages.length} 条`)
      }
    } catch (error) {
      notes.push(`DOCX 正文提取失败：${error.message}`)
    }

    const images = []
    let totalEmbeddedImages = 0
    let skippedImages = 0

    if (imageLimit > 0) {
      try {
        const zip = new AdmZip(localPath)
        const entries = zip.getEntries().filter(entry => {
          if (entry.isDirectory) {
            return false
          }

          if (!/^word\/media\//i.test(entry.entryName)) {
            return false
          }

          const ext = path.extname(entry.entryName).toLowerCase()
          return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext)
        })

        totalEmbeddedImages = entries.length

        for (let index = 0; index < entries.length && images.length < imageLimit; index += 1) {
          const entry = entries[index]
          const ext = path.extname(entry.entryName).toLowerCase() || '.png'
          const imagePath = this.createTempFilePath('docx_img', `${path.basename(fileName, path.extname(fileName))}_${index + 1}`, ext)
          fs.writeFileSync(imagePath, entry.getData())

          const prepared = await this.prepareImageForAnalysis(
            imagePath,
            {
              name: `${fileName}#图片${index + 1}`
            },
            imageLimit - images.length
          )

          images.push(...prepared.images)
          if (prepared.truncated) {
            skippedImages += prepared.skippedCount
          }
        }

        if (entries.length > 0 && images.length + skippedImages < entries.length) {
          skippedImages += entries.length - (images.length + skippedImages)
        }
      } catch (error) {
        notes.push(`DOCX 内嵌图片提取失败：${error.message}`)
      }
    }

    if (totalEmbeddedImages > 0 && skippedImages > 0) {
      notes.push(`DOCX 内嵌图片仅处理前 ${images.length} 张，跳过 ${skippedImages} 张`)
    }

    debugLog('summary.document', 'DOCX 提取完成', {
      fileName,
      textLength: textResult.fullLength,
      imageCount: images.length,
      totalEmbeddedImages,
      skippedImages
    })

    return {
      kind: 'docx',
      textResult,
      images,
      notes
    }
  }

  async extractPdfContent(localPath, fileName, options = {}) {
    const { getDocument, createCanvas } = await this.loadPdfModules()
    const config = this.getProcessingConfig()
    const textLimit = Math.max(100, Number(options.textLimit) || config.textPreviewChars)
    const pageLimit = Math.max(1, Number(options.pageLimit) || config.documentPageMaxPerFile)
    const imageLimit = Math.max(0, Number(options.imageLimit) || 0)
    const notes = []
    const textPages = []
    const images = []
    let totalPages = 0
    let processedPages = 0
    let renderedPages = 0
    let loadingTask = null
    let pdfDocument = null

    try {
      const pdfData = new Uint8Array(fs.readFileSync(localPath))
      loadingTask = getDocument({
        data: pdfData,
        useWorkerFetch: false,
        isOffscreenCanvasSupported: false,
        stopAtErrors: false
      })
      pdfDocument = await loadingTask.promise
      totalPages = Number(pdfDocument.numPages) || 0

      const actualPageLimit = Math.min(totalPages, pageLimit)
      const actualRenderLimit = Math.min(actualPageLimit, imageLimit)

      for (let pageNumber = 1; pageNumber <= actualPageLimit; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber)
        processedPages = pageNumber

        try {
          const textContent = await page.getTextContent()
          const pageText = normalizeText(
            (textContent?.items || [])
              .map(item => String(item?.str || '').trim())
              .filter(Boolean)
              .join(' ')
          )

          if (pageText) {
            textPages.push(totalPages > 1 ? `【第${pageNumber}页】\n${pageText}` : pageText)
            if (textPages.join('\n\n').length >= textLimit) {
              page.cleanup()
              break
            }
          }

          if (pageNumber <= actualRenderLimit) {
            const viewport = page.getViewport({ scale: config.pdfRenderScale })
            const canvas = createCanvas(
              Math.max(1, Math.ceil(viewport.width)),
              Math.max(1, Math.ceil(viewport.height))
            )
            const context = canvas.getContext('2d')

            await page.render({
              canvasContext: context,
              viewport
            }).promise

            const imagePath = this.createTempFilePath(
              'pdf_page',
              `${path.basename(fileName, path.extname(fileName))}_${pageNumber}`,
              '.png'
            )
            fs.writeFileSync(imagePath, canvas.toBuffer('image/png'))

            const prepared = await this.prepareImageForAnalysis(
              imagePath,
              {
                name: `${fileName}#第${pageNumber}页`
              },
              imageLimit - images.length
            )

            images.push(...prepared.images)
            renderedPages = pageNumber
          }
        } finally {
          page.cleanup()
        }
      }
    } catch (error) {
      notes.push(`PDF 解析失败：${error.message}`)
    } finally {
      if (pdfDocument) {
        await pdfDocument.destroy()
      } else if (loadingTask) {
        await loadingTask.destroy()
      }
    }

    if (totalPages > pageLimit) {
      notes.push(`PDF 正文仅提取前 ${Math.min(totalPages, pageLimit)} 页，共 ${totalPages} 页`)
    }

    if (imageLimit > 0 && totalPages > Math.min(totalPages, pageLimit, imageLimit)) {
      notes.push(`PDF 页面图像仅分析前 ${Math.min(totalPages, pageLimit, imageLimit)} 页`)
    }

    const textResult = this.buildTextResult(textPages.join('\n\n'), textLimit)

    debugLog('summary.document', 'PDF 提取完成', {
      fileName,
      totalPages,
      processedPages,
      renderedPages,
      textLength: textResult.fullLength,
      imageCount: images.length
    })

    return {
      kind: 'pdf',
      textResult,
      images,
      notes
    }
  }

  async extractAttachment(localPath, fileName, options = {}) {
    const config = this.getProcessingConfig()
    const ext = this.messageService.getFileExtension(fileName, localPath)
    const normalizedExt = String(ext || '').toLowerCase()
    const textLimit = Math.max(100, Number(options.textLimit) || config.textPreviewChars)
    const imageLimit = Math.max(0, Number(options.imageLimit) || config.documentImageMaxPerFile)
    const pageLimit = Math.max(1, Number(options.pageLimit) || config.documentPageMaxPerFile)

    if (this.messageService.isTextLikeFileName(fileName, localPath)) {
      return this.extractTextLikeFile(localPath, textLimit)
    }

    if (normalizedExt === 'docx') {
      return this.extractDocxContent(localPath, fileName, {
        textLimit,
        imageLimit
      })
    }

    if (normalizedExt === 'pdf') {
      return this.extractPdfContent(localPath, fileName, {
        textLimit,
        imageLimit,
        pageLimit
      })
    }

    if (normalizedExt === 'doc') {
      return {
        kind: 'doc',
        textResult: this.buildTextResult('', textLimit),
        images: [],
        notes: ['暂不支持直接提取旧版 Word(.doc) 正文或图片']
      }
    }

    return {
      kind: 'unsupported',
      textResult: this.buildTextResult('', textLimit),
      images: [],
      notes: ['当前仅支持直接提取文本类文件、DOCX 和 PDF 的内容']
    }
  }
}

export default DocumentService
