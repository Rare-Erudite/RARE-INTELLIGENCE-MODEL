// Standalone feasibility probe: load the in-process ONNX model and generate genuinely.
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = '/tmp/models_cache';

const t0 = Date.now();
console.log('Loading onnx-community/Qwen2.5-0.5B-Instruct (q4, cpu)...');
const gen = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
  dtype: 'q4',
  device: 'cpu',
  progress_callback: (p) => {
    if (p && typeof p.progress === 'number') {
      process.stdout.write(`\r  ${p.file || 'weights'}: ${Math.round(p.progress * 100)}%   `);
    }
  },
});
console.log(`\nLoaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const out = await gen('<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n<|im_start|>user\nName two benefits of local AI inference.<|im_end|>\n<|im_start|>assistant\n', {
  max_new_tokens: 80,
  temperature: 0.7,
  do_sample: true,
});
console.log('OUTPUT:', JSON.stringify(out).slice(0, 800));
console.log('TOTAL_SECONDS:', ((Date.now() - t0) / 1000).toFixed(1));
