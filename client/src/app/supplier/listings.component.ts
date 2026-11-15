import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CATEGORIES, InventoryApi, LOW_PACKS, ListingInput, MyListing, matchesSearch, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';

const BLANK: ListingInput = {
  productName: '', category: 'Groceries', packSize: 1, packPrice: 0, leadTimeDays: 1,
  availableQuantity: 0, deliveryCost: 0, isActive: true,
};

// FR-07: the supplier's own price list - add, edit, hide
@Component({
  selector: 'app-listings',
  standalone: true,
  imports: [FormsModule, DatePipe, MoneyPipe, EmptyStateComponent, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>Listings</h1>
        <p class="subtitle">Your price list. Shops see active listings and order whole packs.</p>
      </div>
      <button class="btn btn-primary" (click)="edit(null)"><app-icon name="plus" [size]="16" /> New listing</button>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }
    @if (message()) { <div class="notice notice-success">{{ message() }}</div> }

    @if (loading()) {
      <div class="card loading">Loading listings…</div>
    } @else if (!error()) {
      <div class="card card-flush">
        @if (listings().length) {
          <div class="toolbar">
            <div class="search">
              <app-icon name="search" [size]="16" />
              <input class="input" type="search" placeholder="Search your listings" [ngModel]="query()"
                     (ngModelChange)="query.set($event)" aria-label="Search listings" />
            </div>
            <span class="muted small">{{ activeCount() }} active · {{ listings().length - activeCount() }} hidden</span>
          </div>
        }
        @if (shown().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Product</th><th class="num">Pack</th><th class="num">Pack price</th><th class="num">Per unit</th>
                  <th class="num">Available</th><th class="num">Lead time</th><th class="num">Delivery</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                @for (g of groups(); track g.title) {
                  @if (groups().length > 1 || g.low) {
                    <tr class="group" [class.group-low]="g.low"><td colspan="9">{{ g.title }} <span class="count">{{ g.rows.length }}</span></td></tr>
                  }
                  @for (l of g.rows; track l.supplierListingId) {
                  <tr>
                    <td><div class="cell-title">{{ l.productName }}</div><div class="cell-sub">{{ l.category }} · updated {{ l.updatedAt | date: 'd MMM' }}</div></td>
                    <td class="num secondary">{{ l.packSize }}</td>
                    <td class="num"><span class="qty">{{ l.packPrice | money }}</span></td>
                    <td class="num secondary">{{ l.unitPrice | money }}</td>
                    <td class="num">
                      @if (l.availableQuantity === 0) { <span class="pill pill-danger">Out of stock</span> }
                      @else { <span class="qty" [class.figure-danger]="isLow(l)">{{ l.availableQuantity }}</span> <span class="cell-sub">packs</span> }
                    </td>
                    <td class="num secondary nowrap">{{ l.leadTimeDays }} {{ l.leadTimeDays === 1 ? 'day' : 'days' }}</td>
                    <td class="num secondary">{{ l.deliveryCost | money }}</td>
                    <td>
                      @if (l.isActive) { <span class="pill pill-success">Active</span> }
                      @else { <span class="pill pill-muted">Hidden</span> }
                    </td>
                    <td class="num"><button class="btn btn-secondary btn-sm" (click)="edit(l)"><app-icon name="edit" [size]="14" /> Edit</button></td>
                  </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        } @else if (listings().length) {
          <app-empty-state icon="search" title="No listings match" text="Try a different search.">
            <button class="btn btn-secondary btn-sm" (click)="query.set('')">Show all listings</button>
          </app-empty-state>
        } @else {
          <app-empty-state icon="tag" title="No listings yet"
                           text="Add your products with their pack size, price and how many packs you have, so shops can order from you.">
            <button class="btn btn-primary btn-sm" (click)="edit(null)">Add your first listing</button>
          </app-empty-state>
        }
      </div>
    }

    @if (editing()) {
      <div class="modal-backdrop" (click)="close()">
        <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()" #f="ngForm" role="dialog" aria-labelledby="listing-title">
          <div class="modal-head">
            <h2 id="listing-title">{{ editingId ? 'Edit listing' : 'New listing' }}</h2>
            <button type="button" class="icon-btn" (click)="close()" aria-label="Close"><app-icon name="x" /></button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div class="field span-2">
                <label for="productName">Product</label>
                <input class="input" id="productName" name="productName" [(ngModel)]="form.productName" required minlength="2"
                       placeholder="e.g. Iwisa Super Maize Meal 5kg" />
              </div>
              <div class="field">
                <label for="category">Category</label>
                <select class="input" id="category" name="category" [(ngModel)]="form.category">
                  @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="packSize">Units per pack</label>
                <input class="input" id="packSize" name="packSize" type="number" min="1" [(ngModel)]="form.packSize" required />
              </div>
              <div class="field">
                <label for="packPrice">Pack price (R)</label>
                <input class="input" id="packPrice" name="packPrice" type="number" min="0" step="0.01" [(ngModel)]="form.packPrice" required />
                <span class="hint">{{ form.packSize > 0 ? (form.packPrice / form.packSize | money) : '—' }} per unit</span>
              </div>
              <div class="field">
                <label for="availableQuantity">Packs available</label>
                <input class="input" id="availableQuantity" name="availableQuantity" type="number" min="0" [(ngModel)]="form.availableQuantity" required />
              </div>
              <div class="field">
                <label for="leadTimeDays">Lead time (days)</label>
                <input class="input" id="leadTimeDays" name="leadTimeDays" type="number" min="0" [(ngModel)]="form.leadTimeDays" required />
              </div>
              <div class="field">
                <label for="deliveryCost">Delivery fee per order (R)</label>
                <input class="input" id="deliveryCost" name="deliveryCost" type="number" min="0" step="0.01" [(ngModel)]="form.deliveryCost" required />
              </div>
              <label class="check span-2">
                <input type="checkbox" name="isActive" [(ngModel)]="form.isActive" />
                <span><strong>Show to shops</strong><br><span class="muted small">Hidden listings keep their orders but can't be ordered.</span></span>
              </label>
            </div>
            @if (formError()) { <div class="notice notice-error" style="margin:0">{{ formError() }}</div> }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" (click)="close()">Cancel</button>
            <button type="submit" class="btn btn-primary" [disabled]="saving() || !f.valid">
              {{ saving() ? 'Saving…' : (editingId ? 'Save changes' : 'Add listing') }}
            </button>
          </div>
        </form>
      </div>
    }
  `,
  styles: [`
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
               flex-wrap: wrap; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--gray-100); }
    .group td { padding: var(--space-2) var(--space-5); background: var(--gray-50); font-size: var(--text-xs);
                font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
    .group-low td { background: var(--red-50); color: var(--red-700); }
    .group .count { margin-left: var(--space-2); font-weight: 600; }
    .check { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-3) var(--space-4);
             border-radius: var(--radius); background: var(--gray-50); cursor: pointer; line-height: 1.4; }
    .check input { width: 18px; height: 18px; margin-top: 1px; accent-color: var(--green-700); }
  `],
})
export class ListingsComponent implements OnInit {
  private api = inject(InventoryApi);

  listings = signal<MyListing[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  message = signal<string | null>(null);
  query = signal('');
  categories = CATEGORIES;

  editing = signal(false);
  editingId: number | null = null;
  form: ListingInput = { ...BLANK };
  saving = signal(false);
  formError = signal<string | null>(null);

  activeCount = computed(() => this.listings().filter(l => l.isActive).length);
  shown = computed(() => this.listings().filter(l => matchesSearch(this.query(), l.productName)));
  // listings at or below LOW_PACKS first, fewest packs first, like the owner's low stock
  isLow = (l: MyListing) => l.availableQuantity <= LOW_PACKS;
  groups = computed(() => {
    const low = this.shown().filter(this.isLow).sort((a, b) => a.availableQuantity - b.availableQuantity);
    const rest = this.shown().filter(l => !this.isLow(l));
    return [
      { title: 'Needs restocking', low: true, rows: low },
      { title: 'All other listings', low: false, rows: rest },
    ].filter(g => g.rows.length);
  });

  ngOnInit() { this.load(); }

  load() {
    this.api.myListings().subscribe({
      next: l => { this.listings.set(l); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  edit(l: MyListing | null) {
    this.formError.set(null);
    this.editingId = l?.supplierListingId ?? null;
    this.form = l
      ? { productName: l.productName, category: l.category, packSize: l.packSize, packPrice: l.packPrice,
          leadTimeDays: l.leadTimeDays, availableQuantity: l.availableQuantity, deliveryCost: l.deliveryCost, isActive: l.isActive }
      : { ...BLANK };
    this.editing.set(true);
  }

  close() { this.editing.set(false); }

  save() {
    this.saving.set(true);
    this.formError.set(null);
    const body = { ...this.form, packSize: Number(this.form.packSize), packPrice: Number(this.form.packPrice),
      leadTimeDays: Number(this.form.leadTimeDays), availableQuantity: Number(this.form.availableQuantity),
      deliveryCost: Number(this.form.deliveryCost) };
    const call = this.editingId ? this.api.updateListing(this.editingId, body) : this.api.createListing(body);
    call.subscribe({
      next: l => {
        this.message.set(`${this.editingId ? 'Saved' : 'Added'} ${l.productName}.`);
        this.saving.set(false);
        this.editing.set(false);
        this.load();
      },
      error: err => { this.formError.set(problemText(err)); this.saving.set(false); },
    });
  }
}
