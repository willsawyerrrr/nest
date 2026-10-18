import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, Center, Group, Stack, Text, Title } from '@mantine/core'
import { LoadingScreen } from '../components/LoadingScreen'
import { supabase } from '../lib/supabase'

interface Request {
  id: string
  client: string
}

/**
 * Where Supabase Auth sends a member to approve or deny an app (such as the
 * Claude connector) signing in to Nest. It is reached with an `authorization_id`
 * and, once the member has decided, hands the browser back to the app.
 */
export function OAuthConsentSection() {
  const [params] = useSearchParams()
  const authorizationId = params.get('authorization_id')
  const [request, setRequest] = useState<Request | null>(null)
  const [failed, setFailed] = useState(authorizationId === null)
  const [deciding, setDeciding] = useState(false)

  useEffect(() => {
    if (authorizationId === null) return
    let cancelled = false
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) {
        setFailed(true)
      } else if ('redirect_url' in data) {
        window.location.assign(data.redirect_url)
      } else {
        setRequest({ id: data.authorization_id, client: data.client.name })
      }
    })
    return () => {
      cancelled = true
    }
  }, [authorizationId])

  async function decide(current: Request, approve: boolean) {
    setDeciding(true)
    const { data, error } = await (approve
      ? supabase.auth.oauth.approveAuthorization(current.id)
      : supabase.auth.oauth.denyAuthorization(current.id))
    if (error || !data) {
      setDeciding(false)
      setFailed(true)
      return
    }
    window.location.assign(data.redirect_url)
  }

  if (failed) {
    return (
      <Center component="main" className="full-screen">
        <Alert color="red" title="This sign-in request is not valid" maw={360}>
          Go back to the app and start signing in again.
        </Alert>
      </Center>
    )
  }

  if (!request) {
    return <LoadingScreen />
  }

  return (
    <Center component="main" className="full-screen">
      <Card withBorder maw={400} w="100%" p="lg">
        <Stack gap="md">
          <Title order={2}>Connect {request.client} to Nest?</Title>
          <Text c="dimmed">
            {request.client} will be able to act as you in Nest: read your household&apos;s budget,
            buffer, savings goals and wishlist, and add wishlist items and deductions. You can
            disconnect it at any time.
          </Text>
          <Group grow>
            <Button
              variant="default"
              disabled={deciding}
              onClick={() => void decide(request, false)}
            >
              Deny
            </Button>
            <Button loading={deciding} onClick={() => void decide(request, true)}>
              Allow
            </Button>
          </Group>
        </Stack>
      </Card>
    </Center>
  )
}
