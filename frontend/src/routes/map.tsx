import { createFileRoute, redirect } from '@tanstack/react-router'

// /map is the documented unified-dashboard URL; the live implementation lives
// at /power (price + generation choropleth). Redirect so the documented link
// and any stale bookmarks resolve instead of 404-ing.
export const Route = createFileRoute('/map')({
  beforeLoad: () => {
    throw redirect({ to: '/power', search: { date: undefined } })
  },
})
