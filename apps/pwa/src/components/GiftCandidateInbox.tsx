import { useState } from 'react'
import {
  Badge,
  Button,
  Collapse,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useFormSubmit } from '../hooks/useFormSubmit'
import type { GiftPurchaseInput } from '../hooks/useGifts'
import { formatIsoDate } from '../lib/dates'
import type {
  DismissedGiftCandidate,
  GiftCandidate,
  GiftLinkRecipient,
} from '../lib/giftCandidates'
import { AppCard } from './AppCard'
import { FormShell } from './FormShell'
import { MoneyText } from './MoneyText'

interface GiftCandidateInboxProps {
  /** The unclaimed gift-category transactions, newest first. */
  candidates: GiftCandidate[]
  /** The candidates set aside as "not a gift", newest first. */
  dismissed: DismissedGiftCandidate[]
  /** The recipients a candidate may be linked to, with their occasions (own gifts excluded). */
  recipientChoices: GiftLinkRecipient[]
  onLink: (input: GiftPurchaseInput) => Promise<void>
  onDismiss: (transactionId: string) => Promise<void>
  onRestore: (dismissalId: string) => Promise<void>
}

/** A candidate's own words, falling back to a generic label for an unnamed transaction. */
function candidateLabel(candidate: GiftCandidate): string {
  return candidate.description || 'Card purchase'
}

