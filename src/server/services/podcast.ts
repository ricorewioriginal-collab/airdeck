// Eigener Podcast-Feed aus den eigenen Mitschnitten: Episoden-Verwaltung + RSS-2.0/iTunes-Feed,
// kein externer Dienst (Castopod o. ä.) nötig. Episoden verweisen auf bestehende Recordings
// (src/server/services/recorder.ts) - die Aufnahme-Infrastruktur bleibt unverändert.

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnMaChaCastApp } from '../app.ts';
import { AppError, newId, type Episode, type PodcastConfig } from '../model.ts';

const xmlEsc = (s: unknown) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const COVER_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export class PodcastService {
  private readonly app: AnMaChaCastApp;

  constructor(app: AnMaChaCastApp) {
    this.app = app;
  }

  config(stationId: string): PodcastConfig {
    const rt = this.app.rt(stationId);
    return rt.data.podcast ?? {
      title: rt.station.name, description: rt.station.slogan || rt.station.name, author: rt.station.name, language: 'de-de', explicit: false,
    };
  }

  saveConfig(stationId: string, input: Record<string, unknown>): PodcastConfig {
    const rt = this.app.rt(stationId);
    const cur = this.config(stationId);
    const cfg: PodcastConfig = {
      title: String(input.title ?? cur.title).slice(0, 120) || rt.station.name,
      description: String(input.description ?? cur.description).slice(0, 4000),
      author: String(input.author ?? cur.author).slice(0, 120),
      language: String(input.language ?? cur.language).slice(0, 10) || 'de-de',
      category: typeof input.category === 'string' ? input.category.slice(0, 80) || undefined : cur.category,
      explicit: Boolean(input.explicit ?? cur.explicit),
      cover: cur.cover,
    };
    rt.data.podcast = cfg;
    this.app.publish('podcast.changed', stationId, this.overview(stationId));
    this.app.changed();
    return cfg;
  }

  /** Eigenes Podcast-Cover speichern (PNG/JPG/WebP, max. 5 MB), wie Station.logo. */
  setCover(stationId: string, contentType: string, data: Buffer): PodcastConfig {
    const ext = COVER_TYPES[contentType.split(';')[0]!.trim().toLowerCase()];
    if (!ext) throw new AppError(415, 'unsupported_media', 'Cover als PNG, JPG oder WebP hochladen');
    if (data.length > 5 * 1024 * 1024) throw new AppError(413, 'too_large', 'Cover höchstens 5 MB');
    const sig = data.subarray(0, 12);
    const ok = { png: sig[0] === 0x89 && sig[1] === 0x50, jpg: sig[0] === 0xff && sig[1] === 0xd8, webp: sig.toString('latin1', 8, 12) === 'WEBP' }[ext];
    if (!ok) throw new AppError(415, 'unsupported_media', 'Datei ist kein gültiges Bild');
    const dir = join(this.app.dataDir, 'podcast-covers');
    mkdirSync(dir, { recursive: true });
    this.removeCoverFile(stationId);
    writeFileSync(join(dir, `${stationId}.${ext}`), data);
    const cfg = this.config(stationId);
    cfg.cover = `${ext}:${Date.now().toString(36)}`;
    this.app.rt(stationId).data.podcast = cfg;
    this.app.changed();
    return cfg;
  }

  removeCoverFile(stationId: string): void {
    for (const ext of Object.values(COVER_TYPES)) rmSync(join(this.app.dataDir, 'podcast-covers', `${stationId}.${ext}`), { force: true });
  }

  cover(stationId: string): { path: string; type: string } | null {
    const cfg = this.app.stations.get(stationId)?.data.podcast;
    if (!cfg?.cover) return null;
    const ext = cfg.cover.split(':')[0]!;
    const type = Object.entries(COVER_TYPES).find(([, e]) => e === ext)?.[0];
    const path = join(this.app.dataDir, 'podcast-covers', `${stationId}.${ext}`);
    return type && existsSync(path) ? { path, type } : null;
  }

  episodes(stationId: string): Episode[] {
    return [...(this.app.rt(stationId).data.episodes ?? [])].sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt));
  }

  overview(stationId: string): { config: PodcastConfig; episodes: Episode[]; hasCover: boolean } {
    return { config: this.config(stationId), episodes: this.episodes(stationId), hasCover: !!this.cover(stationId) };
  }

  /** Episode aus einem bestehenden Mitschnitt anlegen (Entwurf, noch nicht im Feed). */
  createEpisode(stationId: string, recordingId: string, input: Record<string, unknown> = {}): Episode {
    const rt = this.app.rt(stationId);
    const rec = rt.data.recordings?.find((r) => r.id === recordingId);
    if (!rec) throw new AppError(404, 'not_found', 'Mitschnitt nicht gefunden');
    if (!rec.endedAt) throw new AppError(409, 'still_recording', 'Mitschnitt läuft noch');
    const ep: Episode = {
      id: newId('ep'), recordingId, guid: newId('ep'),
      title: String(input.title ?? rec.label).slice(0, 200),
      description: String(input.description ?? '').slice(0, 4000),
      createdAt: Date.now(),
    };
    (rt.data.episodes ??= []).push(ep);
    this.app.publish('podcast.changed', stationId, this.overview(stationId));
    this.app.changed();
    return ep;
  }

  updateEpisode(stationId: string, id: string, input: Record<string, unknown>): Episode {
    const rt = this.app.rt(stationId);
    const ep = rt.data.episodes?.find((e) => e.id === id);
    if (!ep) throw new AppError(404, 'not_found', 'Episode nicht gefunden');
    if (typeof input.title === 'string' && input.title.trim()) ep.title = input.title.trim().slice(0, 200);
    if (typeof input.description === 'string') ep.description = input.description.slice(0, 4000);
    if (input.season === null) delete ep.season; else if (typeof input.season === 'number' && Number.isFinite(input.season)) ep.season = Math.max(1, Math.round(input.season));
    if (input.episodeNumber === null) delete ep.episodeNumber; else if (typeof input.episodeNumber === 'number' && Number.isFinite(input.episodeNumber)) ep.episodeNumber = Math.max(1, Math.round(input.episodeNumber));
    if (input.published === true && !ep.publishedAt) ep.publishedAt = Date.now();
    else if (input.published === false) ep.publishedAt = undefined;
    this.app.publish('podcast.changed', stationId, this.overview(stationId));
    this.app.changed();
    return ep;
  }

  deleteEpisode(stationId: string, id: string): void {
    const rt = this.app.rt(stationId);
    rt.data.episodes = (rt.data.episodes ?? []).filter((e) => e.id !== id);
    this.app.publish('podcast.changed', stationId, this.overview(stationId));
    this.app.changed();
  }

  /** RSS 2.0 mit iTunes-Namensraum - direkt bei Apple Podcasts/Spotify/Pocket Casts einreichbar. */
  feedXml(stationId: string, baseUrl: string): string {
    const rt = this.app.stations.get(stationId);
    if (!rt || rt.station.publicStatus === false) throw new AppError(404, 'not_found', 'Sender nicht gefunden oder nicht öffentlich');
    const cfg = this.config(stationId);
    const published = (rt.data.episodes ?? []).filter((e) => e.publishedAt).sort((a, b) => b.publishedAt! - a.publishedAt!);
    const feedUrl = `${baseUrl}/api/v1/public/stations/${stationId}/podcast.xml`;
    const coverUrl = this.cover(stationId) ? `${baseUrl}/api/v1/public/stations/${stationId}/podcast/cover` : undefined;
    const items = published.map((ep) => {
      const rec = rt.data.recordings?.find((r) => r.id === ep.recordingId);
      if (!rec) return '';
      const audioUrl = `${baseUrl}/api/v1/public/stations/${stationId}/podcast/episodes/${ep.id}/audio`;
      return [
        '  <item>',
        `    <title>${xmlEsc(ep.title)}</title>`,
        ep.description ? `    <description><![CDATA[${ep.description}]]></description>` : '',
        `    <guid isPermaLink="false">${xmlEsc(ep.guid)}</guid>`,
        `    <pubDate>${new Date(ep.publishedAt!).toUTCString()}</pubDate>`,
        `    <enclosure url="${xmlEsc(audioUrl)}" length="${rec.bytes}" type="${xmlEsc(rec.contentType || 'audio/mpeg')}"/>`,
        ep.season ? `    <itunes:season>${ep.season}</itunes:season>` : '',
        ep.episodeNumber ? `    <itunes:episode>${ep.episodeNumber}</itunes:episode>` : '',
        `    <itunes:explicit>${cfg.explicit ? 'true' : 'false'}</itunes:explicit>`,
        '  </item>',
      ].filter(Boolean).join('\n');
    }).join('\n');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
      '<channel>',
      `  <title>${xmlEsc(cfg.title)}</title>`,
      `  <link>${xmlEsc(baseUrl)}</link>`,
      `  <description><![CDATA[${cfg.description}]]></description>`,
      `  <language>${xmlEsc(cfg.language)}</language>`,
      `  <itunes:author>${xmlEsc(cfg.author)}</itunes:author>`,
      `  <itunes:explicit>${cfg.explicit ? 'true' : 'false'}</itunes:explicit>`,
      cfg.category ? `  <itunes:category text="${xmlEsc(cfg.category)}"/>` : '',
      coverUrl ? `  <itunes:image href="${xmlEsc(coverUrl)}"/>` : '',
      coverUrl ? `  <image><url>${xmlEsc(coverUrl)}</url><title>${xmlEsc(cfg.title)}</title><link>${xmlEsc(baseUrl)}</link></image>` : '',
      `  <atom:link href="${xmlEsc(feedUrl)}" rel="self" type="application/rss+xml" xmlns:atom="http://www.w3.org/2005/Atom"/>`,
      items,
      '</channel>',
      '</rss>',
    ].filter(Boolean).join('\n') + '\n';
  }
}
