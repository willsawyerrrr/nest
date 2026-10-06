import { isNativeShell } from './nativeShell'

/**
 * Opens a document behind a signed URL that has to be fetched first.
 *
 * Browsers allow a new tab only while the tap that asked for it is still
 * "active", and fetching the URL spends that, so `window.open` after the fetch
 * is blocked on iOS (Safari and the installed PWA). A blank tab is therefore
 * opened straight away and pointed at the URL once it arrives; it is closed
 * again when there is no URL. If the browser refuses the tab anyway, the
 * document opens in the current one.
 *
 * `WKWebView` ignores `window.open`, so in the native shell the URL is handed
 * to the native app through the `nestOpen` message handler, which opens it in
 * the system browser.
 */
export async function openSignedUrl(resolve: () => Promise<string | null>): Promise<void> {
  if (isNativeShell()) {
    const url = await resolve()
    if (url) {
      // The native user script registers the handler whenever the flag is set;
      // the `?.` only guards the impossible case of the flag without `webkit`.
      window.webkit?.messageHandlers.nestOpen.postMessage({ url })
    }
    return
  }

  const tab = window.open('', '_blank')
  if (tab) {
    tab.opener = null
  }
  const url = await resolve()
  if (!url) {
    tab?.close()
  } else if (tab) {
    tab.location.href = url
  } else {
    window.location.assign(url)
  }
}
