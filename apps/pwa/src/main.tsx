import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ColorSchemeScript, MantineProvider, type CSSVariablesResolver } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/charts/styles.css'
import './index.css'
import App from './App.tsx'
import { theme } from './theme'
import './pwa'

// Collections are cached household-scoped so switching tabs reads cached data
// and revalidates in the background rather than cold-fetching. A short stale
// time keeps a revisit from refetching instantly while still catching drift.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

// The bright brand lime reads as a link colour only on the dark canvas. Light
// mode drops the anchor colour to a deep brand shade that clears WCAG AA on
// paper; dark mode keeps Mantine's vivid lime default.
const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--mantine-color-anchor': 'var(--mantine-color-brand-9)' },
  dark: {},
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColorSchemeScript defaultColorScheme="dark" />
    <MantineProvider
      theme={theme}
      defaultColorScheme="dark"
      cssVariablesResolver={cssVariablesResolver}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
)
