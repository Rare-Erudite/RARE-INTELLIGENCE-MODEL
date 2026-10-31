import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceHardwareEvaluator } from './device-evaluator.js';
import { LocalModelManager } from './local-runtime.js';
import { LocalTransformersProvider } from './transformers-local.js';
import type { HardwareResourceSummary, LocalInstalledModel } from '../types.js';

const roomyHost: HardwareResourceSummary = {
  platform: 'win32',
  arch: 'x64',
  totalMemMB: 8192,
  freeMemMB: 4096,
  cpuCount: 4,
  freeDiskMB: 20000,
  totalDiskMB: 100000,
  storageDurability: 'persistent_filesystem',
  recommendedMaxModelParam: '1B',
  deviceTarget: 'desktop',
  notes: 'Deterministic test host',
};

function withHostResources(resources: HardwareResourceSummary, run: () => Promise<void>) {
  const original = DeviceHardwareEvaluator.inspectHostResources;
  DeviceHardwareEvaluator.inspectHostResources = () => resources;
  return run().finally(() => {
    DeviceHardwareEvaluator.inspectHostResources = original;
  });
}

function runtime(options: {
  pull?: () => Promise<boolean>;
  installed?: LocalInstalledModel[];
  calls?: { pullCount: number };
}) {
  return {
    runtimeType: 'custom_local' as const,
    endpointUrl: 'http://127.0.0.1:9999',
    isReachable: async () => true,
    getInstalledModels: async () => options.installed ?? [],
    ...(options.pull
      ? {
          pullModel: async () => {
            if (options.calls) options.calls.pullCount += 1;
            return options.pull!();
          },
        }
      : {}),
  };
}

test('model setup refuses to claim ready when the runtime cannot download', async () => {
  await withHostResources(roomyHost, async () => {
    const manager = new LocalModelManager();
    manager.registerRuntime(runtime({}));

    const result = await manager.initiateModelSetup('qwen2.5-coder:0.5b');

    assert.equal(result.stage, 'failed');
    assert.match(result.error || '', /does not support model downloads/i);
  });
});

test('model setup checks currently available RAM before starting a download', async () => {
  const calls = { pullCount: 0 };
  const lowMemoryHost = { ...roomyHost, freeMemMB: 1000 };

  await withHostResources(lowMemoryHost, async () => {
    const manager = new LocalModelManager();
    manager.registerRuntime(runtime({ pull: async () => true, calls }));

    const result = await manager.initiateModelSetup('qwen2.5-coder:0.5b');

    assert.equal(result.stage, 'failed');
    assert.match(result.error || '', /Insufficient available memory/i);
    assert.equal(calls.pullCount, 0);
  });
});

test('model setup requires the runtime to confirm installed weights after download', async () => {
  await withHostResources(roomyHost, async () => {
    const manager = new LocalModelManager();
    manager.registerRuntime(runtime({ pull: async () => true, installed: [] }));

    const result = await manager.initiateModelSetup('qwen2.5-coder:0.5b');

    assert.equal(result.stage, 'failed');
    assert.match(result.error || '', /did not confirm.*installed/i);
  });
});

test('in-process model loading stops before runtime initialization when RAM is insufficient', async () => {
  const lowMemoryHost = { ...roomyHost, freeMemMB: 1000 };

  await withHostResources(lowMemoryHost, async () => {
    const provider = new LocalTransformersProvider();
    await assert.rejects(provider.loadModel(), /refused before runtime initialization/i);
    assert.equal(provider.isReady, false);
  });
});

test('runtime status distinguishes exact installed model, loaded state, and prior inference', async () => {
  await withHostResources(roomyHost, async () => {
    const manager = new LocalModelManager();
    manager.registerRuntime({
      ...runtime({ installed: [{ name: 'qwen2.5-coder:0.5b-extra' }] }),
      getLoadedModels: async () => ['qwen2.5-coder:0.5b'],
      hasVerifiedInference: () => true,
    });

    const result = await manager.getRuntimeInfo('qwen2.5-coder:0.5b');

    assert.equal(result.modelInstalled, false);
    assert.equal(result.modelLoaded, true);
    assert.equal(result.inferenceVerified, true);
  });
});
