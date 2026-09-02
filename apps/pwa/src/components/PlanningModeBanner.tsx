import { Alert, Button, Group, Text } from '@mantine/core'
import { IconFlask } from '@tabler/icons-react'
import { usePlanningMode } from './PlanningModeProvider'

/**
 * The app-shell bar shown whenever planning mode is on: a standing reminder
 * that edits are not being saved, with the one action that discards them.
 * Renders nothing when planning mode is off.
 */
export function PlanningModeBanner() {
  const { active, exit, pendingCount } = usePlanningMode()
  if (!active) {
    return null
  }
  return (
    <Alert
      className="planning-banner"
      color="warning"
      variant="light"
      icon={<IconFlask size={18} />}
      title="Planning mode"
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">
          Changes to pays, bills, and savings goals aren’t saved
          {pendingCount > 0 && ` — ${pendingCount} pending change${pendingCount === 1 ? '' : 's'}`}.
        </Text>
        <Button size="xs" color="warning" variant="filled" onClick={exit} style={{ flexShrink: 0 }}>
          Exit planning mode
        </Button>
      </Group>
    </Alert>
  )
}
