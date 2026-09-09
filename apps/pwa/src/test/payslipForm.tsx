/* eslint-disable react/only-export-components -- shared test harness for the payslip form suites. */
import { useState } from 'react'
import type userEvent from '@testing-library/user-event'
import { expect, vi } from 'vitest'
import { PayslipForm } from '../components/PayslipForm'
import type { PayslipAttachments, PayslipSubmission } from '../hooks/usePayslips'
import type { ExtractionOutcome, PayslipExtraction } from '../lib/payslipExtraction'
import { makeInflow } from './fixtures'
import { render, screen, waitFor } from './render'

type User = ReturnType<typeof userEvent.setup>

export const member = { id: 'm1', name: 'Will' }

export const inflows = [
  makeInflow({ id: 'i1', name: 'Day job' }),
  makeInflow({ id: 'i2', name: 'Side job', member_id: 'm2' }),
  makeInflow({ id: 'i3', name: 'Gift money', taxable: false }),
  // Taxed in full, but no employer super accrues on it.
  makeInflow({ id: 'i4', name: 'On-call (T1)', type: 'other', attracts_super: false }),
]

/** What a slip's figures come back as when the model reads every one of them. */
export function extraction(overrides: Partial<PayslipExtraction> = {}): PayslipExtraction {
  return {
    model: 'claude-haiku-4-5-20251001',
    fields: {
      period_start: '2026-07-06',
      period_end: '2026-07-19',
      paid_on: '2026-07-22',
      gross_cents: 4_120_50,
      tax_withheld_cents: 1_048_00,
      super_cents: 473_86,
      net_cents: 3_072_50,
      salary_sacrifice_cents: null,
    },
    // The slip's own itemisation, which most of these tests do not exercise: a slip
    // printing no line detail still yields its totals.
    lines: { earnings: [], tax: [] },
    ...overrides,
  }
}

export const upload = vi.fn()
export const discard = vi.fn()
export const read = vi.fn()
export const attachments: PayslipAttachments = { upload, discard, read }

/** Clears the attachment mocks and restores their happy-path defaults; call in `beforeEach`. */
export function resetPayslipAttachmentMocks() {
  vi.clearAllMocks()
  upload.mockImplementation(async (payslipId: string, file: File) => ({
    payslipId,
    path: `h1/${payslipId}/uuid-${file.name}`,
  }))
  discard.mockResolvedValue(undefined)
  read.mockResolvedValue({ status: 'read', extraction: extraction() } satisfies ExtractionOutcome)
}

/** The single submission the form passed to its `onSubmit`. */
export function submitted(onSubmit: ReturnType<typeof vi.fn>): PayslipSubmission {
  return onSubmit.mock.calls[0]![0] as PayslipSubmission
}

/** The form's file picker, which has no accessible label of its own. */
export function filePicker() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

/**
 * The form as its list renders it: the save is awaited and the form then closed,
 * which is what makes the attachment permanent. `keep()` runs after that close is
 * asked for, so the ordering — a close that is only scheduled, not yet flushed —
 * is what stops the unmount cleanup deleting the document the saved row points at.
 */
export function ClosingPayslipForm({
  onSaved,
}: {
  onSaved: (submission: PayslipSubmission) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  if (!open) {
    return <p>Saved</p>
  }
  return (
    <PayslipForm
      member={member}
      inflows={inflows}
      attachments={attachments}
      onSubmit={async (submission) => {
        await onSaved(submission)
        setOpen(false)
      }}
    />
  )
}

/** Attaches a slip and waits for the store-and-read to settle. */
export async function attach(user: User, name = 'slip.pdf') {
  await user.upload(filePicker(), new File(['x'], name, { type: 'application/pdf' }))
  await waitFor(() => expect(screen.queryByText(/the slip…$/)).not.toBeInTheDocument())
}

/** Renders an add form for the member, returning its `onSubmit` spy. */
export function renderForm(props: Partial<Parameters<typeof PayslipForm>[0]> = {}) {
  const onSubmit = vi.fn()
  render(
    <PayslipForm
      member={member}
      inflows={inflows}
      attachments={attachments}
      onSubmit={onSubmit}
      {...props}
    />,
  )
  return onSubmit
}

/** The submitted shape of one earnings line: no tax component, as the schema requires. */
export function earningLine(sourceInflowId: string | null, label: string, amountCents: number) {
  return {
    kind: 'earning',
    source_inflow_id: sourceInflowId,
    tax_component: null,
    label,
    amount_cents: amountCents,
  }
}

/** The submitted shape of one tax line: no inflow, as the schema requires. */
export function taxLine(component: string, label: string, amountCents: number) {
  return {
    kind: 'tax',
    source_inflow_id: null,
    tax_component: component,
    label,
    amount_cents: amountCents,
  }
}

/** Types the quartet a save needs, at the real Heidi slip's figures. */
export async function fillQuartet(user: User, gross = '5495.50') {
  await user.type(screen.getByLabelText('Gross'), gross)
  await user.type(screen.getByLabelText('Tax withheld'), '1850')
  await user.type(screen.getByLabelText('Super'), '600')
  await user.type(screen.getByLabelText('Net'), '3645.50')
}
