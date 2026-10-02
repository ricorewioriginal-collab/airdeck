// Dienstmodule (ARCHITECTURE §1: stations, media, playout, planning, outputs, integrations, auth, system).
// Der Sendekern (Sender, Quellen, Relay, Ausgänge, Queue, Playout) liegt in app.ts und wird in Schritt 4
// mit Audio-Engine und Mode-Manager neu gebaut; alles Übrige liegt hier.

import type { AirDeckApp } from '../app.ts';
import { AiToolsService } from './ai.ts';
import { AuthService } from './auth.ts';
import { BackupService } from './backup.ts';
import { RemoteLinkService } from './remote-link.ts';
import { BridgeService } from './bridges.ts';
import { DeviceService } from './devices.ts';
import { LautfmService } from './lautfm.ts';
import { LifehacksService } from './lifehacks.ts';
import { ListenerService } from './listeners.ts';
import { MediaService } from './media.ts';
import { MotionMixService } from './motionmix.ts';
import { MusicHubService } from './musikhub.ts';
import { NewsService } from './news.ts';
import { NextcloudService } from './nextcloud.ts';
import { NotificationService } from './notifications.ts';
import { PlanningService } from './planning.ts';
import { PodcastService } from './podcast.ts';
import { RecapService } from './recap.ts';
import { RecorderService } from './recorder.ts';
import { SetupService } from './setup.ts';
import { StationService } from './stations.ts';
import { StatsService } from './stats.ts';
import { StatusService } from './status.ts';
import { SystemService } from './system.ts';

export function createServices(app: AirDeckApp) {
  return {
    auth: new AuthService(app),
    devices: new DeviceService(app),
    stations: new StationService(app),
    media: new MediaService(app),
    musikhub: new MusicHubService(app),
    nextcloud: new NextcloudService(app),
    lautfm: new LautfmService(app),
    system: new SystemService(app),
    notifications: new NotificationService(app),
    bridges: new BridgeService(app),
    status: new StatusService(app),
    ai: new AiToolsService(app),
    recorder: new RecorderService(app),
    planning: new PlanningService(app),
    lifehacks: new LifehacksService(app),
    news: new NewsService(app),
    podcast: new PodcastService(app),
    recap: new RecapService(app),
    stats: new StatsService(app),
    motionMix: new MotionMixService(app),
    setup: new SetupService(app),
    listeners: new ListenerService(app),
    backup: new BackupService(app),
    remoteLink: new RemoteLinkService(app),
  };
}

export type Services = ReturnType<typeof createServices>;
