// Reihenfolge der Netzwerkadressen, die Handys für die Kopplung angeboten bekommen: echte WLAN-/LAN-Adressen zuerst,
// virtuelle Adapter (VPN, Docker, Hyper-V, WSL …) und Link-Local-Adressen zuletzt. Auf Rechnern mit mehreren Adaptern
// ist sonst die erste aufgezählte Adresse oft von einem Handy aus nicht erreichbar.

export interface LanEntry {
  name: string;
  address: string;
}

const VIRTUAL_NAME = /(vethernet|hyper-?v|docker|vbox|virtualbox|vmware|vmnet|vnic|wsl|tailscale|zerotier|hamachi|vpn|wireguard|\bwg\d|\btun\d|\btap\d|utun|br-|virbr|veth|loopback|bluetooth)/i;

function classScore(address: string): number {
  if (address.startsWith('169.254.')) return 50; // Link-Local (kein DHCP)
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  const m = /^172\.(\d+)\./.exec(address);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 2;
  return 3;
}

/** Sortiert stabil: wahrscheinlich erreichbare Adressen zuerst. */
export function rankLanAddresses(entries: LanEntry[]): LanEntry[] {
  return entries
    .map((e, i) => ({ e, i, score: classScore(e.address) + (VIRTUAL_NAME.test(e.name) ? 100 : 0) }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((x) => x.e);
}
