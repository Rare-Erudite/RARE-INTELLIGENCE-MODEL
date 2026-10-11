/**
 * RARE-INTELLIGENCE — Future Assistant Foundation (RARE-THE-SIXTH)
 * Modular services for:
 * 1. Conversational reasoning & token budgeting
 * 2. Grounded research & contradiction detection
 * 3. Document understanding (Text, Markdown, JSON, CSV tables)
 * 4. Safe URL reader with strict SSRF defense (blocking private/loopback IPs)
 * 5. Multimodal interface contracts
 */

import {
  ExtractedDocumentData,
  ModelMessage,
  ResearchFinding,
} from '../types.js';
import { defaultSecurityGuard } from '../security/permissions.js';
import { logger } from '../security/logger.js';

export class AssistantFoundation {
  // ==========================================
  // 1. Conversation & Token Budgeting
  // ==========================================
  public estimateTokenBudget(messages: ModelMessage[], maxLimit = 8192): {
    estimatedTokens: number;
    remainingBudget: number;
    isWithinLimit: boolean;
    recommendedTrimming: boolean;
  } {
    let charCount = 0;
    for (const m of messages) {
      charCount += (m.content || '').length;
    }
    // Heuristic: ~4 characters per token in English
    const estimatedTokens = Math.ceil(charCount / 4);
    const remainingBudget = Math.max(0, maxLimit - estimatedTokens);

    return {
      estimatedTokens,
      remainingBudget,
      isWithinLimit: estimatedTokens <= maxLimit,
      recommendedTrimming: estimatedTokens > maxLimit * 0.8,
    };
  }

  // ==========================================
  // 2. Grounded Research & Contradiction Detection
  // ==========================================
  public conductGroundedResearch(topic: string, retrievedNotes: string[]): ResearchFinding {
    const questions: string[] = [
      `What are the core technical constraints and requirements for "${topic}"?`,
      `What verified dependencies and interfaces exist for "${topic}"?`,
      `Are there any conflicting assumptions or unverified claims regarding "${topic}"?`,
    ];

    const verifiedFacts: Array<{ source: string; content: string; reliability: 'high' | 'medium' }> = [
      {
        source: 'RARE-INTELLIGENCE System Specification',
        content: 'Zero-budget policy is mandatory: internet data is the only permitted expense.',
        reliability: 'high',
      },
      {
        source: 'Runtime Environment',
        content: `Node.js version ${process.version} running in sandboxed workspace.`,
        reliability: 'high',
      },
    ];

    const hypotheses: string[] = [];
    const contradictions: string[] = [];

    for (const note of retrievedNotes) {
      const lower = note.toLowerCase();
      if (lower.includes('unlimited') || lower.includes('free cloud sql forever')) {
        contradictions.push(`Contradiction detected: Note claims unlimited cloud resources ("${note}"), which violates strict free tier reality.`);
      } else if (lower.includes('assumes') || lower.includes('probably') || lower.includes('might')) {
        hypotheses.push(note);
      } else {
        verifiedFacts.push({
          source: 'Retrieved Knowledge',
          content: note,
          reliability: 'medium',
        });
      }
    }

    return {
      query: topic,
      decomposedQuestions: questions,
      verifiedFacts,
      hypotheses,
      contradictionsDetected: contradictions,
      summary: `Synthesized research for "${topic}": ${verifiedFacts.length} verified facts, ${hypotheses.length} hypotheses, ${contradictions.length} contradictions.`,
    };
  }

