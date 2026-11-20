const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID

type Gtag = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: Gtag
  }
}

let initialized = false

export function initializeAnalytics() {
  if (!measurementId || initialized) return

  window.dataLayer = window.dataLayer ?? []
  // gtag.js only processes `arguments` objects from the dataLayer; a plain array
  // (e.g. from rest params) is silently ignored and no hits are sent.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments)
  }

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`
  document.head.appendChild(script)

  window.gtag('js', new Date())
  window.gtag('config', measurementId, { send_page_view: false })
  initialized = true
}

export function trackPageView(path: string) {
  if (!initialized) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  })
}
