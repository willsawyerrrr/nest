import { Group, Stack, Switch, Text, Title } from '@mantine/core'
import { AppCard } from './AppCard'
import { usePlanningMode } from './PlanningModeProvider'

/**
 * The switch that turns planning mode on and off. On enables a per-device
 * sandbox over pays, bills, and savings goals; off discards every sandbox edit.
 * Every other tab keeps saving normally while planning mode is on.
 */
export function PlanningModeControl() {
  const { active, enter, exit, pendingCount } = usePlanningMode()
  return (
    <AppCard>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Title order={3} size="h5">
            Planning mode
          </Title>
          <Switch
            aria-label="Planning mode"
            checked={active}
            onChange={() => (active ? exit() : enter())}
          />
        </Group>
        <Text size="sm" c="dimmed">
          Try changes to your pays, bills, and savings goals and watch every projection update,
          without saving anything. Only those three are sandboxed — every other tab still saves
          normally.
          {active &&
            ` ${pendingCount} pending change${pendingCount === 1 ? '' : 's'}; turn off to discard.`}
        </Text>
      </Stack>
    </AppCard>
  )
}
