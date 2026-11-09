import { defineConfig } from 'vitest/config'

// Unit tests (pure logic) and integration tests (real git in temporary repos). The end-to-end tests that drive
// the built app live in e2e/ and run with Playwright.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests shell out to git, which is slow on Windows runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/shared/deploy.ts',
        'src/shared/defaults.ts',
        'src/shared/templates.ts',
        'src/main/gitTools.ts',
        'src/main/git.ts',
        'src/main/scan.ts',
        'src/main/deployments.ts',
        'src/main/security.ts',
        'src/shared/security.ts',
        'src/shared/cihealth.ts',
        'src/shared/accounts.ts',
        'src/shared/cleanup.ts',
        'src/main/cleanup.ts',
        'src/shared/mergeStatus.ts',
        'src/main/mergeStatus.ts',
        'src/main/actionsAdmin.ts',
        'src/shared/actionsAdmin.ts',
        'src/renderer/src/lib/graph.ts',
        'src/renderer/src/lib/filters.ts'
      ],
      reporter: ['text', 'html'],
      // Fail the run if coverage of the tested modules drops.
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 }
    }
  }
})
