/**
 * RARE-INTELLIGENCE — Device-Aware Hardware & Model Resource Evaluator
 * Inspects host architecture, memory, disk storage limits, and evaluates local model
 * compatibility for both the current host and the future mobile target (RARE-THE-SIXTH).
 */

import os from 'os';
import fs from 'fs';
import { HardwareResourceSummary, ModelCompatibilityAssessment } from '../types.js';

export interface TargetDeviceProfile {
  name: string;
  targetType: 'cloud_preview' | 'desktop' | 'mobile_android';
  maxRamMB: number;
  availableRamAllowanceMB: number;
  maxDiskMB: number;
  maxParamSize: string;
  recommendedQuantization: string;
  notes: string;
}

export class DeviceHardwareEvaluator {
  private static readonly runtimeReserveMB = 512;
  private static targetProfileOverride: 'host' | 'mobile_android' | null = null;

  public static setTargetProfileOverride(profile: 'host' | 'mobile_android' | null): void {
    this.targetProfileOverride = profile;
  }

  public static getTargetProfileOverride(): 'host' | 'mobile_android' | null {
    return this.targetProfileOverride;
  }

  public static inspectHostResources(): HardwareResourceSummary {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const totalMemMB = Math.round(totalMemBytes / (1024 * 1024));
    const freeMemMB = Math.round(freeMemBytes / (1024 * 1024));
    const cpuCount = os.cpus().length;
    const platform = os.platform();
    const arch = os.arch();

    // Inspect real disk space using statfsSync
    let freeDiskMB = 0;
    let totalDiskMB = 0;
    try {
      if (typeof fs.statfsSync === 'function') {
        const stats = fs.statfsSync(process.cwd());
        const blockSize = stats.bsize || 4096;
        freeDiskMB = Math.round(((stats.bavail || 0) * blockSize) / (1024 * 1024));
        totalDiskMB = Math.round(((stats.blocks || 0) * blockSize) / (1024 * 1024));
      }
    } catch {
      freeDiskMB = 5000;
      totalDiskMB = 20000;
    }

    // Determine target execution category
    const isCloudContainer =
      process.env.K_SERVICE !== undefined ||
      process.env.CONTAINER_SANDBOX !== undefined ||
      process.env.CODESPACES !== undefined ||
      process.env.NODE_ENV === 'production' && !process.env.DESKTOP_ENV;

    const deviceTarget = this.targetProfileOverride === 'mobile_android'
      ? 'mobile_android'
      : isCloudContainer
      ? 'cloud_preview'
      : platform === 'android'
      ? 'mobile_android'
      : 'desktop';

    const storageDurability: 'persistent_filesystem' | 'ephemeral_sandbox' = isCloudContainer
      ? 'ephemeral_sandbox'
      : 'persistent_filesystem';

    let recommendedMaxModelParam = '1B';
    if (deviceTarget === 'mobile_android') {
      recommendedMaxModelParam = '1B (4-bit quantized)';
    } else if (totalMemMB >= 16000) {
      recommendedMaxModelParam = '7B - 8B (Q4/Q5)';
    } else if (totalMemMB >= 8000) {
      recommendedMaxModelParam = '3B (Q4)';
    } else if (totalMemMB >= 4000) {
      recommendedMaxModelParam = '1B - 1.5B (Q4)';
    } else {
      recommendedMaxModelParam = '0.5B (Quantized)';
    }

    const notes = deviceTarget === 'mobile_android'
      ? 'Target Profile: Android Mobile. Constrained to 4GB system RAM, thermal dissipation limits, and battery conservation.'
      : isCloudContainer
      ? 'Cloud Preview Environment: Storage is ephemeral across redeployments. Cloud host specs must not be equated with end-user mobile hardware.'
      : `Host workstation verified (${arch} ${platform}) with ${totalMemMB}MB RAM and ${freeDiskMB}MB free disk.`;

    return {
      platform,
      arch,
      totalMemMB,
      freeMemMB,
      cpuCount,
      freeDiskMB,
      totalDiskMB,
      storageDurability,
      recommendedMaxModelParam,
      deviceTarget,
      notes,
    };
  }

  public static getTargetDeviceProfiles(): Record<string, TargetDeviceProfile> {
    return {
      host: {
        name: 'Current Host Runtime',
        targetType: 'desktop',
        maxRamMB: Math.round(os.totalmem() / (1024 * 1024)),
        availableRamAllowanceMB: Math.round(os.freemem() / (1024 * 1024)),
        maxDiskMB: 20000,
        maxParamSize: '3B - 7B',
        recommendedQuantization: 'Q4_K_M',
        notes: 'Actual development/workstation environment specifications.',
      },
      target_android_phone: {
        name: 'Target Android Phone (RARE-THE-SIXTH)',
        targetType: 'mobile_android',
        maxRamMB: 4096,
        availableRamAllowanceMB: 1600,
        maxDiskMB: 4000,
        maxParamSize: '1.2B',
        recommendedQuantization: 'Q4_0 / INT4',
        notes: 'Target edge hardware: Mid-tier Android smartphone with strict memory and thermal caps.',
      },
    };
  }

