export function isDemoSeedEnabled(): boolean {
  const configured = process.env.ENABLE_DEMO_SEED?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;
  if (isDemoSeedEnabled()) {
    throw new Error('Production must set ENABLE_DEMO_SEED=false');
  }
  for (const name of ['AUTH_SECRET', 'AI_KEY_SECRET', 'AI_SERVICE_TOKEN']) {
    const value = process.env[name]?.trim() ?? '';
    if (value.length < 32 || value.startsWith('dev-')) {
      throw new Error(`Production requires a unique ${name} of at least 32 characters`);
    }
  }
  const secrets = ['AUTH_SECRET', 'AI_KEY_SECRET', 'AI_SERVICE_TOKEN'].map(
    (name) => process.env[name]?.trim(),
  );
  if (new Set(secrets).size !== secrets.length) {
    throw new Error(
      'Production AUTH_SECRET, AI_KEY_SECRET and AI_SERVICE_TOKEN must be different values',
    );
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('Production requires DATABASE_URL');
  if (!process.env.REDIS_URL?.trim()) {
    throw new Error('Production requires REDIS_URL');
  }
  let databasePassword = '';
  try {
    databasePassword = decodeURIComponent(new URL(databaseUrl).password);
  } catch {
    throw new Error('Production DATABASE_URL is invalid');
  }
  if (['aikefu', 'password', 'postgres'].includes(databasePassword.toLowerCase())) {
    throw new Error('Production DATABASE_URL must not use a sample/default password');
  }
}
