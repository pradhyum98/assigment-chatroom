import { Capacitor } from '@capacitor/core';

export class CapacitorPlatformAdapter {
  static getPlatformName(): string {
    return Capacitor.getPlatform();
  }
}
