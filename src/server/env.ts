// Umgebungsvariablen von AnMaCha Cast: alle heißen ANMACHA_CAST_<NAME>.

/**
 * Liest `ANMACHA_CAST_<suffix>`.
 * Beispiel: envVar(process.env, 'PORT') liest ANMACHA_CAST_PORT.
 */
export function envVar(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  return env[`ANMACHA_CAST_${suffix}`];
}
