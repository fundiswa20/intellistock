import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InventoryApi, REACH_LABEL, REACH_TONE, Reach, SupplierSummary, matchesSearch, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';

const GROUPS: { reach: Reach; title: string; text: string }[] = [
  { reach: 'inArea', title: 'In your area', text: 'They name your area in where they deliver.' },
  { reach: 'nearby', title: 'Nearby areas', text: 'They deliver elsewhere in your province. Check they come to you.' },
  { reach: 'unknown', title: 'Delivery area not confirmed', text: "We can't tell from their delivery area whether they reach you." },
];

// FR-06 / D42: the registered suppliers who can plausibly deliver to the owner, as cards.
// Suppliers serving only other provinces are left out by the API. Opening one shows its listings.
@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [FormsModule, RouterLink, PercentPipe, EmptyStateComponent, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>Suppliers</h1>
        <p class="subtitle">Suppliers who deliver to your area or nearby. Open one to see their price list and order.</p>
      </div>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (loading()) {
      <div class="card loading">Loading suppliers…</div>
    } @else if (suppliers().length) {
      <div class="toolbar">
        <div class="search">
          <app-icon name="search" [size]="16" />
          <input class="input" type="search" placeholder="Search suppliers or products, e.g. milk" [ngModel]="query()"
                 (ngModelChange)="query.set($event)" aria-label="Search suppliers or products" />
        </div>
        <span class="muted small">{{ shownCount() }} of {{ suppliers().length }} {{ suppliers().length === 1 ? 'supplier' : 'suppliers' }}</span>
      </div>

      @for (g of groups(); track g.reach) {
        <section class="group">
          <div class="group-head">
            <h2>{{ g.title }} <span class="count">{{ g.rows.length }}</span></h2>
            <p class="muted small">{{ g.text }}</p>
          </div>
          <div class="cards">
            @for (s of g.rows; track s.supplierId) {
              <a class="card supplier" [routerLink]="['/suppliers', s.supplierId]" [queryParams]="query() ? { q: query() } : {}">
                <div class="top">
                  <div class="name">{{ s.companyName }}</div>
                  <span class="pill" [class]="'pill ' + tone[s.reach]">{{ label[s.reach] }}</span>
                </div>
                <div class="cell-sub area"><app-icon name="truck" [size]="14" /> {{ s.deliveryArea || 'Delivery area not given' }}</div>
                <dl class="dl facts">
                  <dt>On time</dt><dd>{{ s.reliabilityScore | percent }}</dd>
                  <dt>Active listings</dt><dd>{{ s.activeListings }}</dd>
                  <dt>Lead time</dt><dd>{{ leadTime(s) }}</dd>
                </dl>
                @if (query() && productHits(s).length) {
                  <div class="hits">Lists {{ productHits(s).slice(0, 3).join(', ') }}{{ productHits(s).length > 3 ? '…' : '' }}</div>
                }
                <span class="open">View price list <app-icon name="chevron" [size]="14" /></span>
              </a>
            }
          </div>
        </section>
      }

      @if (!shownCount()) {
        <div class="card">
          <app-empty-state icon="search" title="No suppliers match"
                           [text]="'None of the suppliers near you is called or lists “' + query() + '”.'">
            <button class="btn btn-secondary btn-sm" (click)="query.set('')">Show all suppliers</button>
          </app-empty-state>
        </div>
      }
    } @else if (!error()) {
      <div class="card">
        <app-empty-state icon="truck" title="No suppliers deliver near you yet"
                         text="Suppliers appear here once one registers with a delivery area that reaches your location. You can still add products and record restocks you buy elsewhere.">
          <a class="btn btn-secondary btn-sm" routerLink="/settings">Check your location</a>
        </app-empty-state>
      </div>
    }
  `,
  styles: [`
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
               flex-wrap: wrap; margin-bottom: var(--space-5); }
    .group { margin-bottom: var(--space-6); }
    .group-head { margin-bottom: var(--space-3); }
    .group-head h2 { display: flex; align-items: center; gap: var(--space-2); }
    .count { font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); background: var(--gray-100);
             border-radius: 10px; padding: 1px 8px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-4); }
    .supplier { display: flex; flex-direction: column; gap: var(--space-2); text-decoration: none; color: inherit;
                transition: box-shadow var(--transition), border-color var(--transition); }
    .supplier:hover { box-shadow: var(--shadow), 0 0 0 2px var(--green-200); }
    .supplier:focus-visible { outline: 2px solid var(--green-500); outline-offset: 2px; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-2); }
    .name { font-weight: 700; font-size: var(--text-lg); }
    .area { display: flex; align-items: center; gap: var(--space-1); }
    .facts { font-size: var(--text-sm); margin: var(--space-2) 0; }
    .hits { font-size: var(--text-sm); color: var(--green-800); background: var(--green-50); border-radius: var(--radius);
            padding: var(--space-2) var(--space-3); }
    .open { margin-top: auto; display: inline-flex; align-items: center; gap: var(--space-1); font-weight: 600;
            font-size: var(--text-sm); color: var(--primary); }
  `],
})
export class SuppliersComponent implements OnInit {
  private api = inject(InventoryApi);
  private route = inject(ActivatedRoute);

  suppliers = signal<SupplierSummary[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  query = signal('');
  label = REACH_LABEL;
  tone = REACH_TONE;

  // partial, case-insensitive, on the company or any product it lists (D39)
  private shown = computed(() =>
    this.suppliers().filter(s => matchesSearch(this.query(), s.companyName) || this.productHits(s).length > 0 || !this.query().trim()));
  shownCount = computed(() => this.shown().length);
  groups = computed(() => GROUPS
    .map(g => ({ ...g, rows: this.shown().filter(s => s.reach === g.reach) }))
    .filter(g => g.rows.length));

  ngOnInit() {
    this.query.set(this.route.snapshot.queryParamMap.get('q') ?? '');
    this.api.suppliers().subscribe({
      next: s => { this.suppliers.set(s); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  productHits(s: SupplierSummary) {
    return this.query().trim() ? s.products.filter(p => matchesSearch(this.query(), p)) : [];
  }

  leadTime(s: SupplierSummary) {
    if (s.minLeadTimeDays == null) return '—';
    const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
    return s.minLeadTimeDays === s.maxLeadTimeDays ? days(s.minLeadTimeDays) : `${s.minLeadTimeDays}–${days(s.maxLeadTimeDays!)}`;
  }
}
