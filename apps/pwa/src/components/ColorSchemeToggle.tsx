import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { IconMoon, IconSun } from '@tabler/icons-react'

/**
 * A sun/moon toggle flipping between the light and dark schemes. Dark is the
 * default; Mantine persists the choice via the `ColorSchemeScript` set in
 * `main.tsx`, so light mode is reachable in-app without touching the OS setting.
 * The icon and label name the scheme it switches to.
 */
export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme()
  const computed = useComputedColorScheme('dark', { getInitialValueInEffect: true })
  const next = computed === 'dark' ? 'light' : 'dark'
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label={`Switch to ${next} mode`}
      onClick={() => setColorScheme(next)}
    >
      {computed === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  )
}
