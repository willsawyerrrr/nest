import type { FormEvent, ReactNode } from 'react'
import { Button, Card, Group, Stack } from '@mantine/core'
import { FormError } from './FormError'

interface FormShellProps {
  /** The submit handler, typically from {@link useFormSubmit}. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  /** The current failure message, rendered above the footer when set. */
  error?: string | null
  /** Whether a save is in flight; disables the submit button and shows the saving label. */
  submitting: boolean
  /** Field validity; the submit button is disabled when false. Defaults to true. */
  canSubmit?: boolean
  /** Whether an existing record is being edited, selecting the "Save changes" label. */
  editing?: boolean
  /** The noun completing the add label, e.g. `deduction` → "Add deduction". */
  addLabel?: string
  /** Overrides the derived submit label (e.g. "Save", "Update actual balance"). */
  submitLabel?: string
  /** Renders a Cancel button beside submit when provided. */
  onCancel?: (() => void) | undefined
  /** Extra content between the error block and the footer, e.g. a saved status. */
  status?: ReactNode
  /** The form fields. */
  children: ReactNode
}

/**
 * The shared add/edit form frame: a bordered card `<form>`, the fields, an error
 * block, and a submit/cancel footer. The submit label reads "Saving…" while in
 * flight, then a `submitLabel` override if given, else "Save changes" when editing
 * or "Add {addLabel}" when adding.
 */
export function FormShell({
  onSubmit,
  error,
  submitting,
  canSubmit = true,
  editing,
  addLabel,
  submitLabel,
  onCancel,
  status,
  children,
}: FormShellProps) {
  const label = submitting
    ? 'Saving…'
    : (submitLabel ?? (editing ? 'Save changes' : `Add ${addLabel}`))

  return (
    <Card withBorder radius="md" p="sm" component="form" onSubmit={onSubmit}>
      <Stack gap="xs">
        {children}

        {error && <FormError>{error}</FormError>}
        {status}

        <Group grow>
          <Button type="submit" disabled={!canSubmit || submitting}>
            {label}
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
