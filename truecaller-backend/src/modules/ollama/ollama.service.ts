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
        top_p: 0.95,
        num_predict: opts?.maxTokens ?? 512,
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
      .map((v, i) => `${i + 1}. "${v.name}" — saved by ${v.frequency} people, trust=${v.trustWeight.toFixed(2)}, sources=[${v.sources.join(',')}]`)
      .join('\n');

    const prompt = `You are an expert Indian name resolver for a caller-ID app. Given how different people saved a phone number, determine the person's REAL full name.

PHONE: ${phoneNumber}
SAVED AS:
${variantsList}

ANALYSIS STEPS:
1. IGNORE junk entries: "Do Not Pick", "Spam", "Fraud", numbers, single letters, random characters
2. IGNORE relationship terms that are NOT names: Papa, Mummy, Bhaiya, Didi, Uncle, Aunty, Sir, Madam, Boss, Bhai, Bhabhi, etc.
3. IDENTIFY the actual name parts across ALL variants:
   - Look for FIRST NAMES (Indian given names like Rahul, Priya, Aditya, Neha, etc.)
   - Look for LAST NAMES / SURNAMES (like Sharma, Singh, Gupta, Kumar, Patel, Verma, etc.)
   - "Kumar" or "Singh" appearing after a first name = middle name or last name
4. COMBINE evidence from ALL variants to form the MOST COMPLETE full name:
   - If variant A = "Rahul" and variant B = "Sharma Ji" → COMBINE to get "Rahul Sharma"
   - If variant A = "Priya" and variant B = "P Gupta" → COMBINE to get "Priya Gupta"
   - If variant A = "Amit Kumar" and variant B = "Amit" → PREFER "Amit Kumar" (more complete)
   - If variant A = "Dr Rajesh" and variant B = "Rajesh Patel" → output "Rajesh Patel"
5. PREFER: higher frequency + higher trust = more reliable
6. SELF_DECLARED source is most trustworthy — the person named themselves

OUTPUT RULES:
- Return the full name in TITLE CASE (capitalize first letter of each word)
- Do NOT include titles (Dr, Mr, Mrs, Er), relationship terms (Bhai, Ji, Sir), or descriptors (Office, Home, New, Old)
- The name should contain only first name + optional middle name + last name
- confidence: 0-100 (higher if sources agree, lower if contradictory)

Respond ONLY in this exact JSON:
{"bestName": "Full Name Here", "confidence": 85, "reasoning": "brief reason"}`;

    const raw = await this.generate(prompt, { temperature: 0.05, maxTokens: 200 });
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
    const prompt = `You are an expert spam call detector for an Indian caller-ID app. Analyze ALL the data below and determine spam probability.

PHONE: ${data.phoneNumber}
REPORTS: ${data.reportCount} total from ${data.uniqueReporters} unique users
ACTIVITY:
  - Last 24h: ${data.callsLast24h} reports
  - Last 7d: ${data.callsLast7d} reports
  - Avg call duration: ${data.avgCallDurationSec !== null ? data.avgCallDurationSec + 's' : 'N/A'}
  - Short call ratio (≤3s): ${(data.shortCallRatio * 100).toFixed(1)}%
  - Named as spam by: ${data.savedAsSpamByCount} users
SAVED NAMES: ${data.nameVariants.length > 0 ? data.nameVariants.slice(0, 10).join(', ') : 'none'}

SCORING GUIDE:
- 0-20: Legitimate (personal number, real person)
- 20-40: Low risk (maybe occasional telemarketing)
- 40-60: Moderate risk (frequent marketing calls)
- 60-80: High risk (aggressive telemarketer/suspected scam)
- 80-100: Very high risk (confirmed scam/robocall pattern)

KEY SIGNALS:
- 3+ unique reporters = strong spam signal
- 10+ reporters = almost certainly spam
- High short-call ratio (>50%) = people cutting immediately = spam
- Names with "spam", "fraud", "scam", "loan", "insurance", "agent" = spam
- Names that look like real Indian names (e.g., "Rahul Sharma") = likely legitimate

Categories: telemarketer, scam, robocall, debt-collector, survey, legitimate, unknown

Respond ONLY in JSON:
{"spamScore": 75, "isSpam": true, "category": "telemarketer", "reasoning": "brief reason"}`;

    const raw = await this.generate(prompt, { temperature: 0.05, maxTokens: 200 });
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
    const prompt = `Categorize this Indian phone number based on data.

PHONE: ${data.phoneNumber}
NAME: ${data.resolvedName || 'unknown'}
SAVED AS: ${data.nameVariants.slice(0, 8).join(', ') || 'none'}
SPAM SCORE: ${data.spamScore}/10
CALLS (7d): ${data.callVolume7d}

CATEGORIES & EXAMPLES:
- person (friend, family, colleague, neighbor)
- business (restaurant, shop, office, company, hotel)
- delivery (courier, food-delivery, ecommerce, logistics)
- bank (credit-card, loan, insurance, investment, nidhi)
- government (police, hospital, municipal, RTI, passport)
- telemarketer (sales, marketing, promotion, election-campaign)
- spam (scam, fraud, phishing, robocall)
- unknown (insufficient data)

HINTS:
- Indian personal names → "person"
- Company names or business keywords → "business"
- "Swiggy", "Zomato", "Amazon", "Flipkart", "Delhivery" → "delivery"
- "SBI", "HDFC", "axis", "ICICI", "loan" → "bank"
- High spam score (>5) → "spam" or "telemarketer"

Respond ONLY in JSON:
{"category": "person", "subCategory": "friend", "confidence": 80}`;

    const raw = await this.generate(prompt, { temperature: 0.05, maxTokens: 100 });
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
      // Try to extract JSON from potential markdown code blocks, extra text, etc.
      // First try: exact JSON block
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return fallback;

      let jsonStr = jsonMatch[0];
      // Clean common LLM artifacts: trailing commas, unquoted keys
      jsonStr = jsonStr.replace(/,\s*}/g, '}');

      const parsed = JSON.parse(jsonStr) as T;

      // Validate the parsed result has at least one expected key
      if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
        return parsed;
      }
      return fallback;
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
