import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig } from 'axios';

// ── Types ─────────────────────────────────────────────────────────────

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: false;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

export interface NameAnalysisResult {
  bestName: string;
  confidence: number;
  reasoning: string;
}

export interface SpamAnalysisResult {
  spamScore: number;         // 0-100
  isSpam: boolean;
  category: string;          // telemarketer, scam, robocall, legitimate, unknown
  reasoning: string;
}

// ── Service ───────────────────────────────────────────────────────────

@Injectable()
export class OllamaService implements OnModuleInit {
  private readonly logger = new Logger(OllamaService.name);
  private baseUrl: string;
  private model: string;
  private timeout: number;
  private enabled: boolean;
  private ready = false;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('ollama.url', 'http://localhost:11434');
    this.model = this.configService.get<string>('ollama.model', 'llama3.2:1b');
    this.timeout = this.configService.get<number>('ollama.timeout', 30000);
    this.enabled = this.configService.get<boolean>('ollama.enabled', true);
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Ollama AI is DISABLED via config');
      return;
    }
    await this.ensureModel();
  }

  // ── Model bootstrap ─────────────────────────────────────────────────

  private async ensureModel(): Promise<void> {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds between retries

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if model exists
        const res = await axios.get(`${this.baseUrl}/api/tags`, { timeout: this.timeout });
        const models: { name: string }[] = res.data.models || [];
        const installed = models.some(
          (m) => m.name === this.model || m.name.startsWith(this.model.split(':')[0]),
        );

        if (!installed) {
          this.logger.log(`Model "${this.model}" not found — pulling (this may take a few minutes)...`);
          await this.pullModel();
        } else {
          this.logger.log(`Ollama model "${this.model}" is ready`);
        }
        this.ready = true;
        return; // Success, exit retry loop
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) {
          this.logger.warn(`Ollama connection attempt ${attempt}/${maxRetries} failed at ${this.baseUrl}: ${errorMsg}, retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          this.logger.warn(`Ollama not reachable at ${this.baseUrl} after ${maxRetries} attempts (${errorMsg}) — AI features will fall back to heuristics`);
          this.ready = false;
        }
      }
    }
  }

  private async pullModel(): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/api/pull`,
        { name: this.model, stream: false },
        { timeout: 10 * 60 * 1000 }, // 10 min for pull
      );
      this.logger.log(`Model "${this.model}" pulled successfully`);
    } catch (err) {
      this.logger.error(`Failed to pull model "${this.model}": ${err.message}`);
    }
  }

  // ── Low-level generate ──────────────────────────────────────────────

  private async generate(prompt: string, opts?: { temperature?: number; maxTokens?: number }): Promise<string | null> {
    if (!this.enabled || !this.ready) return null;

    const body: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      stream: false,
      options: {
        temperature: opts?.temperature ?? 0.1,
        top_p: 0.9,
        num_predict: opts?.maxTokens ?? 256,
      },
    };

    try {
      const res = await axios.post<OllamaGenerateResponse>(
        `${this.baseUrl}/api/generate`,
        body,
        { timeout: this.timeout },
      );
      return res.data.response?.trim() || null;
    } catch (err) {
      this.logger.warn(`Ollama request failed: ${err.message}`);
      return null;
    }
  }

  private async fetchOllama(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  //  NAME RESOLUTION AI
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Given a phone number with multiple name contributions (how different people
   * saved this contact), use LLM to pick the most likely real name.
   */
  async analyzeBestName(
    phoneNumber: string,
    nameVariants: { name: string; frequency: number; trustWeight: number; sources: string[] }[],
  ): Promise<NameAnalysisResult | null> {
    if (nameVariants.length === 0) return null;

    // If only 1 variant, no need for AI
    if (nameVariants.length === 1) {
      return {
        bestName: nameVariants[0].name,
        confidence: 85,
        reasoning: 'Single variant — no ambiguity',
      };
    }

    const variantsList = nameVariants
      .map((v, i) => `${i + 1}. "${v.name}" — saved by ${v.frequency} people, trust_weight=${v.trustWeight.toFixed(2)}, sources=[${v.sources.join(',')}]`)
      .join('\n');

    const prompt = `You are a caller-ID name resolver. A phone number (${phoneNumber}) has been saved with different names by different people. Analyze ALL the variants and determine the most likely REAL full name of the person.

VARIANTS:
${variantsList}

RULES:
- Prefer full names over nicknames or abbreviations
- Higher frequency + higher trust_weight = more reliable
- Names from SELF_DECLARED or VERIFIED sources are most trustworthy
- Ignore obviously fake/junk names (e.g. "Do Not Pick", "Spam", etc.)
- If variants are similar (e.g. "Rahul" vs "Rahul Sharma"), prefer the more complete one
- IMPORTANT: If one variant has a first name and another has a last name, COMBINE them into a full name
  Example: If you see "Rahul" and "Sharma Ji" → the best name is "Rahul Sharma"
  Example: If you see "Priya" and "Priya G" and "P Gupta" → the best name is "Priya Gupta"
- If names are completely different, pick the one with best frequency × trust score
- Think about what the REAL person's full name most likely is by combining evidence from ALL variants

Respond ONLY in this exact JSON format, no other text:
{"bestName": "Full Name Here", "confidence": 85, "reasoning": "one line reason"}`;

    const raw = await this.generate(prompt, { temperature: 0.1, maxTokens: 150 });
    if (!raw) return null;

    return this.parseJson<NameAnalysisResult>(raw, {
      bestName: nameVariants[0].name,
      confidence: 60,
      reasoning: 'AI parse fallback',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  SPAM DETECTION AI
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Analyze call/report patterns to determine spam likelihood.
   */
  async analyzeSpamPatterns(data: {
    phoneNumber: string;
    reportCount: number;
    uniqueReporters: number;
    avgCallDurationSec: number | null;
    callsLast24h: number;
    callsLast7d: number;
    shortCallRatio: number;        // ratio of calls answered & hung up within 3 sec
    savedAsSpamByCount: number;    // how many people saved this contact with spam-like names
    nameVariants: string[];        // names people saved this number as
  }): Promise<SpamAnalysisResult | null> {
    const prompt = `You are a spam call detector for a caller-ID app (like Truecaller). Analyze the following phone number data and determine if it is spam.

PHONE: ${data.phoneNumber}
SPAM REPORTS: ${data.reportCount} reports from ${data.uniqueReporters} unique users
CALL PATTERNS:
  - Calls in last 24h: ${data.callsLast24h}
  - Calls in last 7d: ${data.callsLast7d}
  - Average call duration: ${data.avgCallDurationSec !== null ? data.avgCallDurationSec + 's' : 'unknown'}
  - Short call ratio (hung up ≤3s): ${(data.shortCallRatio * 100).toFixed(1)}%
  - Saved as spam-like name by: ${data.savedAsSpamByCount} people
NAMES SAVED AS: ${data.nameVariants.length > 0 ? data.nameVariants.join(', ') : 'none'}

SPAM INDICATORS:
- High report count from many unique users = very likely spam
- High call volume (50+ calls/day) = telemarketer/robocall
- High short-call ratio (>60%) = people cutting the call immediately = spam signal
- Names containing "spam", "fraud", "loan", "insurance" etc. = spam
- Very short avg duration (<5s) across many calls = robocall

Respond ONLY in this exact JSON format, no other text:
{"spamScore": 75, "isSpam": true, "category": "telemarketer", "reasoning": "one line reason"}

Categories: telemarketer, scam, robocall, legitimate, unknown`;

    const raw = await this.generate(prompt, { temperature: 0.1, maxTokens: 150 });
    if (!raw) return null;

    return this.parseJson<SpamAnalysisResult>(raw, {
      spamScore: 50,
      isSpam: false,
      category: 'unknown',
      reasoning: 'AI parse fallback',
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  CALLER CATEGORY AI
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Categorize a caller based on name and patterns.
   * Returns: person, business, delivery, bank, government, spam, unknown
   */
  async categorizeNumber(data: {
    phoneNumber: string;
    resolvedName: string | null;
    nameVariants: string[];
    spamScore: number;
    callVolume7d: number;
  }): Promise<{ category: string; subCategory: string; confidence: number } | null> {
    const prompt = `You are a phone number categorizer. Based on the data, determine what category this phone number belongs to.

PHONE: ${data.phoneNumber}
RESOLVED NAME: ${data.resolvedName || 'unknown'}
SAVED AS: ${data.nameVariants.join(', ') || 'none'}
SPAM SCORE: ${data.spamScore}
CALL VOLUME (7 days): ${data.callVolume7d}

CATEGORIES: person, business, delivery, bank, government, telemarketer, spam, unknown
SUB-CATEGORIES (examples): friend, family, restaurant, hospital, courier, credit-card, police, election-campaign, etc.

Respond ONLY in this exact JSON format:
{"category": "business", "subCategory": "restaurant", "confidence": 80}`;

    const raw = await this.generate(prompt, { temperature: 0.1, maxTokens: 100 });
    if (!raw) return null;

    return this.parseJson<{ category: string; subCategory: string; confidence: number }>(raw, {
      category: 'unknown',
      subCategory: 'unknown',
      confidence: 0,
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private parseJson<T>(raw: string, fallback: T): T {
    try {
      // Extract JSON from potential markdown code blocks or extra text
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return fallback;
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      this.logger.debug(`Failed to parse AI response: ${raw.substring(0, 200)}`);
      return fallback;
    }
  }

  /** Check if AI is available and ready */
  isReady(): boolean {
    return this.enabled && this.ready;
  }

  /**
   * Try to reconnect to Ollama if it wasn't ready at startup.
   * Called lazily when AI features are needed.
   */
  async tryReconnect(): Promise<boolean> {
    if (this.ready || !this.enabled) return this.ready;
    this.logger.log('Attempting to reconnect to Ollama...');
    await this.ensureModel();
    return this.ready;
  }

  /** Get current status info */
  getStatus() {
    return {
      enabled: this.enabled,
      ready: this.ready,
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }
}
