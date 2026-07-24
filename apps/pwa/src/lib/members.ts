import type { Member } from '../hooks/useMembers'

/** The name of the member with `id` within `members`, or `'Unknown'` when none matches. */
export function memberName(members: Member[], id: string): string {
  return members.find((member) => member.id === id)?.name ?? 'Unknown'
}
