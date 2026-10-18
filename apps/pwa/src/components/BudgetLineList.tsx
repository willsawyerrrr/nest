import { Fragment, useState, type ReactNode } from 'react'
import { ActionIcon, CloseButton, Flex, Group, Select, Stack, TextInput } from '@mantine/core'
import {
  fortnightlyCents,
  isDrawnFromAllowance,
  summariseAllowances,
  type MemberAllowance,
} from '@nest/plan'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { useInlineEditing } from '../hooks/useInlineEditing'
import { useSortPreference } from '../hooks/useSortPreference'
import { allowanceChoices, toPlanDrawableLine } from '../lib/allowances'
import { BUDGET_GROUPS } from '../lib/budgetGroups'
import { resolveRoute } from '../lib/budgetLineRoute'
import type { BudgetGroup } from '../lib/domain'
import { sortBy, type SortDirection, type SortPreference } from '../lib/sort'
import { AddButton } from './AddButton'
import { BudgetLineForm } from './BudgetLineForm'
import { BudgetLineItem, type DerivedSource } from './BudgetLineItem'
import { DerivedBudgetLineForm, type DerivedLineValues } from './DerivedBudgetLineForm'
import { EmptyState } from './EmptyState'
import { GroupSection } from './GroupSection'

interface BudgetLineListProps {
  lines: BudgetLine[]
  goals: { id: string; name: string; linkedAccountId?: string | null }[]
  /** The household's accounts, offered as the funding destination on non-savings/investments lines. */
  accounts?: { id: string; name: string }[]
  /**
   * The members who have a spending allowance, with its plan shape: offered as a
   * source on Discretionary lines, and counted into the Discretionary subtotal in
   * place of the lines drawn from them.
   */
  allowances?: { name: string; allowance: MemberAllowance }[]
  /**
   * The signed-in member, whose allowance items are listed apart in their own
   * section and who alone may draw an item from an allowance (theirs). Items drawn
   * from a co-member's allowance are private to them and never reach this list.
   */
  ownAllowanceMemberId?: string | null
  /** Rendered at the top of the Discretionary group, above its lines. */
  discretionaryHeader?: ReactNode
  /** The household's generic breakdowns; a line sourced from one links through to it and seeds its editor. */
  breakdowns?: { id: string; name: string; line_group: BudgetGroup }[]
  onCreate: (input: BudgetLineInput) => Promise<void>
  onUpdate: (id: string, input: BudgetLineInput) => Promise<void>
  /**
   * Saves a derived line's edit, fanning the name/group to its breakdown and the
   * funding account to the line. Omitted in planning mode, where a derived line is
   * read-only.
   */
  onUpdateDerivedLine?: ((lineId: string, values: DerivedLineValues) => Promise<void>) | undefined
  onDelete: (id: string) => void
}

/** Which add form is open: the top-level item form, a per-group line form, or the member's allowance item form. */
type AddContext = { kind: 'item' } | { kind: 'group'; group: BudgetGroup } | { kind: 'allowance' }

/** How the lines within each group are ordered. */
type SortKey = 'default' | 'name' | 'amount'

const SORT_STORAGE_KEY = 'budget-line-sort'
const DEFAULT_SORT: SortPreference<SortKey> = { key: 'default', direction: 'asc' }

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'name', label: 'Name' },
  { value: 'amount', label: 'Amount' },
]

/**
 * Orders lines by the chosen key and direction. `default` preserves the given
 * order untouched; `name` and `amount` sort ascending then reverse for descending.
 */
function sortLines(lines: BudgetLine[], key: SortKey, direction: SortDirection): BudgetLine[] {
  if (key === 'default') {
    return lines
  }
  return sortBy(
    lines,
    (a, b) =>
      key === 'name'
        ? a.name.localeCompare(b.name)
        : fortnightlyCents(a.amount_cents, a.frequency, a.interval_count ?? undefined) -
          fortnightlyCents(b.amount_cents, b.frequency, b.interval_count ?? undefined),
    direction,
  )
}

/**
 * The household's budget lines grouped by the five groups, each group showing a
 * fortnightly subtotal, a per-group add affordance, and inline add/edit forms.
 * A derived line (a gift line or one owned by a generic breakdown) edits inline
 * like a manual line — a generic line's name and group flow to the breakdown and
 * its funding account to the line — but its amount stays roll-up-owned, so it
 * carries an edit pencil and a chevron to its source (its breakdown, or the Gifts
 * tab) rather than a delete control.
 */
