import { describe, expect, it, vi } from 'vitest'
import type { CashFlowGraph } from '../lib/cashFlow'
import { render, screen } from '../test/render'
import CashFlowSankeyChart from './CashFlowSankeyChart'

vi.mock('@mantine/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mantine/hooks')>()),
  useElementSize: () => ({ ref: { current: null }, width: 320, height: 240 }),
}))

const graph: CashFlowGraph = {
  nodes: [
    { name: 'Available', color: 'red', valueCents: 300_000 },
    { name: 'A very long budget line name', color: 'blue', valueCents: 200_000 },
    { name: 'Buffer', color: 'gray', valueCents: 100_000 },
  ],
  links: [
    { source: 0, target: 1, value: 200_000 },
    { source: 0, target: 2, value: 100_000 },
  ],
}

describe('CashFlowSankeyChart', () => {
  it('labels each node with its name and formatted cents, clipping long names', () => {
    render(<CashFlowSankeyChart graph={graph} />)
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('$3,000.00')).toBeInTheDocument()
    expect(screen.getByText('$2,000.00')).toBeInTheDocument()
    expect(screen.queryByText('A very long budget line name')).not.toBeInTheDocument()
    expect(screen.getByText(/^A very.*…$/)).toBeInTheDocument()
  })

  it('titles each ribbon with its flow', () => {
    render(<CashFlowSankeyChart graph={graph} />)
    expect(screen.getByText('Available to Buffer: $1,000.00')).toBeInTheDocument()
  })
})
