import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InventoryApi, Listing, StockItem, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';

// FR-06: every supplier's active listings, cheapest per unit first, and placing an order (FR-10).
// Opened from a stock item as /suppliers?q=<name>&item=<id>&qty=<recommended units>.
@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [FormsModule, PercentPipe, MoneyPipe, EmptyStateComponent, IconComponent],
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

    <!-- place an order -->
    @if (ordering(); as l) {
      <div class="modal-backdrop" (click)="ordering.set(null)">
        <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="place(l)" role="dialog" aria-labelledby="order-title">
          <div class="modal-head">
            <div>
              <h2 id="order-title">Order {{ l.productName }}</h2>
              <p class="muted small">from {{ l.supplierName }} · packs of {{ l.packSize }} · {{ l.leadTimeDays }}-day lead time</p>
            </div>
            <button type="button" class="icon-btn" (click)="ordering.set(null)" aria-label="Close"><app-icon name="x" /></button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="field">
                <label for="packs">Packs</label>
                <input class="input" id="packs" name="packs" type="number" min="1" [max]="l.availableQuantity"
                       [(ngModel)]="packs" required />
                <span class="hint">{{ l.availableQuantity }} available · {{ (packs || 0) * l.packSize }} units</span>
              </div>
              <div class="field">
                <label for="item">Book into stock item</label>
                <select class="input" id="item" name="item" [(ngModel)]="stockItemId">
                  <option [ngValue]="null">Not linked</option>
                  @for (i of items(); track i.stockItemId) { <option [ngValue]="i.stockItemId">{{ i.name }}</option> }
                </select>
                <span class="hint">On delivery, the units are added to this item.</span>
              </div>
              <div class="field span-2">
                <label for="note">Note to the supplier <span class="muted">(optional)</span></label>
                <input class="input" id="note" name="note" [(ngModel)]="note" maxlength="255" />
              </div>
            </div>

            @if (suggestedPacks(); as s) {
              <div class="notice notice-accent hint-box">
                <app-icon name="trend" [size]="16" />
                <span>The forecast recommends {{ recommendedUnits }} units: {{ s }} {{ s === 1 ? 'pack' : 'packs' }} of {{ l.packSize }}.</span>
              </div>
            }

            <div class="summary">
              <dl class="dl">
                <dt>{{ packs || 0 }} × {{ l.packPrice | money }}</dt><dd>{{ (packs || 0) * l.packPrice | money }}</dd>
                <dt>Delivery</dt><dd>{{ l.deliveryCost | money }}</dd>
              </dl>
              <div class="total">
                <span class="label">Delivered cost</span>
                <span class="figure">{{ (packs || 0) * l.packPrice + l.deliveryCost | money }}</span>
              </div>
            </div>

            @if (orderError()) { <div class="notice notice-error" style="margin:0">{{ orderError() }}</div> }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" (click)="ordering.set(null)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="placing() || !packs || packs < 1 || packs > l.availableQuantity">
              {{ placing() ? 'Placing order…' : 'Place order' }}
            </button>
          </div>
        </form>
      </div>
    }
  `,
  styles: [`
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
               flex-wrap: wrap; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--gray-100); }
    .best { margin-top: 2px; font-size: 11px; padding: 0 8px; line-height: 18px; }
    .summary { display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius); background: var(--gray-50); }
    .total { display: flex; justify-content: space-between; align-items: baseline; padding-top: var(--space-3);
             border-top: 1px solid var(--gray-200); }
    .hint-box { margin: 0; align-items: center; }
  `],
})
export class SuppliersComponent implements OnInit {
  private api = inject(InventoryApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  listings = signal<Listing[]>([]);
  items = signal<StockItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');

  ordering = signal<Listing | null>(null);
  packs: number | null = 1;
  stockItemId: number | null = null;
  note = '';
  placing = signal(false);
  orderError = signal<string | null>(null);

  // from a stock item page
  private linkedItem: number | null = null;
  recommendedUnits: number | null = null;

  shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.listings().filter(l => !q || l.productName.toLowerCase().includes(q) || l.supplierName.toLowerCase().includes(q));
  });
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

  suggestedPacks() {
    const l = this.ordering();
    return l && this.recommendedUnits ? Math.max(1, Math.ceil(this.recommendedUnits / l.packSize)) : null;
  }

  startOrder(l: Listing) {
    this.orderError.set(null);
    this.note = '';
    // link the item this page was opened from, otherwise the owner's item with the same name
    this.stockItemId = this.linkedItem
      ?? this.items().find(i => i.name.toLowerCase() === l.productName.toLowerCase())?.stockItemId ?? null;
    this.ordering.set(l);
    this.packs = Math.min(this.suggestedPacks() ?? 1, l.availableQuantity);
  }

  place(l: Listing) {
    this.placing.set(true);
    this.orderError.set(null);
    this.api.placeOrder({
      supplierListingId: l.supplierListingId, packs: Number(this.packs), stockItemId: this.stockItemId,
      note: this.note.trim() || null,
    }).subscribe({
      next: o => this.router.navigate(['/orders', o.purchaseOrderId], { queryParams: { placed: 1 } }),
      error: err => { this.orderError.set(problemText(err)); this.placing.set(false); },
    });
  }
}
