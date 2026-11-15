import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CATEGORIES, InventoryApi, StockItem, plural, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';
import { AddProductWizardComponent } from './add-product-wizard.component';

// FR-03 (read) and FR-05: the owner's stock, with low items flagged
@Component({
  selector: 'app-stock-list',
  standalone: true,
  imports: [FormsModule, EmptyStateComponent, IconComponent, MoneyPipe, AddProductWizardComponent],
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
          <button type="button" class="btn btn-primary add" (click)="wizard.set(true)"><app-icon name="plus" [size]="16" /> Add product</button>
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
                           text="Products added to your shop appear here with their stock on hand and reorder level.">
            <button type="button" class="btn btn-primary btn-sm" (click)="wizard.set(true)"><app-icon name="plus" [size]="14" /> Add product</button>
          </app-empty-state>
        }
      </div>
    }

    <!-- FR-03 create. Opened with ?new=<product name>&order=<id> from an order that has no item to book into -->
    <!-- D42: a product not stocked yet is found, priced and ordered in one flow -->
    @if (wizard()) {
      <app-add-product-wizard [items]="items()" (closed)="wizard.set(false)"
                              (plain)="wizard.set(false); startNew($event)" />
    }

    @if (creating()) {
      <div class="modal-backdrop" (click)="creating.set(false)">
        <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="create()" #f="ngForm" role="dialog" aria-labelledby="new-title">
          <div class="modal-head">
            <div>
              <h2 id="new-title">Add product</h2>
              @if (forOrder) { <p class="muted small">Then you can book order #{{ forOrder }} into it.</p> }
            </div>
            <button type="button" class="icon-btn" (click)="creating.set(false)" aria-label="Close"><app-icon name="x" /></button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="field span-2">
                <label for="name">Product name</label>
                <input class="input" id="name" name="name" [(ngModel)]="form.name" required minlength="2" maxlength="120" />
              </div>
              <div class="field">
                <label for="category">Category</label>
                <select class="input" id="category" name="category" [(ngModel)]="form.category">
                  @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="unit">Sold per</label>
                <input class="input" id="unit" name="unit" [(ngModel)]="form.unit" required maxlength="30" placeholder="e.g. each, carton, loaf" />
              </div>
              <div class="field">
                <label for="reorderLevel">Reorder level</label>
                <input class="input" id="reorderLevel" name="reorderLevel" type="number" min="0" [(ngModel)]="form.reorderLevel" required />
                <span class="hint">An alert is raised at or below this.</span>
              </div>
              <div class="field">
                <label for="openingQuantity">On hand now</label>
                <input class="input" id="openingQuantity" name="openingQuantity" type="number" min="0" [(ngModel)]="form.openingQuantity" required />
                <span class="hint">Before this delivery.</span>
              </div>
              <div class="field">
                <label for="unitCost">Unit cost (R)</label>
                <input class="input" id="unitCost" name="unitCost" type="number" min="0" step="0.01" [(ngModel)]="form.unitCost" required />
              </div>
              <div class="field">
                <label for="sellingPrice">Selling price (R)</label>
                <input class="input" id="sellingPrice" name="sellingPrice" type="number" min="0" step="0.01" [(ngModel)]="form.sellingPrice" required />
              </div>
            </div>
            @if (formError()) { <div class="notice notice-error" style="margin:0">{{ formError() }}</div> }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" (click)="creating.set(false)">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving() || !f.valid">{{ saving() ? 'Saving…' : 'Add product' }}</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: [`
    .low-count { color: var(--red-600); font-weight: 600; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
               flex-wrap: wrap; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--gray-100); }
    .add { margin-left: auto; }
    .chevron { color: var(--gray-400); width: 40px; }
  `],
})
export class StockListComponent implements OnInit {
  private api = inject(InventoryApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  categories = CATEGORIES;

  creating = signal(false);
  wizard = signal(false);
  saving = signal(false);
  formError = signal<string | null>(null);
  forOrder: number | null = null;
  form = { name: '', category: 'Groceries', unit: 'each', reorderLevel: 5, openingQuantity: 0, unitCost: 0, sellingPrice: 0 };

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
    const p = this.route.snapshot.queryParamMap;
    // ?new=<name>&order=<id>: an order already placed needs an item to be booked into, so the
    // plain form; ?new= alone (from an empty state) opens the find-and-order flow
    if (p.get('new')) {
      this.forOrder = p.get('order') ? Number(p.get('order')) : null;
      this.startNew(p.get('new') ?? '');
    } else if (p.has('new')) {
      this.wizard.set(true);
    }
    this.api.stock().subscribe({
      next: items => { this.items.set(items); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  startNew(name: string) {
    this.form = { name, category: 'Groceries', unit: 'each', reorderLevel: 5, openingQuantity: 0, unitCost: 0, sellingPrice: 0 };
    this.formError.set(null);
    this.creating.set(true);
  }

  // back to the order it was created for, otherwise to the new item
  create() {
    this.saving.set(true);
    this.formError.set(null);
    const f = this.form;
    this.api.createItem({
      name: f.name.trim(), category: f.category, unit: f.unit.trim(), reorderLevel: Number(f.reorderLevel),
      unitCost: Number(f.unitCost), sellingPrice: Number(f.sellingPrice), openingQuantity: Number(f.openingQuantity),
    }).subscribe({
      next: item => this.router.navigate(this.forOrder ? ['/orders', this.forOrder] : ['/stock', item.stockItemId]),
      error: err => { this.formError.set(problemText(err)); this.saving.set(false); },
    });
  }

  open(item: StockItem) { this.router.navigate(['/stock', item.stockItemId]); }
}