export function BudgetLineList({
  lines,
  goals,
  accounts = [],
  allowances = [],
  ownAllowanceMemberId = null,
  discretionaryHeader,
  breakdowns = [],
  onCreate,
  onUpdate,
  onUpdateDerivedLine,
  onDelete,
}: BudgetLineListProps) {
  // Account name lookup for each line's route badge and its icon.
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))
  const allowanceNames = new Map(
    allowances.map(({ name, allowance }) => [allowance.memberId, name]),
  )
  const planAllowances = allowances.map(({ allowance }) => allowance)
  const drawChoices = allowanceChoices(allowances, lines, ownAllowanceMemberId)
  const ownAllowance = allowances.find(
    ({ allowance }) => allowance.memberId === ownAllowanceMemberId,
  )
  const allowanceOutgoingCents = summariseAllowances(
    lines.map(toPlanDrawableLine),
    planAllowances,
  ).reduce((total, summary) => total + summary.allowance.fortnightlyCents, 0)
  const allowanceDrawnCents =
    summariseAllowances(lines.map(toPlanDrawableLine), planAllowances).find(
      (summary) => summary.memberId === ownAllowanceMemberId,
    )?.drawn.fortnightlyCents ?? 0
  const breakdownsById = new Map(breakdowns.map((breakdown) => [breakdown.id, breakdown]))
  const {
    editingId,
    adding,
    startAdding: startAddingContext,
    startEditing,
    close: closeForms,
  } = useInlineEditing<AddContext>()
  const { confirm, modal } = useConfirmDelete()
  const addingItem = adding?.kind === 'item'
  const addingGroup = adding?.kind === 'group' ? adding.group : null
  const addingAllowanceItem = adding?.kind === 'allowance'
  const [query, setQuery] = useState('')
  const {
    key: sortKey,
    direction: sortDirection,
    setKey,
    toggleDirection,
  } = useSortPreference(SORT_STORAGE_KEY, DEFAULT_SORT)

  const startAdding = (group: BudgetGroup) => startAddingContext({ kind: 'group', group })
  const startAddingItem = () => startAddingContext({ kind: 'item' })

  const search = query.trim().toLowerCase()
  const searching = search !== ''
  const isOwnAllowanceLine = (line: BudgetLine) =>
    ownAllowance != null && line.allowance_member_id === ownAllowanceMemberId
  const ownLines = sortLines(
    lines.filter(
      (line) =>
        isOwnAllowanceLine(line) && (!searching || line.name.toLowerCase().includes(search)),
    ),
    sortKey,
    sortDirection,
  )

  const renderLine = (line: BudgetLine) => {
    const breakdown = line.breakdown_id ? breakdownsById.get(line.breakdown_id) : undefined
    // A gift line is derived off `is_gift_line` (no breakdown); a generic
    // line is derived off its owning breakdown. Either edits inline: a
    // generic line's name and group flow to the breakdown and its funding
    // account to the line, while a gift line owns its own group and its
    // partition-derived name; the amount stays roll-up-owned in both.
    const isGift = line.is_gift_line
    const source: DerivedSource | undefined = isGift
      ? { isGift: true }
      : breakdown
        ? { isGift: false, breakdownId: breakdown.id }
        : undefined
    if (source) {
      return editingId === line.id && onUpdateDerivedLine ? (
        <DerivedBudgetLineForm
          key={line.id}
          initial={{
            id: line.id,
            breakdown_id: breakdown?.id ?? null,
            // A gift line's name is partition-derived, owned by the line;
            // a generic line's name is the breakdown's own name.
            name: isGift ? line.name : (breakdown?.name ?? line.name),
            // A gift line owns its own group; a generic line's group is the breakdown's.
            line_group: isGift ? line.line_group : (breakdown?.line_group ?? line.line_group),
            destination_account_id: line.destination_account_id,
            amount_cents: line.amount_cents,
            frequency: line.frequency,
            interval_count: line.interval_count,
            gift_recipient_member_id: line.gift_recipient_member_id,
          }}
          accounts={accounts}
          nameEditable={!isGift}
          onSave={async (values) => {
            await onUpdateDerivedLine(line.id, values)
            closeForms()
          }}
          onCancel={closeForms}
        />
      ) : (
        <BudgetLineItem
          key={line.id}
          line={line}
          route={resolveRoute(line, goals, accountNames, allowanceNames)}
          source={source}
          onEdit={onUpdateDerivedLine ? () => startEditing(line.id) : undefined}
        />
      )
    }
    return editingId === line.id ? (
      <BudgetLineForm
        key={line.id}
        initial={line}
        goals={goals}
        accounts={accounts}
        allowances={drawChoices}
        onSubmit={async (input) => {
          await onUpdate(line.id, input)
          closeForms()
        }}
        onCancel={closeForms}
      />
    ) : (
      <BudgetLineItem
        key={line.id}
        line={line}
        route={resolveRoute(line, goals, accountNames, allowanceNames)}
        onEdit={() => startEditing(line.id)}
        onDelete={() =>
          confirm({
            title: 'Delete budget item?',
            itemLabel: line.name,
            onConfirm: () => onDelete(line.id),
          })
        }
      />
    )
  }

  return (
    <Stack gap="lg">
      <AddButton label="Add item" onClick={startAddingItem} />
      <Flex
        direction={{ base: 'column', sm: 'row' }}
        gap="sm"
        align={{ sm: 'flex-end' }}
        wrap="wrap"
      >
        <TextInput
          aria-label="Search budget items"
          placeholder="Search budget items"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          rightSection={
            query ? <CloseButton aria-label="Clear search" onClick={() => setQuery('')} /> : null
          }
          style={{ flexGrow: 1 }}
        />
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label="Sort by"
            data={SORT_OPTIONS}
            value={sortKey}
            onChange={(value) => value && setKey(value as SortKey)}
            allowDeselect={false}
          />
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle sort direction"
            onClick={toggleDirection}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </ActionIcon>
        </Group>
      </Flex>

      {addingItem && (
        <BudgetLineForm
          goals={goals}
          accounts={accounts}
          allowances={drawChoices}
          onSubmit={async (input) => {
            await onCreate(input)
            closeForms()
          }}
          onCancel={closeForms}
        />
      )}

      {BUDGET_GROUPS.map(({ value: group, label }) => {
        const groupLines = lines.filter(
          (line) => line.line_group === group && !isOwnAllowanceLine(line),
        )
        // A line drawn from an allowance counts inside the allowance, which joins
        // Discretionary in full, so the subtotal agrees with the Summary.
        const subtotal =
          groupLines.reduce(
            (total, line) =>
              isDrawnFromAllowance({ allowanceMemberId: line.allowance_member_id }, planAllowances)
                ? total
                : total +
                  fortnightlyCents(
                    line.amount_cents,
                    line.frequency,
                    line.interval_count ?? undefined,
                  ),
            0,
          ) + (group === 'discretionary' ? allowanceOutgoingCents : 0)
        const visibleLines = sortLines(
          searching
            ? groupLines.filter((line) => line.name.toLowerCase().includes(search))
            : groupLines,
          sortKey,
          sortDirection,
        )
        if (searching && visibleLines.length === 0) {
          return null
        }
        const section = (
          <GroupSection title={label} subtotalCents={subtotal}>
            {group === 'discretionary' && !searching && discretionaryHeader}
            {!searching && groupLines.length === 0 && addingGroup !== group && (
              <EmptyState>No {label.toLowerCase()} items yet.</EmptyState>
            )}

            {visibleLines.map(renderLine)}

            {!searching &&
              (addingGroup === group ? (
                <BudgetLineForm
                  defaultGroup={group}
                  goals={goals}
                  accounts={accounts}
                  allowances={drawChoices}
                  onSubmit={async (input) => {
                    await onCreate(input)
                    closeForms()
                  }}
                  onCancel={closeForms}
                />
              ) : (
                <AddButton label={`Add ${label} item`} onClick={() => startAdding(group)} />
              ))}
          </GroupSection>
        )
        if (group !== 'discretionary' || !ownAllowance || (searching && ownLines.length === 0)) {
          return <Fragment key={group}>{section}</Fragment>
        }
        return (
          <Fragment key={group}>
            {section}
            <GroupSection title="Your allowance" subtotalCents={allowanceDrawnCents}>
              {!searching && ownLines.length === 0 && !addingAllowanceItem && (
                <EmptyState>Nothing drawn from your allowance yet.</EmptyState>
              )}
              {ownLines.map(renderLine)}
              {!searching &&
                (addingAllowanceItem ? (
                  <BudgetLineForm
                    defaultGroup="discretionary"
                    defaultAllowanceMemberId={ownAllowance.allowance.memberId}
                    goals={goals}
                    accounts={accounts}
                    allowances={drawChoices}
                    onSubmit={async (input) => {
                      await onCreate(input)
                      closeForms()
                    }}
                    onCancel={closeForms}
                  />
                ) : (
                  <AddButton
                    label="Add allowance item"
                    onClick={() => startAddingContext({ kind: 'allowance' })}
                  />
                ))}
            </GroupSection>
          </Fragment>
        )
      })}

      {modal}
    </Stack>
  )
}
