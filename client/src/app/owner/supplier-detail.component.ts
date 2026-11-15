import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InventoryApi, Listing, REACH_LABEL, REACH_TONE, StockItem, SupplierDetail, matchesSearch, problemText, sameProduct } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';
import { OrderDialogComponent } from '../shared/order-dialog.component';

// FR-06 / D42: one supplier's active listings, and ordering from them (FR-10)
@Component({
  selector: 'app-supplier-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, PercentPipe, MoneyPipe, EmptyStateComponent, IconComponent, OrderDialogComponent],
  template: `
    <a class="back-link" routerLink="/suppliers"><app-icon name="back" [size]="16" /> All suppliers</a>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (supplier(); as s) {
      <div class="page-head">
        <div>
          <div class="title-row">
            <h1>{{ s.companyName }}</h1>
            <span class="pill" [class]="'pill ' + tone[s.reach]">{{ label[s.reach] }}</span>
          </div>
          <p class="subtitle">Delivers to {{ s.deliveryArea || 'an area they have not given' }} · {{ s.reliabilityScore | percent }} on time
            @if (s.phone) { · {{ s.phone }} }</p>
        </div>
      </div>

      <div class="card card-flush">
        <div class="toolbar">
          <div class="search">
            <app-icon name="search" [size]="16" />
            <input class="input" type="search" placeholder="Search this price list" [ngModel]="query()"
                   (ngModelChange)="query.set($event)" aria-label="Search listings" />
          </div>
          <span class="muted small">{{ shown().length }} of {{ s.listings.length }} {{ s.listings.length === 1 ? 'listing' : 'listings' }}</span>
        </div>

        @if (shown().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>Product</th><th class="num">Pack</th><th class="num">Pack price</th><th class="num">Per unit</th>
                  <th class="num">Delivery</th><th class="num">Lead time</th><th class="num">Available</th><th></th></tr>
              </thead>
              <tbody>
                @for (l of shown(); track l.supplierListingId) {
                  <tr>
                    <td><div class="cell-title">{{ l.productName }}</div><div class="cell-sub">{{ l.category }}</div></td>
                    <td class="num secondary">{{ l.packSize }}</td>
                    <td class="num">{{ l.packPrice | money }}</td>
                    <td class="num"><span class="qty">{{ l.unitPrice | money }}</span></td>
                    <td class="num secondary">{{ l.deliveryCost | money }}</td>
                    <td class="num secondary nowrap">{{ l.leadTimeDays }} {{ l.leadTimeDays === 1 ? 'day' : 'days' }}</td>
                    <td class="num">
                      @if (l.availableQuantity > 0) { <span class="tabular">{{ l.availableQuantity }}</span> <span class="cell-sub">packs</span> }
                      @else { <span class="pill pill-danger">Out of stock</span> }
                    </td>
                    <td class="num"><button class="btn btn-primary btn-sm" [disabled]="l.availableQuantity === 0" (click)="ordering.set(l)">Order</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (s.listings.length) {
          <app-empty-state icon="search" title="Nothing matches" [text]="s.companyName + ' lists nothing matching “' + query() + '”.'">
            <button class="btn btn-secondary btn-sm" (click)="query.set('')">Show their whole list</button>
          </app-empty-state>
        } @else {
          <app-empty-state icon="tag" title="No active listings"
                           [text]="s.companyName + ' has not listed any products yet. Try another supplier.'">
            <a class="btn btn-secondary btn-sm" routerLink="/suppliers">All suppliers</a>
          </app-empty-state>
        }
      </div>

      @if (ordering(); as l) {
        <app-order-dialog [listing]="l" [items]="items()" [stockItemId]="linkFor(l)" (closed)="ordering.set(null)" />
      }
    } @else if (!error()) {
      <div class="card loading">Loading supplier…</div>
    }
  `,
  styles: [`
    .title-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
               flex-wrap: wrap; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--gray-100); }
  `],
})
export class SupplierDetailComponent implements OnInit {
  private api = inject(InventoryApi);
  private route = inject(ActivatedRoute);

  @Input() id!: string;

  supplier = signal<SupplierDetail | null>(null);
  items = signal<StockItem[]>([]);
  error = signal<string | null>(null);
  query = signal('');
  ordering = signal<Listing | null>(null);
  label = REACH_LABEL;
  tone = REACH_TONE;

  shown = computed(() => (this.supplier()?.listings ?? []).filter(l => matchesSearch(this.query(), l.productName)));

  ngOnInit() {
    this.query.set(this.route.snapshot.queryParamMap.get('q') ?? '');
    this.api.supplier(Number(this.id)).subscribe({
      next: s => this.supplier.set(s),
      error: err => this.error.set(err.status === 404 ? 'This supplier does not exist.' : problemText(err)),
    });
    this.api.stock().subscribe({ next: i => this.items.set(i) });
  }

  // the owner's item for this product: the same name, otherwise the only one that matches
  linkFor(l: Listing) {
    const exact = this.items().find(i => i.name.toLowerCase() === l.productName.toLowerCase());
    if (exact) return exact.stockItemId;
    const similar = this.items().filter(i => sameProduct(i.name, l.productName));
    return similar.length === 1 ? similar[0].stockItemId : null;
  }
}
