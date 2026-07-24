import { useState, type FormEvent } from 'react'

/** The submit machinery a form binds to its `<form>` element and footer. */
export interface FormSubmit {
  /** Whether a save is in flight. */
  submitting: boolean
  /** The current failure message, or null when none. */
  error: string | null
  /** The form's `onSubmit` handler, owning the submit state machine. */
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}

interface UseFormSubmitOptions<T> {
  /** Field validity; a submit is ignored while this is false. Defaults to true. */
  canSubmit?: boolean
  /** Builds the payload passed to `onSubmit`; called only once a submit is allowed. */
  buildInput: () => T
  /** Persists the built input; the caller closes or refreshes on success. */
  onSubmit: (input: T) => void | Promise<void>
  /** The message shown when `onSubmit` throws. */
  errorMessage: string
  /** Runs when a submit starts, after the guard passes (e.g. to clear a saved flag). */
  onStart?: () => void
  /** Runs after `onSubmit` resolves (e.g. to set a saved flag). */
  onSuccess?: () => void
  /**
   * When true, `submitting` resets to false after a successful save — for a form
   * that stays mounted; when false it stays true, as the form unmounts on success.
   */
  resetOnSuccess?: boolean
}

/**
 * The submit state machine shared by the app's forms: it guards on `canSubmit`,
 * flips `submitting`, clears and sets `error` around the awaited `onSubmit`, and
 * builds the input via `buildInput` only once a submit is allowed.
 */
export function useFormSubmit<T>({
  canSubmit = true,
  buildInput,
  onSubmit,
  errorMessage,
  onStart,
  onSuccess,
  resetOnSuccess = false,
}: UseFormSubmitOptions<T>): FormSubmit {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || submitting) {
      return
    }
    setSubmitting(true)
    setError(null)
    onStart?.()
    try {
      await onSubmit(buildInput())
      onSuccess?.()
      if (resetOnSuccess) {
        setSubmitting(false)
      }
    } catch {
      setError(errorMessage)
      setSubmitting(false)
    }
  }

  return { submitting, error, handleSubmit }
}
