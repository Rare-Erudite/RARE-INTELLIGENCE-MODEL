/**
 * RARE-INTELLIGENCE — Network & Connectivity Transition Manager
 * Manages online/offline transition lifecycle, simulation mode for tests,
 * and event dispatching for pausing/resuming tasks.
 */

import { logger } from '../security/logger.js';

export type ConnectivityState = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'SIMULATED_OFFLINE';

export class NetworkTransitionManager {
  private currentState: ConnectivityState = 'UNKNOWN';
  private simulatedOffline = false;
  private lastCheckTime = 0;
  private listeners: Array<(state: ConnectivityState) => void> = new Array();

  constructor() {
    this.checkInitialState();
  }

  private async checkInitialState() {
    // Non-blocking initial timestamp; does not assume ONLINE without evidence
    this.lastCheckTime = Date.now();
  }

  public isOnline(): boolean {
    if (this.simulatedOffline) return false;
    return this.currentState === 'ONLINE';
  }

  public getState(): ConnectivityState {
    if (this.simulatedOffline) return 'SIMULATED_OFFLINE';
    return this.currentState;
  }

  public setExplicitState(state: ConnectivityState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      logger.info('NetworkTransitionManager', `Connection state explicitly transitioned to: ${state}`);
      this.notifyListeners(this.simulatedOffline ? 'SIMULATED_OFFLINE' : state);
    }
  }

  public setSimulatedOffline(enabled: boolean): void {
    this.simulatedOffline = enabled;
    logger.info(
      'NetworkTransitionManager',
      `Simulated offline mode ${enabled ? 'ENABLED' : 'DISABLED'}. Engine will behave as ${enabled ? '100% OFFLINE' : 'NORMAL'}.`
    );
    this.notifyListeners(enabled ? 'SIMULATED_OFFLINE' : this.currentState);
  }

  public isSimulatedOffline(): boolean {
    return this.simulatedOffline;
  }

  public onStateChange(listener: (state: ConnectivityState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(state: ConnectivityState) {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err: any) {
        logger.error('NetworkTransitionManager', `Error in listener: ${err.message}`);
      }
    }
  }

  /**
   * Lightweight non-blocking probe to verify external connectivity.
   */
  public async probeConnectivity(timeoutMs = 1200): Promise<boolean> {
    if (this.simulatedOffline) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      // Lightweight probe using standard Google public 204 endpoint or DNS probe
      const res = await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timer);

      const isNowOnline = res.status === 204 || res.ok;
      if (isNowOnline && this.currentState !== 'ONLINE') {
        this.currentState = 'ONLINE';
        logger.info('NetworkTransitionManager', 'External internet connectivity verified. Transitioned to ONLINE.');
        this.notifyListeners('ONLINE');
      }
      return isNowOnline;
    } catch {
      if (this.currentState !== 'OFFLINE') {
        this.currentState = 'OFFLINE';
        logger.warn('NetworkTransitionManager', 'No external internet reachability detected. Transitioned to OFFLINE.');
        this.notifyListeners('OFFLINE');
      }
      return false;
    }
  }
}

export const networkManager = new NetworkTransitionManager();
