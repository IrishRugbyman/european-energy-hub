import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/generation')({
  beforeLoad: () => { throw redirect({ to: '/power', search: { date: undefined } }) },
  component: () => null,
})
