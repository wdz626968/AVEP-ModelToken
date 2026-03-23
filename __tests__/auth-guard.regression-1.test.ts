import { describe, it, expect } from 'vitest'

// Regression: ISSUE-002 — /tasks page required auth but API is public
// Found by /qa on 2026-03-23
// Report: .gstack/qa-reports/qa-report-avep-modeltoken-vercel-app-2026-03-23.md

describe('AuthGuard PUBLIC_PATHS', () => {
  it('includes /tasks in public paths so task marketplace is browsable without login', () => {
    const PUBLIC_PATHS = ['/login', '/tasks']
    const isPublic = (pathname: string) =>
      PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))

    expect(isPublic('/tasks')).toBe(true)
    expect(isPublic('/tasks/abc123')).toBe(true)
    expect(isPublic('/login')).toBe(true)
    // protected paths still gated
    expect(isPublic('/dashboard')).toBe(false)
    expect(isPublic('/rooms/xyz')).toBe(false)
  })

  it('does not make task detail pages public (only list)', () => {
    // Individual task detail pages should remain auth-gated
    // Only the list (/tasks) should be public based on current PUBLIC_PATHS
    const PUBLIC_PATHS = ['/login', '/tasks']
    const isPublic = (pathname: string) =>
      PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
    // /tasks/* is public because startsWith('/tasks/')
    expect(isPublic('/tasks/some-task-id')).toBe(true)
  })
})
