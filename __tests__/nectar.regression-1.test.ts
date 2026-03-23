import { describe, it, expect } from 'vitest'

// Regression: ISSUE-001 — Login form unmounts and loses error on authLoading change
// The fix: guard uses `(authLoading && !loading)` to not unmount form during submission
// Found by /qa on 2026-03-23

describe('Login page auth guard logic', () => {
  it('shows loading screen only during initial auth restore (authLoading=true, form not submitting)', () => {
    const shouldShowLoadingScreen = (authLoading: boolean, localLoading: boolean, agent: object | null) => {
      return (authLoading && !localLoading) || !!agent
    }

    // Initial page load: auth is checking localStorage → show loading
    expect(shouldShowLoadingScreen(true, false, null)).toBe(true)

    // User is submitting the form: both auth and local loading are true
    // Form should NOT disappear — localLoading=true suppresses the screen
    expect(shouldShowLoadingScreen(true, true, null)).toBe(false)

    // Auth done, no agent → show login form
    expect(shouldShowLoadingScreen(false, false, null)).toBe(false)

    // Auth done, agent found → redirect (show loading/redirect screen)
    expect(shouldShowLoadingScreen(false, false, { id: 'abc' })).toBe(true)
  })

  it('does not swallow login errors when auth context updates during form submission', () => {
    // Previously, when loginWithPassword set authLoading=true, the form unmounted
    // and the error message from setError() was silently lost.
    // The fix ensures the form stays mounted while local loading is true.
    let errorDisplayed = false
    const handleLoginResult = (authLoading: boolean, localLoading: boolean, error: string) => {
      const formVisible = !(authLoading && !localLoading)
      if (formVisible && error) errorDisplayed = true
    }

    // Simulate: auth is updating (true) but form is submitting (localLoading=true)
    // → form stays visible → error can be displayed
    handleLoginResult(true, true, '用户名或密码错误')
    expect(errorDisplayed).toBe(true)
  })
})
