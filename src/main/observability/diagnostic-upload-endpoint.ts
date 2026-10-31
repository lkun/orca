export function resolveDiagnosticBuildTokenEndpoint(): string | null {
  const endpoint =
    typeof OCC_DIAGNOSTICS_TOKEN_URL !== 'undefined'
      ? OCC_DIAGNOSTICS_TOKEN_URL
      : ((globalThis as { OCC_DIAGNOSTICS_TOKEN_URL?: string | null })
          .OCC_DIAGNOSTICS_TOKEN_URL ?? null)
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null
}

export function resolveDiagnosticBuildIdentity(): 'stable' | 'rc' | null {
  const ident =
    typeof OCC_BUILD_IDENTITY !== 'undefined'
      ? OCC_BUILD_IDENTITY
      : ((globalThis as { OCC_BUILD_IDENTITY?: 'stable' | 'rc' | null }).OCC_BUILD_IDENTITY ??
        null)
  return ident === 'stable' || ident === 'rc' ? ident : null
}

export function resolveDiagnosticTokenEndpoint(): string | null {
  const buildEndpoint = resolveDiagnosticBuildTokenEndpoint()
  // Pin official builds to the support endpoint named by the UI, regardless of user environment.
  if (resolveDiagnosticBuildIdentity()) {
    return buildEndpoint
  }
  const fromEnv = process.env.OCC_DIAGNOSTICS_TOKEN_URL
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return buildEndpoint
}

export function resolveDiagnosticOCCChannel(): 'stable' | 'rc' | 'dev' {
  const ident = resolveDiagnosticBuildIdentity()
  if (ident === 'stable' || ident === 'rc') {
    return ident
  }
  return 'dev'
}
