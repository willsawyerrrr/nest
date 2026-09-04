import { Fragment, type ReactNode } from 'react'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import { useInlineEditing } from '../hooks/useInlineEditing'
import { AddButton } from './AddButton'
import type { ConfirmDeleteTarget } from './ConfirmDeleteModal'
import { EmptyState } from './EmptyState'

/** The edit and delete callbacks wired for one settled row. */
export interface ItemControls {
  onEdit: () => void
  onDelete: () => void
}

/** The controls handed to the add/edit form. `initial` is set when editing a row. */
export interface FormControls<T, I> {
  initial?: T
  onSubmit: (input: I) => Promise<void>
  onCancel: () => void
}

interface EditableListProps<T extends { id: string }, I> {
  /** The rows to render, already in display order. */
  items: T[]
  /** The label for the add affordance, e.g. `Add goal`. */
  addLabel: string
  /** Hides the add button and add form — for a list whose adds happen elsewhere. */
  showAdd?: boolean
  /** The message shown when the list is empty and not adding. */
  emptyMessage: ReactNode
  /** Renders a settled row, given its wired edit and delete callbacks. */
  renderItem: (item: T, controls: ItemControls) => ReactNode
  /** Renders the add/edit form, given its wired submit and cancel callbacks. */
  renderForm: (controls: FormControls<T, I>) => ReactNode
  /** The confirm-delete heading and item name for a row. */
  deleteTarget: (item: T) => Pick<ConfirmDeleteTarget, 'title' | 'itemLabel'>
  onCreate: (input: I) => Promise<void>
  onUpdate: (id: string, input: I) => Promise<void>
  onDelete: (id: string) => void | Promise<void>
}

/**
 * The shared list scaffold: an empty state, each row shown as its settled body or
 * (when it is the one being edited) an inline form, then an add form or add button,
 * then the confirm-delete modal. It owns the inline-edit and confirm-delete state;
 * the per-entity row and form bodies are supplied via `renderItem` and `renderForm`.
 */
export function EditableList<T extends { id: string }, I>({
  items,
  addLabel,
  showAdd = true,
  emptyMessage,
  renderItem,
  renderForm,
  deleteTarget,
  onCreate,
  onUpdate,
  onDelete,
}: EditableListProps<T, I>) {
  const { editingId, adding, startAdding, startEditing, close } = useInlineEditing()
  const { confirm, modal } = useConfirmDelete()

  return (
    <>
      {items.length === 0 && !adding && <EmptyState>{emptyMessage}</EmptyState>}

      {items.map((item) => (
        <Fragment key={item.id}>
          {editingId === item.id
            ? renderForm({
                initial: item,
                onSubmit: async (input) => {
                  await onUpdate(item.id, input)
                  close()
                },
                onCancel: close,
              })
            : renderItem(item, {
                onEdit: () => startEditing(item.id),
                onDelete: () =>
                  confirm({ ...deleteTarget(item), onConfirm: () => onDelete(item.id) }),
              })}
        </Fragment>
      ))}

      {showAdd &&
        (adding ? (
          renderForm({
            onSubmit: async (input) => {
              await onCreate(input)
              close()
            },
            onCancel: close,
          })
        ) : (
          <AddButton label={addLabel} onClick={() => startAdding(true)} />
        ))}

      {modal}
    </>
  )
}
