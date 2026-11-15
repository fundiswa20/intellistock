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

// FR-05
export interface Alert {
  alertId: number;
  stockItemId: number;
  stockItemName: string;
  unit: string;
  message: string;
  quantityAtAlert: number;
  reorderLevel: number;
  currentQuantity: number;
  createdAt: string;
  resolvedAt: string | null;
}

// FR-06: a listing as an owner browses it
export interface Listing {
  supplierListingId: number;
  supplierId: number;
  supplierName: string;
  deliveryArea: string | null;
  reliabilityScore: number;
  productName: string;
  category: string;
  packSize: number;
  packPrice: number;
  unitPrice: number;
  leadTimeDays: number;
  availableQuantity: number;
  deliveryCost: number;
  updatedAt: string;
  inYourArea: boolean;   // the owner's location names one of the supplier's delivery areas (D39)
  reach?: Reach;
}

// D42: in the owner's area, elsewhere in their province, or not judgeable; out-of-province
// suppliers are never sent to the owner
export type Reach = 'inArea' | 'nearby' | 'unknown';

export interface SupplierSummary {
  supplierId: number;
  companyName: string;
  deliveryArea: string | null;
  phone: string | null;
  reliabilityScore: number;
  reach: Reach;
  activeListings: number;
  minLeadTimeDays: number | null;
  maxLeadTimeDays: number | null;
  products: string[];
}

export interface SupplierDetail {
  supplierId: number;
  companyName: string;
  deliveryArea: string | null;
  phone: string | null;
  reliabilityScore: number;
  reach: Reach;
  listings: Listing[];
}

export interface SearchOption extends Listing {
  packs: number;
  units: number;
  subtotal: number;
  total: number;
  canFulfil: boolean;
}

export interface ListingSearch {
  searchTerm: string;
  unitsWanted: number;
  options: SearchOption[];   // reachable suppliers only, cheapest delivered first
}

export const REACH_LABEL: Record<Reach, string> = {
  inArea: 'In your area', nearby: 'Nearby area', unknown: 'Area not confirmed',
};
export const REACH_TONE: Record<Reach, string> = {
  inArea: 'pill-success', nearby: 'pill-accent', unknown: 'pill-neutral',
};

// D39: one supplier's offer when restocking an item, priced for the units wanted
export interface ComparisonOption extends Listing {
  packs: number;
  units: number;
  subtotal: number;
  total: number;
  sameProduct: boolean;
  orderedLastTime: boolean;
  canFulfil: boolean;
}

export interface LastSupplier {
  supplierId: number;
  supplierName: string;
  purchaseOrderId: number;
  productName: string;
  packs: number;
  status: OrderStatus;
  createdAt: string;
  total: number;
}

export interface Comparison {
  stockItemId: number;
  itemName: string;
  searchTerm: string;
  unitsWanted: number;
  lastSupplier: LastSupplier | null;
  options: ComparisonOption[];   // ranked: can supply it all, same product, cheapest delivered
}

// FR-07: a listing as its supplier manages it
export interface MyListing {
  supplierListingId: number;
  productName: string;
  category: string;
  packSize: number;
  packPrice: number;
  unitPrice: number;
  leadTimeDays: number;
  availableQuantity: number;
  deliveryCost: number;
  isActive: boolean;
  updatedAt: string;
}

export interface ListingInput {
  productName: string;
  category: string;
  packSize: number;
  packPrice: number;
  leadTimeDays: number;
  availableQuantity: number;
  deliveryCost: number;
  isActive: boolean;
}

export type OrderStatus = 'Placed' | 'Confirmed' | 'Dispatched' | 'Delivered' | 'Declined' | 'Cancelled';

