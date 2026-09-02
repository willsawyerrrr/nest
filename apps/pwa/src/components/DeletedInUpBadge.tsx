import { Badge } from '@mantine/core'

/**
 * Marks an account Up has stopped reporting but Nest still holds because
 * something references it. A status badge — semantic `warning` — shown wherever
 * such an account appears (goal savers, splits, net worth) so the household
 * knows to relink and remove it.
 */
export function DeletedInUpBadge() {
  return (
    <Badge size="xs" variant="light" color="warning" style={{ flexShrink: 0 }}>
      Deleted in Up
    </Badge>
  )
}
