import { useState, type FormEvent } from 'react'
import { Button, Card, Group, NumberInput, Select, Stack, Switch, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type {
  SuperContribution,
  SuperContributionInput,
  SuperContributionKind,
  SuperContributionMode,
} from '../hooks/useSuperContributions'
import type { Frequency } from '../lib/domain'
import { FREQUENCY_OPTIONS } from '../lib/frequency'
import { centsToDollars, dollarsToCents } from '../lib/money'
import { SUPER_CONTRIBUTION_KINDS } from '../lib/super'
import { EnumSegmentedControl, EnumSelect } from './EnumSelect'

interface SuperContributionFormProps {
  member: Member
  members: Member[]
  initial?: SuperContribution
  onSubmit: (input: SuperContributionInput) => void | Promise<void>
  onCancel?: () => void
}

/** Basis points as a percent number for a `NumberInput`, or `''` when unset. */
function bpToPercent(bp: number | null | undefined): number | '' {
  return bp == null ? '' : bp / 100
}

/** Presentational add/edit form for a single super contribution. Persistence lives in the caller. */
export function SuperContributionForm({
  member,
  members,
  initial,
  onSubmit,
  onCancel,
}: SuperContributionFormProps) {
  const [kind, setKind] = useState<SuperContributionKind>(initial?.kind ?? 'salary_sacrifice')
  const [mode, setMode] = useState<SuperContributionMode>(initial?.mode ?? 'amount')
  const [amount, setAmount] = useState<number | string>(centsToDollars(initial?.amount_cents))
  const [percent, setPercent] = useState<number | string>(bpToPercent(initial?.percent_bp))
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'fortnightly')
  const [interval, setInterval] = useState<number | string>(initial?.interval_count ?? '')
  const [fhssEligible, setFhssEligible] = useState(initial?.fhss_eligible ?? false)
  const [contributorId, setContributorId] = useState(initial?.contributor_member_id ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const otherMembers = members.filter((candidate) => candidate.id !== member.id)
  const isPercent = mode === 'percent'
  const isEveryN = frequency === 'every_n_weeks' || frequency === 'every_n_months'
  const intervalUnit = frequency === 'every_n_months' ? 'months' : 'weeks'
  const isSpouse = kind === 'spouse'
  const intervalValid = Number.isInteger(Number(interval)) && Number(interval) >= 1
  const canSubmit =
    (isPercent ? percent !== '' : amount !== '') &&
    (isEveryN ? interval !== '' && intervalValid : true) &&
    (isSpouse ? contributorId !== '' : true) &&
    !submitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    setError(null)
    const input: SuperContributionInput = {
      member_id: member.id,
      kind,
      mode,
      amount_cents: isPercent ? null : dollarsToCents(amount),
      percent_bp: isPercent ? Math.round(Number(percent) * 100) : null,
      frequency,
      interval_count: isEveryN ? Number(interval) : null,
      fhss_eligible: fhssEligible,
      contributor_member_id: isSpouse ? contributorId : null,
    }
    try {
      await onSubmit(input)
    } catch {
      setError('Could not save this contribution. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={handleSubmit}>
      <Stack gap="xs">
        <EnumSelect
          label="Kind"
          size="sm"
          data={SUPER_CONTRIBUTION_KINDS}
          value={kind}
          onChange={(value) => value && setKind(value)}
          allowDeselect={false}
        />

        {isSpouse && (
          <Select
            label="Contributor"
            size="sm"
            description="The member making this spouse contribution."
            data={otherMembers.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
            value={contributorId}
            onChange={(value) => setContributorId(value ?? '')}
            allowDeselect={false}
            placeholder="Select a member"
          />
        )}

        <EnumSegmentedControl
          fullWidth
          size="sm"
          aria-label="Contribution mode"
          value={mode}
          onChange={setMode}
          data={[
            { value: 'amount', label: 'Amount' },
            { value: 'percent', label: 'Percent of salary' },
          ]}
        />

        {isPercent ? (
          <NumberInput
            label="Percent of gross salary"
            size="sm"
            suffix="%"
            decimalScale={2}
            min={0}
            max={100}
            hideControls
            value={percent}
            onChange={setPercent}
          />
        ) : (
          <NumberInput
            label="Contribution amount"
            size="sm"
            prefix="$"
            thousandSeparator
            decimalScale={2}
            fixedDecimalScale
            min={0}
            hideControls
            value={amount}
            onChange={setAmount}
          />
        )}

        <EnumSelect
          label="Frequency"
          size="sm"
          data={FREQUENCY_OPTIONS}
          value={frequency}
          onChange={(value) => value && setFrequency(value)}
          allowDeselect={false}
        />

        {isEveryN && (
          <NumberInput
            label={`${intervalUnit === 'months' ? 'Months' : 'Weeks'} between contributions`}
            size="sm"
            min={1}
            step={1}
            allowDecimal={false}
            hideControls
            value={interval}
            onChange={setInterval}
          />
        )}

        <Switch
          label="FHSS eligible"
          size="sm"
          checked={fhssEligible}
          onChange={(event) => setFhssEligible(event.currentTarget.checked)}
        />

        {error && (
          <Text role="alert" c="red" size="sm">
            {error}
          </Text>
        )}

        <Group grow>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add contribution'}
          </Button>
          {onCancel && (
            <Button type="button" variant="default" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  )
}
