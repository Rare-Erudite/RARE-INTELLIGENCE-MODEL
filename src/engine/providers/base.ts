/**
 * RARE-INTELLIGENCE — Model Provider Abstraction
 * Enforces swappable provider interface, truthful labels, and telemetry.
 */

import {
  ModelGenerationConfig,
  ModelGenerationResult,
  ModelMessage,
  ModelProviderInfo,
  ModelProviderType,
} from '../types.js';

export interface IModelProvider {
  readonly id: ModelProviderType;
  readonly name: string;
  readonly modelIdentifier: string;

  /**
   * Health and connectivity check. Must return truthful status.
   */
  checkAvailability(forceLiveProbe?: boolean): Promise<ModelProviderInfo>;

  /**
   * Generate content from prompt or message sequence.
   */
  generate(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig
  ): Promise<ModelGenerationResult>;

  /**
   * Streaming generation if supported by provider.
   */
  generateStream?(
    prompt: string | ModelMessage[],
    config?: ModelGenerationConfig,
    onChunk?: (chunk: string) => void
  ): Promise<ModelGenerationResult>;
}
