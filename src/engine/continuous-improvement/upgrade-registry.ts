/**
 * RARE-INTELLIGENCE — Continuous-Improvement & Capability Upgrade Registry
 * Manages model candidate discovery, rigorous benchmark evaluation, canary deployments,
 * known-good baseline preservation, and 1-click rollback.
 */

import { CapabilityUpgradeCandidate } from '../types.js';
import { logger } from '../security/logger.js';

export class CapabilityUpgradeRegistry {
  private candidates: CapabilityUpgradeCandidate[] = [];
  private activeVersion: string = 'v1.0.0-gemini-flash';
  private previousKnownGoodVersion: string = 'v0.9.0-diagnostic-baseline';

  constructor() {
    this.seedRegistry();
  }

  private seedRegistry() {
    this.candidates = [
      {
        version: 'v0.9.0-diagnostic-baseline',
        modelIdentifier: 'rare-diagnostic-engine-v1',
        provider: 'diagnostic-mock',
        description: 'Baseline deterministic sandbox provider for test execution and offline environments.',
        license: 'MIT',
        freeTierVerified: true,
        benchmarkScore: 78,
        status: 'rolled_back',
        reasons: ['Preserved known-good baseline for offline operation and deterministic tests.'],
        evaluatedAt: Date.now() - 86400000,
        approvedBy: 'Rare-Erudite Architect',
      },
      {
        version: 'v1.0.0-gemini-flash',
        modelIdentifier: 'gemini-3.8-flash',
        provider: 'gemini',
        description: 'Current production provider with native tool use, zero-cost free tier, and 1M context.',
        license: 'Google AI Terms of Service (Free Tier)',
        freeTierVerified: true,
        benchmarkScore: 92,
        status: 'active',
        reasons: ['High reasoning speed', 'Zero subscription cost', 'Native function calling support'],
        evaluatedAt: Date.now() - 3600000,
        approvedBy: 'Rare-Erudite Architect',
      },
      {
        version: 'v1.1.0-local-ollama',
        modelIdentifier: 'llama3.2:1b',
        provider: 'ollama',
        description: 'Candidate for local offline execution on user hardware (requires Ollama running).',
        license: 'Llama 3.2 Community License (Free)',
        freeTierVerified: true,
        benchmarkScore: 81,
        status: 'candidate',
        reasons: ['Zero reliance on external APIs', 'Hardware-bound privacy', 'Zero cost'],
        evaluatedAt: Date.now() - 1800000,
      },
    ];
  }

  public getCandidates(): CapabilityUpgradeCandidate[] {
    return [...this.candidates];
  }

  public getActiveCandidate(): CapabilityUpgradeCandidate | undefined {
    return this.candidates.find((c) => c.status === 'active');
  }

  public proposeCandidate(
    candidate: Omit<CapabilityUpgradeCandidate, 'status' | 'evaluatedAt'>
  ): CapabilityUpgradeCandidate {
    const existing = this.candidates.find((c) => c.version === candidate.version);
    if (existing) {
      throw new Error(`Candidate with version "${candidate.version}" already exists.`);
    }

    const newCandidate: CapabilityUpgradeCandidate = {
      ...candidate,
      status: 'candidate',
      evaluatedAt: Date.now(),
    };

    this.candidates.push(newCandidate);
    logger.info('UpgradeRegistry', `New capability upgrade candidate registered: ${newCandidate.version}`);
    return newCandidate;
  }

  /**
   * Promotes candidate to canary_testing
   */
  public startCanaryTest(version: string): CapabilityUpgradeCandidate {
    const candidate = this.candidates.find((c) => c.version === version);
    if (!candidate) {
      throw new Error(`Candidate version "${version}" not found.`);
    }

    candidate.status = 'canary_testing';
    logger.info('UpgradeRegistry', `Candidate "${version}" entered canary testing.`);
    return candidate;
  }

  /**
   * Adopts an upgrade with human approval verification and records known-good baseline.
   */
  public adoptUpgrade(version: string, approvedBy: string): CapabilityUpgradeCandidate {
    if (!approvedBy || approvedBy.trim() === '') {
      throw new Error('Upgrade policy requires explicit human approval identifier.');
    }

    const candidate = this.candidates.find((c) => c.version === version);
    if (!candidate) {
      throw new Error(`Candidate version "${version}" not found.`);
    }

    if (!candidate.freeTierVerified) {
      throw new Error('Upgrade rejected: Candidate does not satisfy strict zero-budget policy.');
    }

    // Save previous active as rollback target
    const currentActive = this.getActiveCandidate();
    if (currentActive) {
      currentActive.status = 'candidate';
      this.previousKnownGoodVersion = currentActive.version;
    }

    candidate.status = 'active';
    candidate.approvedBy = approvedBy;
    this.activeVersion = candidate.version;

    logger.info('UpgradeRegistry', `Capability upgraded to "${version}" approved by "${approvedBy}". Previous: ${this.previousKnownGoodVersion}`);
    return candidate;
  }

  /**
   * 1-Click Rollback to previous known-good baseline
   */
  public rollback(reason: string): CapabilityUpgradeCandidate {
    const currentActive = this.getActiveCandidate();
    if (currentActive) {
      currentActive.status = 'rolled_back';
      currentActive.reasons.push(`Rolled back: ${reason}`);
    }

    const previous = this.candidates.find((c) => c.version === this.previousKnownGoodVersion);
    if (!previous) {
      throw new Error(`Rollback failed: Known-good version "${this.previousKnownGoodVersion}" not found.`);
    }

    previous.status = 'active';
    this.activeVersion = previous.version;

    logger.warn('UpgradeRegistry', `Engine rolled back to known-good version "${previous.version}". Reason: ${reason}`);
    return previous;
  }
}
