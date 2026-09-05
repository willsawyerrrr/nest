import { assertEquals } from '@std/assert'
import {
  type DocumentIntakeDeps,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  resolveMediaType,
  runDocumentIntake,
  sanitiseFilename,
  type UploadedFile,
} from './intake.ts'

const grant = { householdId: 'h-1', memberId: 'm-1' }

function file(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: 'application/pdf',
    filename: 'slip.pdf',
    ...overrides,
  }
}

/** Default happy-path deps, overridable per test. */
function deps(overrides: Partial<DocumentIntakeDeps> = {}): DocumentIntakeDeps {
  return {
    resolveToken: () => Promise.resolve({ grant }),
    uploadObject: () => Promise.resolve(true),
    insertIntake: () => Promise.resolve(true),
    ...overrides,
  }
}

Deno.test('accepts a valid token, kind, and file, and stages it under the household prefix', async () => {
  let uploaded: unknown = null
  let inserted: unknown = null
  const result = await runDocumentIntake(
    'token',
    'payslip',
    file(),
    deps({
      uploadObject: (path, uploadedFile) => {
        uploaded = { path, uploadedFile }
        return Promise.resolve(true)
      },
      insertIntake: (row) => {
        inserted = row
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(result.status, 201)
  const body = result.body as { id: string; kind: string }
  assertEquals(body.kind, 'payslip')
  assertEquals(typeof body.id, 'string')

  const { path } = uploaded as { path: string }
  assertEquals(path, `h-1/${body.id}/slip.pdf`)
  assertEquals(inserted, {
    id: body.id,
    householdId: 'h-1',
    memberId: 'm-1',
    kind: 'payslip',
    storagePath: `h-1/${body.id}/slip.pdf`,
    originalFilename: 'slip.pdf',
  })
})

Deno.test('reports the token resolution error and never validates the rest of the request', async () => {
  const result = await runDocumentIntake(
    'bad-token',
    'not-a-kind',
    null,
    deps({
      resolveToken: () =>
        Promise.resolve({
          error: {
            status: 401,
            message: 'This device is not connected. Reconnect it from the Household tab.',
          },
        }),
    }),
  )
  assertEquals(result, {
    status: 401,
    body: { error: 'This device is not connected. Reconnect it from the Household tab.' },
  })
})

Deno.test('rejects a kind that is not payslip or deduction', async () => {
  const result = await runDocumentIntake('token', 'not-a-kind', file(), deps())
  assertEquals(result.status, 400)
})

Deno.test('rejects a missing file', async () => {
  const result = await runDocumentIntake('token', 'payslip', null, deps())
  assertEquals(result.status, 400)
})

Deno.test('rejects an empty file', async () => {
  const result = await runDocumentIntake(
    'token',
    'payslip',
    file({ bytes: new Uint8Array() }),
    deps(),
  )
  assertEquals(result.status, 400)
})

Deno.test('rejects an unsupported file type', async () => {
  const result = await runDocumentIntake(
    'token',
    'payslip',
    file({ contentType: 'text/plain', filename: 'notes.txt' }),
    deps(),
  )
  assertEquals(result.status, 415)
})

Deno.test('rejects an image over its size cap', async () => {
  const result = await runDocumentIntake(
    'token',
    'deduction',
    file({
      contentType: 'image/jpeg',
      filename: 'receipt.jpg',
      bytes: new Uint8Array(MAX_IMAGE_BYTES + 1),
    }),
    deps(),
  )
  assertEquals(result.status, 413)
})

Deno.test('accepts a PDF under the larger PDF cap but over the image cap', async () => {
  const result = await runDocumentIntake(
    'token',
    'payslip',
    file({ bytes: new Uint8Array(MAX_IMAGE_BYTES + 1) }),
    deps(),
  )
  assertEquals(result.status, 201)
})

Deno.test('rejects a PDF over its size cap', async () => {
  const result = await runDocumentIntake(
    'token',
    'payslip',
    file({ bytes: new Uint8Array(MAX_PDF_BYTES + 1) }),
    deps(),
  )
  assertEquals(result.status, 413)
})

Deno.test('reports a storage failure without inserting a row', async () => {
  let insertCalled = false
  const result = await runDocumentIntake(
    'token',
    'payslip',
    file(),
    deps({
      uploadObject: () => Promise.resolve(false),
      insertIntake: () => {
        insertCalled = true
        return Promise.resolve(true)
      },
    }),
  )
  assertEquals(result.status, 500)
  assertEquals(insertCalled, false)
})

Deno.test('reports an insert failure after a successful upload', async () => {
  const result = await runDocumentIntake(
    'token',
    'deduction',
    file(),
    deps({ insertIntake: () => Promise.resolve(false) }),
  )
  assertEquals(result.status, 500)
})

Deno.test('resolveMediaType prefers a supported content type over the extension', () => {
  assertEquals(resolveMediaType('image/png', 'file.jpg'), 'image/png')
})

Deno.test('resolveMediaType falls back to the extension when the content type is absent or generic', () => {
  assertEquals(resolveMediaType(null, 'slip.pdf'), 'application/pdf')
  assertEquals(resolveMediaType('application/octet-stream', 'receipt.jpeg'), 'image/jpeg')
})

Deno.test('resolveMediaType rejects an unrecognised type and extension', () => {
  assertEquals(resolveMediaType('text/plain', 'notes.txt'), null)
})

Deno.test('sanitiseFilename keeps a plain filename and strips a directory prefix', () => {
  assertEquals(sanitiseFilename('slip.pdf'), 'slip.pdf')
  assertEquals(sanitiseFilename('../../etc/passwd'), 'passwd')
  assertEquals(sanitiseFilename('C:\\Users\\me\\slip.pdf'), 'slip.pdf')
})

Deno.test('sanitiseFilename replaces unsafe characters and never returns empty', () => {
  assertEquals(sanitiseFilename('pay slip (final)!.pdf'), 'pay_slip__final__.pdf')
  assertEquals(sanitiseFilename(''), 'document')
  assertEquals(sanitiseFilename('...'), 'document')
})