  public static getKnownModelCatalog(): ModelCompatibilityAssessment[] {
    const host = this.inspectHostResources();
    const fitsHost = (estimatedRamMB: number, estimatedDiskMB: number): boolean =>
      host.freeMemMB >= estimatedRamMB + this.runtimeReserveMB &&
      host.freeDiskMB >= estimatedDiskMB + 500;

    return [
      {
        modelName: 'llama3.2:1b',
        paramSize: '1.2B',
        estimatedRamMB: 1450,
        estimatedDiskMB: 1300,
        contextWindowLimit: 8192,
        quantization: 'Q4_K_M',
        isCompatibleWithHost: fitsHost(1450, 1300),
        isCompatibleWithTargetPhone: true, // Suitable for Android devices with >= 4GB RAM
        readinessStatus: 'requires_download',
        recommendationNotes:
          `Estimated ${1450 + this.runtimeReserveMB}MB available RAM and 1800MB disk required including safety margins. ${fitsHost(1450, 1300) ? 'Current host meets' : 'Current host does not meet'} this estimate.`,
      },
      {
        modelName: 'qwen2.5-coder:0.5b',
        paramSize: '0.5B',
        estimatedRamMB: 750,
        estimatedDiskMB: 600,
        contextWindowLimit: 4096,
        quantization: 'Q4_K_M',
        isCompatibleWithHost: fitsHost(750, 600),
        isCompatibleWithTargetPhone: true,
        readinessStatus: 'requires_download',
        recommendationNotes:
          `Estimated ${750 + this.runtimeReserveMB}MB available RAM and 1100MB disk required including safety margins. ${fitsHost(750, 600) ? 'Current host meets' : 'Current host does not meet'} this estimate.`,
      },
      {
        modelName: 'llama3.2:3b',
        paramSize: '3.2B',
        estimatedRamMB: 3600,
        estimatedDiskMB: 2200,
        contextWindowLimit: 8192,
        quantization: 'Q4_K_M',
        isCompatibleWithHost: fitsHost(3600, 2200),
        isCompatibleWithTargetPhone: false, // Exceeds 1.6GB mobile free RAM ceiling
        readinessStatus: 'requires_download',
        recommendationNotes:
          `Estimated ${3600 + this.runtimeReserveMB}MB available RAM and 2700MB disk required including safety margins. ${fitsHost(3600, 2200) ? 'Current host meets' : 'Current host does not meet'} this estimate.`,
      },
      {
        modelName: 'rare-diagnostic-engine-v1',
        paramSize: 'Deterministic Logic Engine',
        estimatedRamMB: 8,
        estimatedDiskMB: 0,
        contextWindowLimit: 16384,
        quantization: 'Zero-Weight In-Process',
        isCompatibleWithHost: true,
        isCompatibleWithTargetPhone: true,
        readinessStatus: 'ready_installed',
        recommendationNotes:
          'In-process deterministic offline diagnostic sandbox. Bundled directly with RARE-INTELLIGENCE, 100% available without external downloads.',
      },
    ];
  }

  public static assessModel(modelIdentifier: string): ModelCompatibilityAssessment {
    const catalog = this.getKnownModelCatalog();
    const found = catalog.find((m) =>
      m.modelName.toLowerCase().startsWith(modelIdentifier.toLowerCase())
    );

    if (found) {
      return found;
    }

    const host = this.inspectHostResources();
    return {
      modelName: modelIdentifier,
      paramSize: 'Custom / Uncataloged',
      estimatedRamMB: 2500,
      estimatedDiskMB: 2000,
      contextWindowLimit: 4096,
      quantization: 'Unknown',
      isCompatibleWithHost:
        host.freeMemMB >= 2500 + this.runtimeReserveMB && host.freeDiskMB >= 2500 + 500,
      isCompatibleWithTargetPhone: false,
      readinessStatus: 'requires_download',
      recommendationNotes:
        `Uncataloged models use a conservative 2500MB RAM and 2000MB disk estimate; ${this.runtimeReserveMB}MB RAM and 500MB disk safety margins are added. Current host ${host.freeMemMB}MB free RAM and ${host.freeDiskMB}MB free disk.`,
    };
  }
}
