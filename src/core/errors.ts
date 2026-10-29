import type { ErrorInfo } from './types';

export class TrackerError extends Error {
  constructor(public code: string, message: string, public status?: number, public retryAfterMs?: number, public endpoint?: string) {
    super(message);
    this.name = 'TrackerError';
  }
}

export function errorInfo(error: unknown): ErrorInfo {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message, status: error.status, retryAfterMs: error.retryAfterMs, endpoint: error.endpoint };
  }
  if (error instanceof Error && error.name === 'QuotaExceededError') {
    return { code: 'STORAGE', message: 'No queda espacio disponible para guardar el historial. Libera espacio o elimina capturas antiguas.' };
  }
  return { code: 'INTERNAL', message: 'No se pudo completar la operación local. Recarga el panel y vuelve a intentarlo. Si persiste, revisa el almacenamiento del navegador.' };
}

export function fromInfo(info: ErrorInfo): TrackerError {
  return new TrackerError(info.code, info.message, info.status, info.retryAfterMs, info.endpoint);
}

export function rateLimitDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryDelay(attempt, retryAfterMs);
  return Math.min(900_000, 60_000 * 2 ** Math.min(attempt, 4));
}

export function retryDelay(attempt: number, retryAfterMs = 0): number {
  return Math.max(Number.isFinite(retryAfterMs) ? retryAfterMs : 0, Math.min(120_000, 2000 * 2 ** Math.min(attempt, 6)));
}
