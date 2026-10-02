// Minimaler SMTP-Client (kein zusätzliches Paket): SMTPS (465) oder STARTTLS (587/25), AUTH LOGIN,
// reiner Text-Versand für Alarm-Mails. Bewusst klein gehalten - wie Webhook/Telegram in notify.ts.

import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { Socket } from 'node:net';

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implizites TLS ab Verbindungsaufbau (Port 465), sonst STARTTLS */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

/** Liest Antwortzeilen, bis die letzte Zeile eines Codes ("250 " statt "250-") kommt. */
function readReply(sock: Socket | TLSSocket, timeoutMs: number): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      sock.off('data', onData);
      reject(new Error('SMTP-Zeitüberschreitung'));
    }, timeoutMs);
    function onData(chunk: Buffer) {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        clearTimeout(timer);
        sock.off('data', onData);
        resolve({ code: Number(last.slice(0, 3)), text: lines.map((l) => l.slice(4)).join('\n') });
      }
    }
    sock.on('data', onData);
  });
}

function send(sock: Socket | TLSSocket, line: string): void {
  sock.write(line + '\r\n');
}

async function expect(sock: Socket | TLSSocket, max: number, timeoutMs: number): Promise<{ code: number; text: string }> {
  const r = await readReply(sock, timeoutMs);
  if (r.code >= max) throw new Error(`SMTP-Fehler ${r.code}: ${r.text}`);
  return r;
}

/** Sendet eine einfache Text-Mail über SMTP. Wirft bei jedem Fehler (Caller fängt ab). */
export async function sendMail(cfg: SmtpConfig, subject: string, body: string, timeoutMs = 10_000): Promise<void> {
  const sock: Socket | TLSSocket = cfg.secure
    ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : new Socket();
  await new Promise<void>((resolve, reject) => {
    const onErr = (e: Error) => reject(e);
    sock.once('error', onErr);
    if (cfg.secure) sock.once('secureConnect', () => { sock.off('error', onErr); resolve(); });
    else sock.connect(cfg.port, cfg.host, () => { sock.off('error', onErr); resolve(); });
  });
  try {
    await expect(sock, 400, timeoutMs); // Begrüßung
    send(sock, `EHLO anmachacast`);
    let ehlo = await expect(sock, 400, timeoutMs);
    let active: Socket | TLSSocket = sock;
    if (!cfg.secure) {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error('Server unterstützt kein STARTTLS');
      send(sock, 'STARTTLS');
      await expect(sock, 400, timeoutMs);
      active = tlsConnect({ socket: sock, servername: cfg.host });
      await new Promise<void>((resolve, reject) => {
        active.once('secureConnect', () => resolve());
        active.once('error', reject);
      });
      send(active, `EHLO anmachacast`);
      ehlo = await expect(active, 400, timeoutMs);
    }
    if (cfg.user) {
      send(active, 'AUTH LOGIN');
      await expect(active, 400, timeoutMs);
      send(active, b64(cfg.user));
      await expect(active, 400, timeoutMs);
      send(active, b64(cfg.pass));
      await expect(active, 400, timeoutMs);
    }
    send(active, `MAIL FROM:<${cfg.from}>`);
    await expect(active, 400, timeoutMs);
    send(active, `RCPT TO:<${cfg.to}>`);
    await expect(active, 400, timeoutMs);
    send(active, 'DATA');
    await expect(active, 400, timeoutMs);
    const headers = [
      `From: ${cfg.from}`,
      `To: ${cfg.to}`,
      `Subject: ${subject.replace(/[\r\n]/g, ' ')}`,
      `Date: ${new Date().toUTCString()}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
    ].join('\r\n');
    const dataBody = (headers + body).replace(/\r?\n\./g, '\r\n..'); // Dot-Stuffing
    send(active, dataBody);
    send(active, '.');
    await expect(active, 400, timeoutMs);
    send(active, 'QUIT');
  } finally {
    sock.destroy();
  }
}
