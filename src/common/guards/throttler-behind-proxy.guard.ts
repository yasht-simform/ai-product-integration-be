import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Drop-in replacement for ThrottlerGuard when the app sits behind a reverse
 * proxy (nginx, AWS ALB, Cloudflare, etc.).
 *
 * Problem: req.ip resolves to the proxy's IP, so every client would share the
 * same bucket and the global limit would fire after just a few real users.
 *
 * Fix: read the leftmost IP from X-Forwarded-For, which is the original client
 * address appended by the first proxy in the chain.
 *
 * Register via APP_GUARD so it applies to every route automatically.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const forwarded = req.headers['x-forwarded-for'];

    if (forwarded) {
      // X-Forwarded-For: <client>, <proxy1>, <proxy2>
      // The header may arrive as a string or, in some frameworks, a string[].
      const raw = Array.isArray(forwarded) ? forwarded[0] : (forwarded as string);
      return Promise.resolve((raw as string).split(',')[0].trim());
    }

    // Fallback for direct connections (local dev, internal services).
    return Promise.resolve(req.ip ?? req.socket?.remoteAddress ?? 'unknown');
  }
}