/** A candidate's description, amount, date, and a pending flag while it is held. */
function CandidateSummary({ candidate }: { candidate: GiftCandidate }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Group gap="xxs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>
            {candidateLabel(candidate)}
          </Text>
          {candidate.pending && (
            <Badge size="xs" variant="light" color="warning" style={{ flexShrink: 0 }}>
              Pending
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {formatIsoDate(candidate.postedOn)}
        </Text>
        {candidate.pending && (
          <Text size="xs" c="dimmed">
            Still held by Up — the amount can change when it settles.
          </Text>
        )}
      </Stack>
      <MoneyText cents={candidate.amountCents} size="sm" fw={600} style={{ flexShrink: 0 }} />
    </Group>
  )
}

/**
 * The recipient to start on: the only one, where there is only one, so a
 * household with a single gift recipient does not choose from a list of one.
 */
function soleRecipient(choices: GiftLinkRecipient[]): GiftLinkRecipient | undefined {
  return choices.length === 1 ? choices[0] : undefined
}

/**
 * The budget to start on for a recipient: their only occasion's, where they have
 * only one, so the common case of one gift per person stays a single choice.
 * Blank where the recipient has several occasions, or none is chosen yet.
 */
function soleBudgetId(recipient: GiftLinkRecipient | undefined): string {
  return recipient?.occasions.length === 1 ? recipient.occasions[0]!.value : ''
}

/**
 * Links one candidate to a gift budget, choosing the recipient and then one of
 * that recipient's budgeted occasions — which together name exactly one budget.
 * The amount and date come from the transaction and are not editable — a linked
 * purchase follows its transaction's amount as it settles — while the description
 * starts from Up's wording and can be reworded into something the gift log reads
 * better.
 */
function GiftCandidateLinkForm({
  candidate,
  recipientChoices,
  onSubmit,
  onCancel,
}: {
  candidate: GiftCandidate
  recipientChoices: GiftLinkRecipient[]
  onSubmit: (input: GiftPurchaseInput) => Promise<void>
  onCancel: () => void
}) {
  const initialRecipient = soleRecipient(recipientChoices)
  const [recipientId, setRecipientId] = useState(initialRecipient?.value ?? '')
  const [budgetId, setBudgetId] = useState(soleBudgetId(initialRecipient))
  const [description, setDescription] = useState(candidate.description)

  const chosenRecipient = recipientChoices.find((choice) => choice.value === recipientId)

  // A recipient's occasions are their own, so switching recipient starts the
  // occasion afresh — on their sole occasion where they have one, else unset.
  function chooseRecipient(value: string) {
    setRecipientId(value)
    setBudgetId(soleBudgetId(recipientChoices.find((choice) => choice.value === value)))
  }

  const canSubmit = budgetId !== ''

  const { submitting, error, handleSubmit } = useFormSubmit({
    canSubmit,
    errorMessage: 'Could not link this purchase. Please try again.',
    onSubmit,
    buildInput: (): GiftPurchaseInput => ({
      gift_budget_id: budgetId,
      amount_cents: candidate.amountCents,
      description: description.trim(),
      purchased_on: candidate.postedOn,
      transaction_id: candidate.transactionId,
    }),
  })

  return (
    <FormShell
      onSubmit={handleSubmit}
      error={error}
      submitting={submitting}
      canSubmit={canSubmit}
      submitLabel="Link purchase"
      onCancel={onCancel}
    >
      {/* An unset select takes `null`, not `''`: a `Select` shows its placeholder
          for the former and keeps its last label for the latter. */}
      <Select
        label="Recipient"
        size="sm"
        placeholder="Choose a recipient"
        data={recipientChoices.map(({ value, label }) => ({ value, label }))}
        value={recipientId || null}
        onChange={(value) => chooseRecipient(value ?? '')}
        allowDeselect={false}
      />

      <Select
        label="Occasion"
        size="sm"
        placeholder={chosenRecipient ? 'Choose an occasion' : 'Choose a recipient first'}
        data={chosenRecipient?.occasions ?? []}
        value={budgetId || null}
        onChange={(value) => setBudgetId(value ?? '')}
        allowDeselect={false}
        disabled={!chosenRecipient}
      />

      <TextInput
        label="Description"
        size="sm"
        value={description}
        onChange={(event) => setDescription(event.currentTarget.value)}
      />

      <Text size="xs" c="dimmed">
        The amount and date follow the transaction.
      </Text>
    </FormShell>
  )
}

/**
 * The gift inbox: the gift-category card spending Up synced that is not yet
 * accounted for, each row offering a link to a gift budget or a "not a gift"
 * set-aside. Up files charity donations under the same category, so setting one
 * aside is routine — and reversible from the set-aside list.
 *
 * The section renders only when there is something in it, so a household with no
 * synced gift spending sees nothing at all.
 */
export function GiftCandidateInbox({
  candidates,
  dismissed,
  recipientChoices,
  onLink,
  onDismiss,
  onRestore,
}: GiftCandidateInboxProps) {
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [showDismissed, { toggle: toggleDismissed }] = useDisclosure(false)

  if (candidates.length === 0 && dismissed.length === 0) {
    return null
  }

  return (
    <AppCard withBorder padding="sm">
      <Stack gap="sm">
        <Stack gap="xxs">
          <Title order={3} size="h5">
            From your card
          </Title>
          <Text size="xs" c="dimmed">
            Gift spending synced from Up. Link one to a gift, or set it aside.
          </Text>
        </Stack>

        {candidates.length > 0 && recipientChoices.length === 0 && (
          <Text size="xs" c="dimmed">
            Add a gift budget to link these against.
          </Text>
        )}

        {candidates.map((candidate) => (
          <AppCard key={candidate.transactionId} withBorder padding="xs">
            <Stack gap="xs">
              <CandidateSummary candidate={candidate} />
              {linkingId === candidate.transactionId ? (
                <GiftCandidateLinkForm
                  candidate={candidate}
                  recipientChoices={recipientChoices}
                  onSubmit={async (input) => {
                    await onLink(input)
                    setLinkingId(null)
                  }}
                  onCancel={() => setLinkingId(null)}
                />
              ) : (
                <Group gap="xs" grow>
                  <Button
                    variant="light"
                    disabled={recipientChoices.length === 0}
                    onClick={() => setLinkingId(candidate.transactionId)}
                  >
                    Link to a gift
                  </Button>
                  <Button variant="subtle" onClick={() => void onDismiss(candidate.transactionId)}>
                    Not a gift
                  </Button>
                </Group>
              )}
            </Stack>
          </AppCard>
        ))}

        {dismissed.length > 0 && (
          <Stack gap="xs">
            <Group justify="flex-start">
              <Button size="xs" variant="subtle" onClick={toggleDismissed}>
                {showDismissed ? 'Hide set aside' : `Set aside (${dismissed.length})`}
              </Button>
            </Group>
            <Collapse expanded={showDismissed}>
              <Stack gap="xs">
                {dismissed.map((candidate) => (
                  <AppCard key={candidate.transactionId} withBorder padding="xs">
                    <Stack gap="xs">
                      <CandidateSummary candidate={candidate} />
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => void onRestore(candidate.dismissalId)}
                        >
                          Undo
                        </Button>
                      </Group>
                    </Stack>
                  </AppCard>
                ))}
              </Stack>
            </Collapse>
          </Stack>
        )}
      </Stack>
    </AppCard>
  )
}
