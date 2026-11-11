import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import { formatIsoDate } from './dates'

/**
 * The members the native Members screen is held to. The rows are written in full, as
 * PostgREST returns them; the figures are what `TaxProfileList` shows for each member:
 * the residency pill, the hospital-cover flag and the date-of-birth label. The fixture
 * is committed beside the iOS tests (`vitest -u` rewrites it); `MembersParityTests`
 * decodes the same rows and must list the same.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/members-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string, date_of_birth: string | null): Tables<'members'> => ({
  ...base,
  id,
  name,
  user_id: `u-${id}`,
  email: null,
  date_of_birth,
  up_connected_at: null,
  up_sync_failed_at: null,
})

const profile = (
  id: string,
  member_id: string,
  residency: Tables<'tax_profile'>['residency'],
  has_private_hospital_cover: boolean,
): Tables<'tax_profile'> => ({
  ...base,
  id,
  member_id,
  financial_year: 2027,
  residency,
  has_private_hospital_cover,
})

const members = [
  member('m1', 'Alex', '1990-09-05'),
  member('m2', 'Sam', '1985-02-28'),
  member('m3', 'Jo', null),
]
const taxProfiles = [
  profile('t1', 'm1', 'resident', true),
  profile('t2', 'm2', 'foreign_resident', false),
]

const listed = members.map((row) => {
  const taxProfile = taxProfiles.find((p) => p.member_id === row.id)
  return {
    id: row.id,
    name: row.name,
    residency: taxProfile?.residency === 'foreign_resident' ? 'Foreign resident' : 'Resident',
    hospitalCover: taxProfile?.has_private_hospital_cover ?? false,
    dateOfBirth: row.date_of_birth
      ? `Born ${formatIsoDate(row.date_of_birth)}`
      : 'No date of birth',
  }
})

describe('members parity fixture', () => {
  it('matches the committed rows and figures', async () => {
    await expect(
      JSON.stringify({ rows: { members, taxProfiles }, expected: listed }, null, 2) + '\n',
    ).toMatchFileSnapshot(FIXTURE)
  })

  it('treats a member with no profile as a resident without cover', () => {
    expect(listed[2]).toMatchObject({ residency: 'Resident', hospitalCover: false })
  })
})