// FR-10
export interface Order {
  purchaseOrderId: number;
  status: OrderStatus;
  productName: string;
  packSize: number;
  packPrice: number;
  packs: number;
  units: number;
  subtotal: number;
  deliveryCost: number;
  total: number;
  note: string | null;
  stockItemId: number | null;
  supplierListingId: number;
  supplier: { id: number; name: string; phone: string | null; deliveryArea: string | null; reliabilityScore: number };
  owner: { id: number; name: string; contact: string; location: string; phone: string | null } | null;
  createdAt: string;
  confirmedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  receivedAt: string | null;
  nextStatuses: OrderStatus[];
  canCancel: boolean;
  canReceive: boolean;
}

export interface Account {
  id: number;
  fullName: string;
  email: string;
  role: 'BusinessOwner' | 'Supplier';
  createdAt: string;
  phone: string | null;
  businessName: string | null;
  location: string | null;
  companyName: string | null;
  deliveryArea: string | null;
  reliabilityScore: number | null;
}

// a supplier's listing at or below this many packs needs restocking
export const LOW_PACKS = 5;

export const CATEGORIES = ['Groceries', 'Clothing', 'Electronics', 'Furniture', 'Toys'];

@Injectable({ providedIn: 'root' })
export class InventoryApi {
  private http = inject(HttpClient);

  // ---- owner: stock (FR-03, FR-04, FR-05, FR-08)
  stock() { return this.http.get<StockItem[]>(`${API_URL}/api/stock`); }
  item(id: number) { return this.http.get<StockItem>(`${API_URL}/api/stock/${id}`); }
  createItem(body: { name: string; category: string; unit: string; reorderLevel: number; unitCost: number;
                     sellingPrice: number; openingQuantity: number }) {
    return this.http.post<StockItem>(`${API_URL}/api/stock`, body);
  }
  movements(id: number, limit = 15) {
    return this.http.get<Movement[]>(`${API_URL}/api/stock/${id}/movements?limit=${limit}`);
  }
  recordMovement(id: number, body: { type: string; quantity: number; note: string | null }) {
    return this.http.post<MovementResult>(`${API_URL}/api/stock/${id}/movements`, body);
  }
  predict(id: number) { return this.http.post<Prediction>(`${API_URL}/api/stock/${id}/prediction`, null); }
  alerts(status: 'open' | 'resolved' | 'all' = 'open') {
    return this.http.get<Alert[]>(`${API_URL}/api/stock/alerts?status=${status}`);
  }

  // ---- owner: suppliers and orders (FR-06, FR-10)
  listings(q = '') {
    return this.http.get<Listing[]>(`${API_URL}/api/listings`, { params: q ? { q } : {} });
  }
  compare(itemId: number, units: number | null) {
    return this.http.get<Comparison>(`${API_URL}/api/stock/${itemId}/suppliers`, { params: units ? { units } : {} });
  }
  lastSupplier(stockItemId: number) {
    return this.http.get<LastSupplier | null>(`${API_URL}/api/orders/last-supplier`, { params: { stockItemId } });
  }
  suppliers() { return this.http.get<SupplierSummary[]>(`${API_URL}/api/suppliers`); }
  supplier(id: number) { return this.http.get<SupplierDetail>(`${API_URL}/api/suppliers/${id}`); }
  searchListings(q: string) { return this.http.get<ListingSearch>(`${API_URL}/api/listings/search`, { params: { q } }); }
  newProductOrder(body: { name: string; category: string; unit: string; reorderLevel: number; sellingPrice: number;
                          supplierListingId: number; packs: number; note: string | null }) {
    return this.http.post<{ item: StockItem; order: Order }>(`${API_URL}/api/orders/new-product`, body);
  }
  orders() { return this.http.get<Order[]>(`${API_URL}/api/orders`); }
  order(id: number) { return this.http.get<Order>(`${API_URL}/api/orders/${id}`); }
  placeOrder(body: { supplierListingId: number; packs: number; stockItemId: number | null; note: string | null }) {
    return this.http.post<Order>(`${API_URL}/api/orders`, body);
  }
  cancelOrder(id: number, reason: string | null = null) {
    return this.http.post<Order>(`${API_URL}/api/orders/${id}/cancel`, { reason });
  }
  receiveOrder(id: number, stockItemId: number | null) {
    return this.http.post<{ order: Order; quantityOnHand: number; alert: 'resolved' | null }>(
      `${API_URL}/api/orders/${id}/receive`, { stockItemId });
  }

