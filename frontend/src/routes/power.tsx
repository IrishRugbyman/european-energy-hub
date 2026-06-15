import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/power')({
  beforeLoad: () => { throw redirect({ to: '/map', search: { date: undefined } }) },
  component: () => null,
})
