import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal, GoalInput } from '../hooks/useGoals'
import type { Saver } from '../hooks/useSavers'
import type { PromoteDraft } from '../lib/promoteDraft'
import { GoalForm } from './GoalForm'
import { GoalList } from './GoalList'
import { PageSection } from './PageSection'

interface GoalScreenProps {
  goals: Goal[]
  lines: BudgetLine[]
  savers: Saver[]
  /** The real goals and lines for the planning-mode comparison; omit outside planning mode. */
  baselineGoals?: Goal[]
  baselineLines?: BudgetLine[]
  onCreateGoal: (input: GoalInput) => Promise<void>
  onUpdateGoal: (id: string, input: GoalInput) => Promise<void>
  onDeleteGoal: (id: string) => Promise<void>
  onRefresh: () => void
  refreshing: boolean
  refreshError: string | null
  /** A wishlist item promoted to a goal: opens a prefilled add form above the list. */
  promoteDraft?: PromoteDraft | null
  /** Called once the promoted draft has been saved or dismissed, to clear it. */
  onPromoteConsumed?: () => void
}

/** Presentational savings-goal management with progress and ETA. Persistence lives in the caller. */
export function GoalScreen({
  goals,
  lines,
  savers,
  baselineGoals,
  baselineLines,
  onCreateGoal,
  onUpdateGoal,
  onDeleteGoal,
  onRefresh,
  refreshing,
  refreshError,
  promoteDraft,
  onPromoteConsumed,
}: GoalScreenProps) {
  return (
    <PageSection title="Goals">
      <Group justify="flex-end">
        <Button
          variant="light"
          size="xs"
          leftSection={<IconRefresh size={16} />}
          onClick={onRefresh}
          loading={refreshing}
        >
          Refresh
        </Button>
      </Group>
      {refreshError && (
        <Alert color="red" variant="light">
          {refreshError}
        </Alert>
      )}
      {promoteDraft && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            New goal from your wishlist item “{promoteDraft.name}”. Adjust and save it, or cancel to
            leave the wishlist item as it is.
          </Text>
          <GoalForm
            draft={promoteDraft}
            savers={savers}
            onSubmit={async (input) => {
              await onCreateGoal(input)
              onPromoteConsumed?.()
            }}
            onCancel={() => onPromoteConsumed?.()}
          />
        </Stack>
      )}
      <GoalList
        goals={goals}
        lines={lines}
        savers={savers}
        {...(baselineGoals && { baselineGoals })}
        {...(baselineLines && { baselineLines })}
        onCreate={onCreateGoal}
        onUpdate={onUpdateGoal}
        onDelete={(id) => void onDeleteGoal(id)}
      />
    </PageSection>
  )
}
