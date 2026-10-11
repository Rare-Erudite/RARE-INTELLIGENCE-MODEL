import 'dotenv/config';

export interface EngineConfig {
  engineVersion: string;
  defaultProvider: 'local-transformers' | 'gemini' | 'ollama' | 'diagnostic-mock';
  zeroBudgetPolicy: {
    strictlyFreeOnly: boolean;
    forbidPaidFallbacks: boolean;
    maxInferenceBudgetUSD: 0;
  };
  safetyLimits: {
    maxExecutionStepsPerTask: number;
    maxRepairAttempts: number;
    stepTimeoutMs: number;
    overallTaskTimeoutMs: number;
    maxOutputTokens: number;
    maxContextMessages: number;
  };
  workspace: {
    rootDir: string;
    allowedExtensions: string[];
    disallowedPaths: string[];
    maxFileSizeBytes: number;
  };
  localModelHost: string; // e.g. http://127.0.0.1:11434 for Ollama
  geminiModel: string;    // 'gemini-3.8-flash'
}

export const DEFAULT_CONFIG: EngineConfig = {
  engineVersion: '1.0.0-rc1',
  defaultProvider: 'local-transformers',
  zeroBudgetPolicy: {
    strictlyFreeOnly: true,
    forbidPaidFallbacks: true,
    maxInferenceBudgetUSD: 0,
  },
  safetyLimits: {
    maxExecutionStepsPerTask: 12,
    maxRepairAttempts: 2,
    stepTimeoutMs: 30000,
    overallTaskTimeoutMs: 120000,
    maxOutputTokens: 2048,
    maxContextMessages: 20,
  },
  workspace: {
    rootDir: process.cwd(),
    allowedExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html', '.svg'],
    disallowedPaths: ['node_modules', '.git', '.env', 'dist', 'dist-server'],
    maxFileSizeBytes: 500 * 1024, // 500 KB per file limit for safety
  },
  localModelHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  geminiModel: 'gemini-3.8-flash',
};
