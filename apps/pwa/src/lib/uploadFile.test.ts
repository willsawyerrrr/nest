import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canExtract,
  downloadName,
  FILE_TOO_LARGE_MESSAGE,
  MAX_UPLOAD_BYTES,
  prepareUpload,
  signedUrlOptions,
  storageKeyName,
  storedContentType,
} from './uploadFile'

const UUID = '0b6f1c9e-3a52-4a57-8f0d-3c2b7f6d9a10'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('file types', () => {
  it('reads and stores a PDF or raster image as its own type', () => {
    expect(storedContentType('slip.PDF')).toBe('application/pdf')
    expect(storedContentType('a.jpg')).toBe('image/jpeg')
    expect(storedContentType('a.png')).toBe('image/png')
    expect(storedContentType('a.gif')).toBe('image/gif')
    expect(canExtract('a.webp')).toBe(true)
  })

  it('stores anything else as opaque and does not read it', () => {
    expect(storedContentType('page.html')).toBe('application/octet-stream')
    expect(storedContentType('noextension')).toBe('application/octet-stream')
    expect(canExtract('photo.heic')).toBe(false)
    expect(canExtract('sheet.xlsx')).toBe(false)
    expect(canExtract('noextension')).toBe(false)
  })

  it('shows a readable file inline and forces a download of every other', () => {
    expect(signedUrlOptions(`h/d/${UUID}-a.pdf`)).toBeUndefined()
    expect(signedUrlOptions(`h/d/${UUID}-logo.svg`)).toEqual({ download: 'logo.svg' })
    expect(signedUrlOptions('h/d.pdf/notes')).toEqual({ download: 'notes' })
  })

  it('names a download without its generated prefix', () => {
    expect(downloadName(`h/d/${UUID}-my-receipt.docx`)).toBe('my-receipt.docx')
    expect(downloadName('h/d/plain.docx')).toBe('plain.docx')
  })
})

describe('storageKeyName', () => {
  it('keeps a plain name', () => {
    expect(storageKeyName('receipt-1.pdf')).toBe('receipt-1.pdf')
  })

  it('replaces characters Storage keys reject', () => {
    expect(storageKeyName('Tax invoice (final) [1].PDF')).toBe('Tax_invoice_final_1_.PDF')
    expect(storageKeyName('café résumé.pdf')).toBe('cafe_resume.pdf')
    expect(storageKeyName('日本語.pdf')).toBe('file.pdf')
  })

  it('drops leading dots and falls back to a name when nothing is left', () => {
    expect(storageKeyName('..hidden.txt')).toBe('hidden.txt')
    expect(storageKeyName('日本語')).toBe('file')
    expect(storageKeyName('')).toBe('file')
  })

  it('truncates a long name, keeping its extension', () => {
    const long = `${'a'.repeat(300)}.pdf`
    const key = storageKeyName(long)
    expect(key).toHaveLength(100)
    expect(key.endsWith('.pdf')).toBe(true)
  })

  it('truncates a long name with no extension', () => {
    expect(storageKeyName('b'.repeat(300))).toHaveLength(100)
  })
})

describe('prepareUpload', () => {
  it('rejects a file over the limit', async () => {
    const file = new File(['x'], 'big.pdf')
    Object.defineProperty(file, 'size', { value: MAX_UPLOAD_BYTES + 1 })

    expect(await prepareUpload(file)).toEqual({
      status: 'too-large',
      message: FILE_TOO_LARGE_MESSAGE,
    })
  })

  it('passes a readable file through', async () => {
    const file = new File(['x'], 'slip.pdf')
    expect(await prepareUpload(file)).toEqual({ status: 'ready', file, readable: true })
  })

  it('passes a file the model cannot read through as unreadable', async () => {
    const file = new File(['x'], 'notes.docx')
    expect(await prepareUpload(file)).toEqual({ status: 'ready', file, readable: false })
  })

  describe('HEIC', () => {
    const heic = new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' })

    function stubCanvas(blob: Blob | null) {
      const drawImage = vi.fn()
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage,
      } as unknown as CanvasRenderingContext2D)
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
        callback(blob),
      )
      return drawImage
    }

    it('converts to a JPEG where the browser can decode it', async () => {
      const close = vi.fn()
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4, height: 3, close }))
      const drawImage = stubCanvas(new Blob(['jpeg'], { type: 'image/jpeg' }))

      const prepared = await prepareUpload(heic)

      expect(prepared.status).toBe('ready')
      if (prepared.status !== 'ready') return
      expect(prepared.file.name).toBe('IMG_1.jpg')
      expect(prepared.file.type).toBe('image/jpeg')
      expect(prepared.readable).toBe(true)
      expect(drawImage).toHaveBeenCalled()
      expect(close).toHaveBeenCalled()
    })

    it('keeps the original when the browser cannot decode HEIC', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')))

      expect(await prepareUpload(heic)).toEqual({ status: 'ready', file: heic, readable: false })
    })

    it('keeps the original when the canvas cannot encode a JPEG', async () => {
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() }),
      )
      stubCanvas(null)

      expect(await prepareUpload(heic)).toEqual({ status: 'ready', file: heic, readable: false })
    })
  })
})
