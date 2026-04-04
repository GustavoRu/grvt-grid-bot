import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GRVT_ENDPOINTS, GRVT_SESSION_COOKIE, SESSION_REFRESH_BUFFER_MS } from '@grvt-grid-bot/shared';
import type { GrvtEnvironment } from '@grvt-grid-bot/shared';

interface SessionState {
  cookie: string;
  accountId: string;
  expiresAt: number; // unix ms
}

@Injectable()
export class GrvtAuthService implements OnModuleInit {
  private readonly logger = new Logger(GrvtAuthService.name);
  private session: SessionState | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.authenticate();
  }

  get env(): GrvtEnvironment {
    return (this.config.get<string>('GRVT_ENV') ?? 'testnet') as GrvtEnvironment;
  }

  get baseUrl(): string {
    return GRVT_ENDPOINTS[this.env].http;
  }

  /** Returns the current session cookie value, refreshing if needed */
  async getSessionCookie(): Promise<string> {
    if (!this.session) {
      await this.authenticate();
    } else if (this.isExpiringSoon()) {
      await this.authenticate();
    }

    if (!this.session) throw new Error('GRVT authentication failed — no session available');
    return this.session.cookie;
  }

  /** Returns headers needed for authenticated GRVT API calls */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const cookie = await this.getSessionCookie();
    return {
      Cookie: `${GRVT_SESSION_COOKIE}=${cookie}`,
      'Content-Type': 'application/json',
    };
  }

  get accountId(): string {
    return this.session?.accountId ?? '';
  }

  private isExpiringSoon(): boolean {
    if (!this.session) return true;
    return Date.now() + SESSION_REFRESH_BUFFER_MS >= this.session.expiresAt;
  }

  private async authenticate(): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('GRVT_API_KEY');
    const loginUrl = `${this.baseUrl}/auth/api_key/login`;

    this.logger.log(`Authenticating with GRVT (${this.env})…`);

    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Auth failed ${response.status}: ${body}`);
      }

      // Extract session cookie from Set-Cookie header
      const setCookie = response.headers.get('set-cookie') ?? '';
      const cookieMatch = setCookie.match(new RegExp(`${GRVT_SESSION_COOKIE}=([^;]+)`));
      if (!cookieMatch) throw new Error('No session cookie in auth response');

      const cookie = cookieMatch[1];

      // Extract account ID header
      const accountId =
        response.headers.get('x-grvt-account-id') ??
        this.config.get<string>('GRVT_SUB_ACCOUNT_ID') ??
        '';

      // Parse cookie expiry (Max-Age or Expires)
      const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/i);
      const expiresIn = maxAgeMatch ? parseInt(maxAgeMatch[1]) * 1000 : 24 * 60 * 60 * 1000; // default 24h

      this.session = {
        cookie,
        accountId,
        expiresAt: Date.now() + expiresIn,
      };

      this.scheduleRefresh(expiresIn);
      this.logger.log(`✅ Authenticated — account: ${accountId}, expires in ${Math.round(expiresIn / 60000)}min`);
    } catch (error) {
      this.logger.error('Authentication failed', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  private scheduleRefresh(expiresInMs: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    const refreshIn = Math.max(0, expiresInMs - SESSION_REFRESH_BUFFER_MS);
    this.refreshTimer = setTimeout(() => {
      this.logger.log('Proactively refreshing GRVT session…');
      this.authenticate().catch((err) => this.logger.error('Session refresh failed', err));
    }, refreshIn);
  }
}
