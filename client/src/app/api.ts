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

// FR-07: one supplier's offer for restocking an item, ranked by the API
export interface SupplierOption {
  supplierListingId: number;
  supplierId: number;
  companyName: string;
  deliveryArea: string;
  packPrice: number;
  packSize: number;
  packsRequired: number;
  deliveryCost: number;
  totalDeliveredCost: number;
  leadTimeDays: number;
  reliabilityScore: number;
  servesMyArea: boolean;
  score: number;
  isRecommended: boolean;
  scoreBreakdown: string;
}

// FR-10: an order against one supplier listing. companyName is the other party:
// the supplier for the owner, the owner's business for the supplier.
export type OrderStatus = 'Placed' | 'Confirmed' | 'Dispatched' | 'Delivered';

export interface OrderLine {
  orderLineId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Order {
  orderId: number;
  companyName: string;
  status: OrderStatus;
  totalCost: number;
  placedAt: string;
  expectedDeliveryAt: string | null;
  lines: OrderLine[];
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
  compareSuppliers(id: number, quantity: number) {
    return this.http.get<SupplierOption[]>(`${API_URL}/api/stock/${id}/suppliers?quantity=${quantity}`);
  }
  placeOrder(body: { supplierListingId: number; stockItemId: number; quantity: number }) {
    return this.http.post<Order>(`${API_URL}/api/orders`, body);
  }
}

// FR-06: a supplier's own price list
export interface ListingRequest {
  productName: string;
  category: string;
  packSize: number;
  packPrice: number;
  availableQuantity: number;
  leadTimeDays: number;
  deliveryCost: number;
}

export interface Listing extends ListingRequest {
  supplierListingId: number;
  isActive: boolean;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class SupplierApi {
  private http = inject(HttpClient);

  listings() { return this.http.get<Listing[]>(`${API_URL}/api/supplier/listings`); }
  createListing(body: ListingRequest) {
    return this.http.post<Listing>(`${API_URL}/api/supplier/listings`, body);
  }
  orders() { return this.http.get<Order[]>(`${API_URL}/api/supplier/orders`); }
  updateOrderStatus(id: number, status: OrderStatus) {
    return this.http.put<Order>(`${API_URL}/api/supplier/orders/${id}/status`, { status });
  }
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
