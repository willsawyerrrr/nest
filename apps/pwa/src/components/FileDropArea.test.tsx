import { createEvent, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '../test/render'
import { FileDropArea } from './FileDropArea'

describe('FileDropArea', () => {
  it('hands over files dropped on it, and ignores a drag that carries none', () => {
    const onFiles = vi.fn()
    render(
      <FileDropArea onFiles={onFiles}>
        <button type="button">inside</button>
      </FileDropArea>,
    )
    const area = screen.getByRole('group', { name: 'Drop files here' })

    fireEvent.dragOver(area, { dataTransfer: { types: ['text/plain'] } })
    fireEvent.drop(area, { dataTransfer: { types: ['text/plain'], files: [] } })
    expect(onFiles).not.toHaveBeenCalled()

    fireEvent.dragOver(area, { dataTransfer: { types: ['Files'] } })
    fireEvent.dragLeave(area, { relatedTarget: document.body })
    fireEvent.dragOver(area, { dataTransfer: { types: ['Files'] } })
    const within = createEvent.dragLeave(area)
    Object.defineProperty(within, 'relatedTarget', { value: screen.getByText('inside') })
    fireEvent(area, within)
    const file = new File(['x'], 'a.pdf')
    fireEvent.drop(area, { dataTransfer: { types: ['Files'], files: [file] } })

    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
