import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InventoryApi, StockItem, plural, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';

// FR-03 (read) and FR-05: the owner's stock, with low items flagged
@Component({
  selector: 'app-stock-list',
  standalone: true,
  imports: [FormsModule, EmptyStateComponent, IconComponent, MoneyPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Stock</h1>
        @if (items().length) {
          <p class="subtitle">{{ items().length }} products ·
            <span [class.low-count]="lowCount() > 0">{{ lowCount() }} at or below reorder level</span></p>
        }
      </div>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (loading()) {
      <div class="card loading">Loading stock…</div>
    } @else if (!error()) {
      <div class="card card-flush">
        <div class="toolbar">
          <div class="search">
            <app-icon name="search" [size]="16" />
            <input class="input" type="search" placeholder="Search products" [ngModel]="query()"
                   (ngModelChange)="query.set($event)" aria-label="Search products" />
          </div>
          <div class="segmented" role="group" aria-label="Filter">
            <button [class.active]="!lowOnly()" (click)="lowOnly.set(false)">All<span class="count">{{ items().length }}</span></button>
            <button [class.active]="lowOnly()" (click)="lowOnly.set(true)">Low stock<span class="count">{{ lowCount() }}</span></button>
          </div>
        </div>

        @if (shown().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th class="num">On hand</th>
                  <th class="num">Reorder level</th>
                  <th class="num">Selling price</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (item of shown(); track item.stockItemId) {
                  <tr class="clickable" (click)="open(item)">
                    <td>
                      <div class="cell-title">{{ item.name }}</div>
                      <div class="cell-sub">{{ item.category }} · per {{ item.unit }}</div>
                    </td>
                    <td class="num">
                      <span class="qty" [class.figure-danger]="item.isLow">{{ item.quantityOnHand }}</span>
                      <span class="cell-sub"> {{ plural(item.unit, item.quantityOnHand) }}</span>
                    </td>
                    <td class="num secondary">{{ item.reorderLevel }}</td>
                    <td class="num secondary">{{ item.sellingPrice | money }}</td>
                    <td>
                      @if (item.isLow) { <span class="pill pill-danger">Low stock</span> }
                      @else { <span class="pill pill-success">In stock</span> }
                    </td>
                    <td class="num chevron"><app-icon name="chevron" [size]="16" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (items().length) {
          <app-empty-state icon="search" [title]="lowOnly() && !query() ? 'Nothing is running low' : 'No products match'"
                           [text]="lowOnly() && !query() ? 'Every product is above its reorder level.' : 'Try a different search, or clear the filter.'"
                           [tone]="lowOnly() && !query() ? 'ok' : 'neutral'">
            <button class="btn btn-secondary btn-sm" (click)="query.set(''); lowOnly.set(false)">Show all products</button>
          </app-empty-state>
        } @else {
          <app-empty-state icon="stock" title="No products yet"
                           text="Products added to your shop appear here with their stock on hand and reorder level." />
        }
      </div>
    }
  `,
  styles: [`
    .low-count { color: var(--red-600); font-weight: 600; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
               flex-wrap: wrap; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--gray-100); }
    .chevron { color: var(--gray-400); width: 40px; }
  `],
})
export class StockListComponent implements OnInit {
  private api = inject(InventoryApi);
  private router = inject(Router);

  items = signal<StockItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');
  lowOnly = signal(false);
  lowCount = computed(() => this.items().filter(i => i.isLow).length);
  shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.items().filter(i => (!this.lowOnly() || i.isLow) && (!q || i.name.toLowerCase().includes(q)));
  });
  plural = plural;

  ngOnInit() {
    this.api.stock().subscribe({
      next: items => { this.items.set(items); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  open(item: StockItem) { this.router.navigate(['/stock', item.stockItemId]); }
}
