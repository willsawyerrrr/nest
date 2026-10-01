import { Alert, Group, Loader, Text } from '@mantine/core'
import type { ExtractionState } from '../hooks/useDeductionAttachment'

/**
 * What a successful read did, in one line. Every field it filled is already on
 * screen in the field it filled, so the note attributes the lot to the model
 * and asks for a check against the receipt rather than restating values the
 * member is looking at.
 */
export function ReadFromReceipt({ filledNothing }: { filledNothing: boolean }) {
  return (
    <Alert color="info" variant="light" p="xs" title="Read from the receipt">
      <Text size="xs">
        {filledNothing
          ? 'Nothing on the receipt could be filled in for you.'
          : 'The details below were extracted from the receipt by AI — check them against it before saving.'}
      </Text>
    </Alert>
  )
}

/**
 * Where reading the first attached receipt has got to, shown under the file
 * picker. Every failure reads as what it is — the feature switched off, a file
 * that is not a receipt, one too large or of a type that cannot be read — and
 * none of them blocks the save: the details are typed by hand exactly as they
 * always were.
 */
export function ExtractionNote({ state }: { state: ExtractionState }) {
  if (state.status === 'idle') {
    return null
  }
  if (state.status === 'uploading' || state.status === 'reading') {
    return (
      <Group gap="xs" role="status">
        <Loader size="xs" />
        <Text size="xs" c="dimmed">
          {state.status === 'uploading' ? 'Storing the receipt…' : 'Reading the receipt…'}
        </Text>
      </Group>
    )
  }
  if (
    state.status === 'not-configured' ||
    state.status === 'out-of-credit' ||
    state.status === 'key-rejected' ||
    state.status === 'unsupported'
  ) {
    // Off, not broken — a key never set, an account out of credit, a key the
    // API refuses, or a file type the model cannot read.
    // Each names its own cause so the operator's fix is clear.
    return (
      <Text size="xs" c="dimmed">
        {state.message}
      </Text>
    )
  }
  if (state.status === 'not-receipt') {
    return (
      <Alert color="warning" variant="light" p="xs">
        <Text size="xs">
          {state.message}
          {state.reason !== null && ` ${state.reason}`} Enter the details by hand.
        </Text>
      </Alert>
    )
  }
  if (state.status === 'failed') {
    return (
      <Alert color="warning" variant="light" p="xs">
        <Text size="xs">{state.message}</Text>
      </Alert>
    )
  }
  return <ReadFromReceipt filledNothing={state.filledNothing} />
}
