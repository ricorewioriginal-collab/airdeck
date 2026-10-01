// Zentrale Stelle für die Umbenennung AirDeck → AnMaCha Cast (docs/REBRANDING_ANMACHA_CAST.md):
// neue ANMACHA_CAST_*-Umgebungsvariablen haben Vorrang, die bisherigen AIRDECK_*-Variablen bleiben
// als Legacy-Fallback erhalten, damit bestehende Installationen ohne Anpassung weiterlaufen.
// Sobald die Legacy-Unterstützung entfällt, genügt es, diese Datei zu vereinfachen bzw. zu entfernen.

/**
 * Liest `ANMACHA_CAST_<suffix>`, fällt auf das bisherige `AIRDECK_<suffix>` zurück.
 * Beispiel: envVar(process.env, 'PORT') prüft zuerst ANMACHA_CAST_PORT, dann AIRDECK_PORT.
 */
export function envVar(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  return env[`ANMACHA_CAST_${suffix}`] ?? env[`AIRDECK_${suffix}`];
}