  // ==========================================
  // 3. Document & Structured Data Parsing
  // ==========================================
  public parseDocumentContent(filename: string, content: string): ExtractedDocumentData {
    const ext = filename.split('.').pop()?.toLowerCase() || 'text';
    const lines = content.split('\n');

    if (ext === 'csv') {
      const parsedRows = lines
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => line.split(',').map((c) => c.replace(/^["']|["']$/g, '').trim()));

      const headers = parsedRows[0] || [];
      const rows = parsedRows.slice(1);

      return {
        filename,
        format: 'csv',
        lineCount: lines.length,
        summary: `CSV spreadsheet containing ${rows.length} rows and ${headers.length} columns: [${headers.join(', ')}]`,
        tables: [{ headers, rows }],
        metadata: { rowCount: rows.length, columnCount: headers.length },
      };
    }

    if (ext === 'json') {
      try {
        const obj = JSON.parse(content);
        const keys = Object.keys(obj);
        return {
          filename,
          format: 'json',
          lineCount: lines.length,
          summary: `JSON document containing ${keys.length} top-level keys: [${keys.slice(0, 10).join(', ')}]`,
          metadata: { keysCount: keys.length, isArray: Array.isArray(obj) },
        };
      } catch (err: any) {
        return {
          filename,
          format: 'json',
          lineCount: lines.length,
          summary: `Malformed JSON document: ${err.message}`,
          metadata: { parseError: true },
        };
      }
    }

    // Markdown or Plain Text
    const headings = lines.filter((l) => l.startsWith('#')).map((l) => l.trim());
    return {
      filename,
      format: ext === 'md' ? 'markdown' : 'text',
      lineCount: lines.length,
      summary: `${ext.toUpperCase()} document with ${lines.length} lines${headings.length > 0 ? ` and ${headings.length} headings` : ''}.`,
      metadata: { headingsCount: headings.length, byteSize: Buffer.byteLength(content, 'utf-8') },
    };
  }

  // ==========================================
  // 4. Safe URL Processing with SSRF Defense
  // ==========================================
  public validateUrlForSSRF(rawUrl: string): { safe: boolean; reason?: string; parsedUrl?: URL } {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { safe: false, reason: 'Malformed URL.' };
    }

    // Only allow http: and https:
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { safe: false, reason: `Unsupported protocol "${url.protocol}". Only HTTP/HTTPS permitted.` };
    }

    const host = url.hostname.toLowerCase();

    // Block localhost, loopbacks, internal clouds
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '169.254.169.254' || // Cloud metadata endpoint
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return { safe: false, reason: `SSRF Violation: Access to private/loopback host "${host}" is strictly forbidden.` };
    }

    // Block private IPv4 ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const octet1 = parseInt(ipv4Match[1], 10);
      const octet2 = parseInt(ipv4Match[2], 10);

      if (
        octet1 === 10 ||
        (octet1 === 172 && octet2 >= 16 && octet2 <= 31) ||
        (octet1 === 192 && octet2 === 168) ||
        octet1 === 127
      ) {
        return { safe: false, reason: `SSRF Violation: Target IP "${host}" is within a restricted private network range.` };
      }
    }

    return { safe: true, parsedUrl: url };
  }

  public async fetchSafeUrlContent(rawUrl: string): Promise<{
    success: boolean;
    url: string;
    textExcerpt?: string;
    statusCode?: number;
    error?: string;
  }> {
    const validation = this.validateUrlForSSRF(rawUrl);
    if (!validation.safe) {
      return {
        success: false,
        url: rawUrl,
        error: validation.reason,
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      if (typeof timeout.unref === 'function') timeout.unref();

      const res = await fetch(rawUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RARE-INTELLIGENCE/1.0.0 (ResearchBot)' },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          success: false,
          url: rawUrl,
          statusCode: res.status,
          error: `HTTP error status ${res.status}`,
        };
      }

      const text = await res.text();
      // Strip HTML tags for clean text excerpt
      const cleanText = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();

      return {
        success: true,
        url: rawUrl,
        statusCode: res.status,
        textExcerpt: cleanText.slice(0, 1000) + (cleanText.length > 1000 ? '...' : ''),
      };
    } catch (err: any) {
      return {
        success: false,
        url: rawUrl,
        error: `Network retrieval failed: ${err.message}`,
      };
    }
  }

  // ==========================================
  // 5. Multimodal Capability Declaration
  // ==========================================
  public getMultimodalCapabilities(): Array<{
    modality: 'audio_transcription' | 'speech_synthesis' | 'image_understanding';
    supportedInCurrentEnvironment: boolean;
    requiredModel: string;
    notes: string;
  }> {
    return [
      {
        modality: 'audio_transcription',
        supportedInCurrentEnvironment: false,
        requiredModel: 'gemini-3.5-transcribe',
        notes: 'API contracts ready; requires client microphone audio streaming endpoint.',
      },
      {
        modality: 'speech_synthesis',
        supportedInCurrentEnvironment: false,
        requiredModel: 'gemini-3.8-flash-lite-tts',
        notes: 'API contracts ready; output audio modality requires client WebAudio/PCM playback.',
      },
      {
        modality: 'image_understanding',
        supportedInCurrentEnvironment: true,
        requiredModel: 'gemini-3.8-flash',
        notes: 'Operational via Gemini multimodal parts payload with inlineData base64.',
      },
    ];
  }
}

export const assistantFoundation = new AssistantFoundation();
