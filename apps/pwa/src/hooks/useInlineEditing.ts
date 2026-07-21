import { useState } from 'react'

/**
 * The inline add/edit state machine shared by the lists: at most one of an add
 * form or a per-row edit form is open at a time. `A` is the add context — the
 * value carried while adding, defaulting to a `true` marker for a list with a
 * single add affordance; a list with several add affordances passes a tagged
 * value describing which one is open.
 */
export interface InlineEditing<A> {
  /** The id of the row being edited, or null when no row is. */
  editingId: string | null
  /** The active add context, or null when not adding. */
  adding: A | null
  /** Opens the add form with the given context, closing any row edit. */
  startAdding: (context: A) => void
  /** Opens the edit form for a row, closing any add form. */
  startEditing: (id: string) => void
  /** Closes both the add and edit forms. */
  close: () => void
}

/**
 * Holds the inline add/edit state for a list: an `editingId` and an `adding`
 * context that are mutually exclusive. Starting one clears the other; `close`
 * clears both.
 */
export function useInlineEditing<A = true>(): InlineEditing<A> {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState<A | null>(null)

  return {
    editingId,
    adding,
    startAdding: (context: A) => {
      setEditingId(null)
      setAdding(context)
    },
    startEditing: (id: string) => {
      setAdding(null)
      setEditingId(id)
    },
    close: () => {
      setEditingId(null)
      setAdding(null)
    },
  }
}
