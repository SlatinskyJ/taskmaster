import { createServerFn } from '@tanstack/react-start'
import { devPagesAllowed } from './devPages'

// Server functions screens may import (see the ESLint rule for src/routes). Public on purpose:
// listed in PUBLIC_SERVER_FNS (~/server/auth/guards).

export const getDevPagesAllowed = createServerFn({ method: 'GET' }).handler(() =>
  devPagesAllowed(process.env),
)
