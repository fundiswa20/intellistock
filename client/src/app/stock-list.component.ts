import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { InventoryApi, StockItem, plural, problemText } from './api';

// FR-03 (read) and FR-05: the owner's stock, with low items flagged
@Component({
  selector: 'app-stock-list',
  standalone: true,
  template: `
    <div class="heading">
      <div>
        <h1>Stock</h1>
        @if (items().length) {
          <p class="muted">{{ items().length }} products ·
            <span [class.low-count]="lowCount() > 0">{{ lowCount() }} at or below reorder level</span></p>
        }
      </div>
    </div>

    @if (error()) { <div class="error">{{ error() }}</div> }
    @if (loading()) { <div class="card empty muted">Loading stock…</div> }

    @if (items().length) {
      <div class="card table-card">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th class="num">On hand</th>
              <th class="num">Reorder level</th>
              <th>Status</th>
            </tr>
          </thead>
          @for (group of groups(); track group.title) {
            <tbody>
              <tr class="group" [id]="group.id">
                <th colspan="4">{{ group.title }} ({{ group.items.length }})</th>
              </tr>
              @for (item of group.items; track item.stockItemId) {
                <tr class="clickable" [class.row-low]="item.isLow" (click)="open(item)">
                  <td>
                    <div class="name">{{ item.name }}</div>
                    <div class="muted small">{{ item.category }} · R {{ item.sellingPrice.toFixed(2) }}</div>
                  </td>
                  <td class="num strong">{{ item.quantityOnHand }} <span class="muted small">{{ plural(item.unit, item.quantityOnHand) }}</span></td>
                  <td class="num">{{ item.reorderLevel }}</td>
                  <td>
                    @if (item.isLow) { <span class="badge badge-low">Low stock</span> }
                    @else { <span class="badge badge-ok">In stock</span> }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="muted small">Nothing at or below its reorder level.</td></tr>
              }
            </tbody>
          }
        </table>
      </div>
    }
  `,
  styles: [`
    .heading { display: flex; align-items: flex-end; margin-bottom: 18px; }
    h1 { margin: 0 0 4px; }
    .heading p { margin: 0; }
    .low-count { color: var(--danger); font-weight: 600; }
    .name { font-weight: 600; }
    .small { font-size: 12.5px; }
    .strong { font-weight: 700; }
    .row-low td:first-child { box-shadow: inset 4px 0 0 var(--danger); }
    .group th { background: var(--bg); color: var(--ink); font-size: 13px; text-transform: none; letter-spacing: 0;
                border-top: 1px solid var(--line); scroll-margin-top: 16px; }
    tbody:first-of-type .group th { color: var(--danger); }
  `],
})
export class StockListComponent implements OnInit {
  private api = inject(InventoryApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  items = signal<StockItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  lowCount = computed(() => this.items().filter(i => i.isLow).length);
  // FR-05: items at or below their reorder level first, each group still alphabetical
  groups = computed(() => [
    { id: 'needs-attention', title: 'Needs attention', items: this.items().filter(i => i.isLow) },
    { id: 'in-stock', title: 'In stock', items: this.items().filter(i => !i.isLow) },
  ]);
  plural = plural;

  ngOnInit() {
    this.api.stock().subscribe({
      next: items => { this.items.set(items); this.loading.set(false); this.scrollTo(this.route.snapshot.fragment); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
    // the header's "Alerts" link is /stock#needs-attention, also clicked while already here
    this.route.fragment.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(f => this.scrollTo(f));
  }

  private scrollTo(fragment: string | null) {
    if (fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView({ behavior: 'smooth' }));
  }

  open(item: StockItem) { this.router.navigate(['/stock', item.stockItemId]); }
}
