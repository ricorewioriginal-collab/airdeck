// LAN-Erkennung (docs/architecture/NETWORK.md): Clients fragen per UDP-Broadcast „ANMACHACAST?1“ auf Port 8751,
// laufende AnMaCha-Cast-Server antworten mit Name, Version, API-Version, HTTP-Port und ob der LAN-Zugriff an ist.
// Der Server antwortet auch, wenn die Oberfläche nur lokal freigegeben ist – dann kann der Client gezielt
// „LAN-Zugriff ist aus“ melden statt „Server nicht erreichbar“. Es wird nichts dauerhaft gesendet.
// Legacy-Kompatibilität (vor der Umbenennung von AirDeck zu AnMaCha Cast): der Responder beantwortet
// weiterhin auch die alte Anfrage „AIRDECK?1“ (mit der alten Antwort „AIRDECK!“, damit ältere, noch nicht
// aktualisierte Clients diesen Server noch finden), und discover() fragt vorsorglich mit beiden Varianten,
// damit auch ein noch nicht aktualisierter Server im Netz gefunden wird.

import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

export const DISCOVERY_PORT = 8751;
export const PROBE = 'ANMACHACAST?1';
export const PROBE_LEGACY = 'AIRDECK?1';
const REPLY = 'ANMACHACAST!';
const REPLY_LEGACY = 'AIRDECK!';

export interface DiscoveryInfo {
  /** Installations-ID (zum Zusammenfassen mehrerer Antworten desselben Servers) */
  id: string;
  name: string;
  host: string;
  version: string;
  api: string;
  port: number;
  /** HTTP im Netzwerk erreichbar (sonst nur auf dem PC selbst) */
  lan: boolean;
}

export interface Found extends DiscoveryInfo {
  address: string;
  url: string | null;
}

/** Antwortet auf Erkennungsanfragen. Liefert null, wenn der Port belegt ist (z. B. zweite Instanz). */
export function startResponder(info: () => DiscoveryInfo, opts: { port?: number; log?: (msg: string) => void } = {}): Promise<{ close(): void } | null> {
  return new Promise((resolve) => {
    const sock = createSocket({ type: 'udp4', reuseAddr: true });
    let window = Date.now();
    let count = 0;
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('latin1');
      const legacy = text === PROBE_LEGACY;
      if (!legacy && text !== PROBE) return;
      // gegen Missbrauch als Verstärker: höchstens 50 Antworten pro Sekunde
      const now = Date.now();
      if (now - window > 1000) {
        window = now;
        count = 0;
      }
      if (++count > 50) return;
      sock.send(Buffer.from((legacy ? REPLY_LEGACY : REPLY) + JSON.stringify(info())), rinfo.port, rinfo.address);
    });
    sock.once('error', (err) => {
      opts.log?.(`LAN-Erkennung nicht verfügbar: ${err.message}`);
      sock.close();
      resolve(null);
    });
    sock.bind(opts.port ?? DISCOVERY_PORT, '0.0.0.0', () => {
      sock.removeAllListeners('error');
      sock.on('error', () => {});
      resolve({ close: () => sock.close() });
    });
  });
}

/** Broadcast-Adressen aller IPv4-Netze dieses Rechners (plus 255.255.255.255 und 127.0.0.1). */
export function broadcastAddresses(): string[] {
  const out = new Set(['255.255.255.255', '127.0.0.1']);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b & mask[i]!) | (~mask[i]! & 255)).join('.'));
    }
  }
  return [...out];
}

/** AnMaCha-Cast-Server im Netz suchen. */
export function discover(opts: { timeoutMs?: number; port?: number; targets?: string[] } = {}): Promise<Found[]> {
  const port = opts.port ?? DISCOVERY_PORT;
  return new Promise((resolve) => {
    const found = new Map<string, Found>();
    let sock: Socket;
    try {
      sock = createSocket('udp4');
    } catch {
      return resolve([]);
    }
    sock.on('error', () => {});
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8');
      const prefix = text.startsWith(REPLY) ? REPLY : text.startsWith(REPLY_LEGACY) ? REPLY_LEGACY : null;
      if (!prefix) return;
      try {
        const i = JSON.parse(text.slice(prefix.length)) as DiscoveryInfo;
        if (typeof i.id !== 'string' || typeof i.port !== 'number') return;
        const key = `${i.id}@${rinfo.address}`;
        found.set(key, { ...i, address: rinfo.address, url: i.lan || rinfo.address.startsWith('127.') ? `http://${rinfo.address}:${i.port}` : null });
      } catch {
        // fremde oder kaputte Antwort
      }
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      for (const t of opts.targets ?? broadcastAddresses()) {
        sock.send(PROBE, port, t, () => {});
        sock.send(PROBE_LEGACY, port, t, () => {});
      }
    });
    setTimeout(() => {
      sock.close();
      // derselbe Server über mehrere Wege: die LAN-Adresse vor 127.0.0.1 bevorzugen
      const byId = new Map<string, Found>();
      for (const f of found.values()) {
        const cur = byId.get(f.id);
        if (!cur || (cur.address.startsWith('127.') && !f.address.startsWith('127.'))) byId.set(f.id, f);
      }
      resolve([...byId.values()]);
    }, opts.timeoutMs ?? 1500).unref();
  });
}
