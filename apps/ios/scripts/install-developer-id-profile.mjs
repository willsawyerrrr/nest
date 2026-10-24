// Installs the active Developer ID provisioning profile with the given name
// into Xcode's profile directory and prints its UUID.
//
// Usage: node install-developer-id-profile.mjs <profile name>
//
// Authenticates to the App Store Connect API with `NOTARY_KEY_PATH`,
// `NOTARY_KEY_ID`, and `NOTARY_ISSUER_ID`.
import { execFileSync } from 'node:child_process'
import { createSign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const [name] = process.argv.slice(2)
const { NOTARY_KEY_PATH, NOTARY_KEY_ID, NOTARY_ISSUER_ID } = process.env
if (!name || !NOTARY_KEY_PATH || !NOTARY_KEY_ID || !NOTARY_ISSUER_ID) {
  console.error('Usage: install-developer-id-profile.mjs <profile name> (NOTARY_* set)')
  process.exit(2)
}

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const issuedAt = Math.floor(Date.now() / 1000)
const unsigned = [
  encode({ alg: 'ES256', kid: NOTARY_KEY_ID, typ: 'JWT' }),
  encode({ iss: NOTARY_ISSUER_ID, iat: issuedAt, exp: issuedAt + 600, aud: 'appstoreconnect-v1' }),
].join('.')
const signature = createSign('SHA256')
  .update(unsigned)
  .sign({ key: readFileSync(NOTARY_KEY_PATH), dsaEncoding: 'ieee-p1363' })
  .toString('base64url')

const query = new URLSearchParams({
  'filter[name]': name,
  'filter[profileType]': 'MAC_APP_DIRECT',
  'filter[profileState]': 'ACTIVE',
})
const response = await fetch(`https://api.appstoreconnect.apple.com/v1/profiles?${query}`, {
  headers: { Authorization: `Bearer ${unsigned}.${signature}` },
})
if (!response.ok) {
  console.error(`App Store Connect answered ${response.status} listing profiles`)
  process.exit(1)
}
const { data } = await response.json()
const profile = data.find((candidate) => candidate.attributes.name === name)
if (!profile) {
  console.error(`No active Developer ID profile named "${name}"`)
  process.exit(1)
}

const content = Buffer.from(profile.attributes.profileContent, 'base64')
const directory = join(homedir(), 'Library/MobileDevice/Provisioning Profiles')
mkdirSync(directory, { recursive: true })
const plist = execFileSync('security', ['cms', '-D'], { input: content })
const uuid = execFileSync('plutil', ['-extract', 'UUID', 'raw', '-o', '-', '-'], {
  input: plist,
})
  .toString()
  .trim()
writeFileSync(join(directory, `${uuid}.provisionprofile`), content)
console.log(uuid)
