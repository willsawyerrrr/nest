import { Link } from 'react-router-dom'
import { Alert, Button, Flex, Group, Text } from '@mantine/core'
import { IconFlask } from '@tabler/icons-react'
import { usePlanningMode } from './PlanningModeProvider'

/**
 * The app-shell bar shown whenever planning mode is on: a standing reminder
 * that edits are not being saved, with the one action that discards them.
 * Renders nothing when planning mode is off. Its message and actions stack
 * below `sm` and sit side by side from `sm` up, keeping the fixed-width
 * buttons from squeezing the text onto too little room on a phone.
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
      icon={<IconFlask size={16} />}
      title="Planning mode"
      p="xs"
    >
      <Flex
        direction={{ base: 'column', sm: 'row' }}
        justify="space-between"
        align={{ sm: 'center' }}
        gap="xs"
      >
        <Text size="xs">
          Changes to pays, bills, and savings goals aren’t saved
          {pendingCount > 0 && ` — ${pendingCount} pending change${pendingCount === 1 ? '' : 's'}`}.
        </Text>
        <Group gap="xs" wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
          <Button size="compact-xs" color="warning" variant="light" component={Link} to="/planning">
            Review
          </Button>
          <Button size="compact-xs" color="warning" variant="filled" onClick={exit}>
            Exit planning mode
          </Button>
        </Group>
      </Flex>
    </Alert>
  )
}
