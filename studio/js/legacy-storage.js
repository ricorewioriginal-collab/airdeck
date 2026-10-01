// @ts-check
// Migration der LocalStorage-Schlüssel von airdeck.* zu anmacha_cast.* (docs/REBRANDING_ANMACHA_CAST.md).
// Gelesen wird zuerst der neue Schlüssel; ist er leer, wird der alte übernommen und in den neuen Schlüssel
// geschrieben. Der alte Schlüssel bleibt dabei bestehen (keine verlorenen Logins/Einstellungen bei einem
// Rollback); erst ein echtes Entfernen (z. B. Logout) räumt beide Schlüssel zugleich ab, damit ein gelöschter
// Wert nicht über den alten Schlüssel wieder auftaucht.

/** @param {string} key */
export function lsGet(key) {
  try {
    const v = localStorage.getItem(`anmacha_cast.${key}`);
    if (v !== null) return v;
    const legacy = localStorage.getItem(`airdeck.${key}`);
    if (legacy !== null) {
      try {
        localStorage.setItem(`anmacha_cast.${key}`, legacy);
      } catch {}
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

/** @param {string} key @param {string|null|undefined} value */
export function lsSet(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(`anmacha_cast.${key}`);
      localStorage.removeItem(`airdeck.${key}`);
    } else {
      localStorage.setItem(`anmacha_cast.${key}`, value);
    }
  } catch {}
}
