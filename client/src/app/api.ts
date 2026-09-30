import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

// The API runs on the host at port 5000 both in development and under docker compose;
// the browser reaches it directly (the API allows this origin through CORS).
export const API_URL = 'http://localhost:5000';

export interface StockItem {
  stockItemId: number;
  name: string;
  category: string;
  unit: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCost: number;
  sellingPrice: number;
  isLow: boolean;
  createdAt: string;
}

export interface Movement {
  transactionId: number;
  type: 'Sale' | 'Restock' | 'Adjustment';
  quantityChange: number;
  quantityAfter: number;
  occurredAt: string;
  note: string | null;
}

export interface MovementResult {
  transaction: Movement;
  item: StockItem;
  alert: 'raised' | 'resolved' | null;
}

// FR-08 - see BUILD-JOURNAL D25 for how the two paths are decided
export interface Prediction {
  reorderPredictionId: number;
  stockItemId: number;
  predictedDailyDemand: number;
  confidence: number | null;
  daysUntilStockOut: number | null;
  recommendedQuantity: number;
  reorderByDate: string | null;
  recommendationSource: 'model' | 'thresholdBasedAdvice';
  basis: string;
  modelVersion: string | null;
  usedFallback: boolean;
  fallbackReason: string | null;
  historyDays: number | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class InventoryApi {
  private http = inject(HttpClient);

  stock() { return this.http.get<StockItem[]>(`${API_URL}/api/stock`); }
  item(id: number) { return this.http.get<StockItem>(`${API_URL}/api/stock/${id}`); }
  movements(id: number, limit = 15) {
    return this.http.get<Movement[]>(`${API_URL}/api/stock/${id}/movements?limit=${limit}`);
  }
  recordMovement(id: number, body: { type: string; quantity: number; note: string | null }) {
    return this.http.post<MovementResult>(`${API_URL}/api/stock/${id}/movements`, body);
  }
  predict(id: number) { return this.http.post<Prediction>(`${API_URL}/api/stock/${id}/prediction`, null); }
}

// "bag" -> "bags", "loaf" -> "loaves"; matches the API's alert messages
export function plural(unit: string, n: number): string {
  if (Math.abs(n) === 1) return unit;
  return ({ loaf: 'loaves', box: 'boxes', each: 'each' } as Record<string, string>)[unit] ?? unit + 's';
}

// turns an API error (ProblemDetails or validation problem) into one readable line
export function problemText(err: any): string {
  const body = err?.error;
  if (body?.errors) return Object.values(body.errors).flat().join(' ');
  if (body?.title) return body.title;
  if (err?.status === 0) return 'Cannot reach the IntelliStock API. Is it running?';
  return 'Something went wrong. Please try again.';
}
