import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { InventoryApi, Listing, StockItem, matchesSearch, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';
import { OrderDialogComponent } from '../shared/order-dialog.component';

// FR-06: every supplier's active listings, cheapest per unit first, and placing an order (FR-10).
// Opened from a stock item as /suppliers?q=<name>&item=<id>&qty=<recommended units>.
@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [FormsModule, PercentPipe, MoneyPipe, EmptyStateComponent, IconComponent, OrderDialogComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>Suppliers</h1>
        <p class="subtitle">Compare listings from every supplier and order whole packs.</p>
      </div>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    <div class="card card-flush">
      <div class="toolbar">
        <div class="search">
          <app-icon name="search" [size]="16" />
          <input class="input" type="search" placeholder="Search products or suppliers" [ngModel]="query()"
                 (ngModelChange)="query.set($event)" aria-label="Search listings" />
        </div>
        <span class="muted small">{{ shown().length }} {{ shown().length === 1 ? 'listing' : 'listings' }} from {{ supplierCount() }} {{ supplierCount() === 1 ? 'supplier' : 'suppliers' }}</span>
      </div>

      @if (loading()) {
        <div class="loading">Loading listings…</div>
      } @else if (shown().length) {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Product</th><th>Supplier</th><th class="num">Pack</th><th class="num">Pack price</th>
                <th class="num">Per unit</th><th class="num">Delivery</th><th class="num">Lead time</th><th class="num">Available</th><th></th>
              </tr>
            </thead>
            <tbody>
              @for (l of shown(); track l.supplierListingId) {
                <tr>
                  <td><div class="cell-title">{{ l.productName }}</div><div class="cell-sub">{{ l.category }}</div></td>
                  <td>
                    <div class="strong">{{ l.supplierName }}</div>
                    <div class="cell-sub">{{ l.reliabilityScore | percent }} on time · {{ l.deliveryArea || 'Area not given' }}</div>
                    <span class="pill area" [class.pill-success]="l.inYourArea" [class.pill-accent]="!l.inYourArea">
                      {{ l.inYourArea ? 'In your area' : 'Outside your area' }}</span>
                  </td>
                  <td class="num secondary">{{ l.packSize }}</td>
                  <td class="num">{{ l.packPrice | money }}</td>
                  <td class="num"><span class="qty">{{ l.unitPrice | money }}</span>
                    @if (cheapest().has(l.supplierListingId)) { <div><span class="pill pill-success pill-plain best">Best price</span></div> }</td>
                  <td class="num secondary">{{ l.deliveryCost | money }}</td>
                  <td class="num secondary nowrap">{{ l.leadTimeDays }} {{ l.leadTimeDays === 1 ? 'day' : 'days' }}</td>
                  <td class="num">
                    @if (l.availableQuantity > 0) { <span class="tabular">{{ l.availableQuantity }}</span> <span class="cell-sub">packs</span> }
                    @else { <span class="pill pill-danger">Out of stock</span> }
                  </td>
                  <td class="num"><button class="btn btn-primary btn-sm" [disabled]="l.availableQuantity === 0" (click)="startOrder(l)">Order</button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (listings().length) {
        <app-empty-state icon="search" title="No listings match"
                         [text]="'No supplier lists anything matching “' + query() + '”.'">
          <button class="btn btn-secondary btn-sm" (click)="query.set('')">Show all listings</button>
        </app-empty-state>
      } @else if (!error()) {
        <app-empty-state icon="truck" title="No supplier listings yet"
                         text="When suppliers list products, you can compare their prices and order here." />
      }
    </div>

    @if (ordering(); as l) {
      <app-order-dialog [listing]="l" [items]="items()" [stockItemId]="linkFor(l)"
                        [recommendedUnits]="recommendedUnits" (closed)="ordering.set(null)" />
    }
  `,
  styles: [`
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
               flex-wrap: wrap; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--gray-100); }
    .best { margin-top: 2px; font-size: 11px; padding: 0 8px; line-height: 18px; }
    .area { margin-top: var(--space-1); font-size: 11px; line-height: 18px; padding: 0 8px; }
  `],
})
export class SuppliersComponent implements OnInit {
  private api = inject(InventoryApi);
  private route = inject(ActivatedRoute);

  listings = signal<Listing[]>([]);
  items = signal<StockItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');
  ordering = signal<Listing | null>(null);

  // from a stock item page
  private linkedItem: number | null = null;
  recommendedUnits: number | null = null;

  // partial, case-insensitive: "bread" finds "Albany Brown Bread 700g" (D39)
  shown = computed(() => this.listings().filter(l => matchesSearch(this.query(), l.productName, l.supplierName)));
  supplierCount = computed(() => new Set(this.shown().map(l => l.supplierId)).size);
  // the cheapest per-unit listing of each product, where more than one supplier lists it
  cheapest = computed(() => {
    const best = new Map<string, Listing[]>();
    for (const l of this.listings().filter(l => l.availableQuantity > 0)) best.set(l.productName, [...(best.get(l.productName) ?? []), l]);
    return new Set([...best.values()].filter(g => g.length > 1)
      .map(g => g.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a)).supplierListingId));
  });

  ngOnInit() {
    const p = this.route.snapshot.queryParamMap;
    this.query.set(p.get('q') ?? '');
    this.linkedItem = p.get('item') ? Number(p.get('item')) : null;
    this.recommendedUnits = p.get('qty') ? Number(p.get('qty')) : null;

    this.api.listings().subscribe({
      next: l => { this.listings.set(l); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
    this.api.stock().subscribe({ next: i => this.items.set(i) });
  }

  startOrder(l: Listing) { this.ordering.set(l); }

  // link the item this page was opened from, otherwise the owner's item with the same name
  linkFor(l: Listing) {
    return this.linkedItem
      ?? this.items().find(i => i.name.toLowerCase() === l.productName.toLowerCase())?.stockItemId ?? null;
  }
}
