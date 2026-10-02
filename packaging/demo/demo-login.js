// Nur in der Demo enthalten (siehe Dockerfile.demo) - meldet Besucher über /demo-login.html automatisch
// mit dem öffentlichen Demo-Zugang an und leitet ins Studio weiter. Die Zugangsdaten müssen zu den
// Vorgaben in reset-demo.sh passen; sie sind ohnehin öffentlich (README.md) und nur in der Demo gültig.
(() => {
  const USER = 'demo';
  const PASSWORD = 'anmachacast-demo';
  // Direkt nach einem Reset existiert der Demo-Zugang für einige Sekunden noch nicht. Bewusst nur wenige
  // Versuche: der Server sperrt die Anmeldung nach fünf Fehlversuchen für 15 Minuten.
  const MAX_TRIES = 3;
  const RETRY_MS = 8000;

  const msg = document.getElementById('msg');
  const manual = document.getElementById('manual');
  const say = (/** @type {string} */ text) => {
    if (msg) msg.textContent = text;
  };

  async function login(/** @type {number} */ attempt) {
    let failure = 'Die Demo ist gerade nicht erreichbar.';
    try {
      const r = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER, password: PASSWORD }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.token) {
        // Das Studio übernimmt den Token aus dem Verbindungslink und entfernt ihn wieder aus der Adresse.
        location.replace(`/#token=${encodeURIComponent(d.token)}`);
        return;
      }
      if (r.status === 429) {
        say(d.message ?? 'Zu viele Anmeldeversuche – bitte später erneut versuchen.');
        if (manual) manual.hidden = false;
        return;
      }
      if (r.status === 401) failure = 'Die Demo wird gerade zurückgesetzt.';
    } catch {}
    if (attempt < MAX_TRIES) {
      say(`${failure} Neuer Versuch in wenigen Sekunden …`);
      setTimeout(() => login(attempt + 1), RETRY_MS);
      return;
    }
    say(`${failure} Bitte in einer Minute erneut versuchen.`);
    if (manual) manual.hidden = false;
  }

  login(1);
})();