  // ---- supplier (FR-07, FR-10)
  myListings() { return this.http.get<MyListing[]>(`${API_URL}/api/supplier/listings`); }
  createListing(body: ListingInput) { return this.http.post<MyListing>(`${API_URL}/api/supplier/listings`, body); }
  updateListing(id: number, body: ListingInput) {
    return this.http.put<MyListing>(`${API_URL}/api/supplier/listings/${id}`, body);
  }
  supplierOrders() { return this.http.get<Order[]>(`${API_URL}/api/supplier/orders`); }
  supplierOrder(id: number) { return this.http.get<Order>(`${API_URL}/api/supplier/orders/${id}`); }
  setOrderStatus(id: number, status: OrderStatus, reason: string | null = null) {
    return this.http.post<Order>(`${API_URL}/api/supplier/orders/${id}/status`, { status, reason });
  }

  // ---- both roles
  account() { return this.http.get<Account>(`${API_URL}/api/account`); }
  updateAccount(body: Partial<Account>) { return this.http.put<Account>(`${API_URL}/api/account`, body); }
}

// "bag" -> "bags", "loaf" -> "loaves"; matches the API's alert messages
export function plural(unit: string, n: number): string {
  if (Math.abs(n) === 1) return unit;
  return ({ loaf: 'loaves', box: 'boxes', each: 'each' } as Record<string, string>)[unit] ?? unit + 's';
}

// R 1,234.50
export function money(n: number): string {
  const [whole, cents] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

export function orderTone(status: OrderStatus): string {
  return ({
    Placed: 'pill-accent', Confirmed: 'pill-success', Dispatched: 'pill-success',
    Delivered: 'pill-solid', Declined: 'pill-danger', Cancelled: 'pill-muted',
  } as Record<OrderStatus, string>)[status];
}

// FR-06 search: every word typed appears somewhere in the text, ignoring case ("bread" finds
// "Sasko White Bread 700g", "white bread" too)
export function matchesSearch(query: string, ...texts: string[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = texts.join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

// The same product, by name, as the API's ProductMatch (D39): one name contains the other, or
// a word starts with the product word - the last word before the first size or count
// ("Clover Long Life Milk 1L" -> "milk"). Case-insensitive, either way round.
export function productKeyTerm(name: string): string {
  const words = name.match(/[\p{L}\p{N}'’-]+/gu) ?? [];
  const before: string[] = [];
  for (const w of words) { if (/\d/.test(w)) break; before.push(w); }
  return (before[before.length - 1] ?? words.find(w => !/\d/.test(w)) ?? name.trim()).toLowerCase();
}

export function sameProduct(a: string, b: string): boolean {
  const one = (item: string, other: string) => {
    if (other.toLowerCase().includes(item.trim().toLowerCase())) return true;
    let term = productKeyTerm(item);
    if (term.length > 3 && term.endsWith('s')) term = term.slice(0, -1);
    return term.length >= 3 && (other.match(/[\p{L}\p{N}'’-]+/gu) ?? []).some(w => w.toLowerCase().startsWith(term));
  };
  return one(a, b) || one(b, a);
}

export function isOpenOrder(o: Order) { return o.status === 'Placed' || o.status === 'Confirmed' || o.status === 'Dispatched'; }

// turns an API error (ProblemDetails or validation problem) into one readable line
export function problemText(err: any): string {
  const body = err?.error;
  if (body?.errors) return Object.values(body.errors).flat().join(' ');
  if (body?.title) return body.title;
  if (err?.status === 0) return 'Cannot reach the IntelliStock API. Is it running?';
  return 'Something went wrong. Please try again.';
}
