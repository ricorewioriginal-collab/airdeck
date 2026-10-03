import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankLanAddresses } from '../src/server/lan-address.ts';

test('echte LAN-Adresse steht vor virtuellen Adaptern und Link-Local', () => {
  const out = rankLanAddresses([
    { name: 'vEthernet (WSL)', address: '172.28.16.1' },
    { name: 'VirtualBox Host-Only Network', address: '192.168.56.1' },
    { name: 'Ethernet', address: '169.254.10.3' },
    { name: 'WLAN', address: '192.168.1.20' },
    { name: 'docker0', address: '172.17.0.1' },
  ]);
  assert.deepEqual(out.map((e) => e.address), ['192.168.1.20', '169.254.10.3', '192.168.56.1', '172.28.16.1', '172.17.0.1']);
});

test('Reihenfolge bleibt bei gleichem Rang stabil, 192.168 vor 10. vor 172.16', () => {
  const out = rankLanAddresses([
    { name: 'eth1', address: '172.20.0.5' },
    { name: 'eth0', address: '10.0.0.7' },
    { name: 'eth2', address: '192.168.0.9' },
    { name: 'eth3', address: '192.168.0.10' },
  ]);
  assert.deepEqual(out.map((e) => e.address), ['192.168.0.9', '192.168.0.10', '10.0.0.7', '172.20.0.5']);
});

test('leere Liste', () => {
  assert.deepEqual(rankLanAddresses([]), []);
});
