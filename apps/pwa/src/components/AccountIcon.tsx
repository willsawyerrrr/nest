import { IconWallet } from '@tabler/icons-react'
import { splitLeadingEmoji } from '../lib/accountName'

/** An account or saver's icon: its Up emoji when its name carries one, otherwise a shared default. */
export function AccountIcon({ name, size = 14 }: { name: string; size?: number }) {
  const { emoji } = splitLeadingEmoji(name)
  if (emoji) {
    return (
      <span aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
        {emoji}
      </span>
    )
  }
  return <IconWallet size={size} />
}
