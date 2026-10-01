import { assertEquals } from '@std/assert'
import { signedUrlOptions } from './fileType.ts'

const UUID = '0b6f1c9e-3a52-4a57-8f0d-3c2b7f6d9a10'

Deno.test('signedUrlOptions leaves a PDF or raster image to show inline', () => {
  for (const name of ['a.pdf', 'a.JPG', 'a.jpeg', 'a.png', 'a.gif', 'a.webp']) {
    assertEquals(signedUrlOptions(`hh/d/${UUID}-${name}`), undefined)
  }
})

Deno.test('signedUrlOptions forces a download, named without the uuid prefix, for any other type', () => {
  assertEquals(signedUrlOptions(`hh/d/${UUID}-page.html`), { download: 'page.html' })
  assertEquals(signedUrlOptions(`hh/d/${UUID}-logo.svg`), { download: 'logo.svg' })
  assertEquals(signedUrlOptions(`hh/d/${UUID}-photo.heic`), { download: 'photo.heic' })
})

Deno.test('signedUrlOptions treats a name with no extension as a download', () => {
  assertEquals(signedUrlOptions('hh/d.pdf/notes'), { download: 'notes' })
})
