import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CATEGORIES, InventoryApi, ListingSearch, REACH_LABEL, REACH_TONE, SearchOption, StockItem, problemText, sameProduct } from '../api';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';

// the suggested selling price: cost plus this markup, rounded up to end in .99
export const MARKUP = 0.25;

export function suggestedPrice(unitCost: number): number {
  const target = unitCost * (1 + MARKUP);
  return Math.ceil(target + 0.01) - 0.01;
}

// D42: adding a product the shop does not stock yet is one flow -
//   1. say what you need and see who near you sells it, cheapest delivered first
//   2. pick a supplier and quantity; the unit cost is theirs, the selling price is suggested
//   3. confirm: the stock item is created at zero and the order placed, in one call
// When nobody lists it, the owner adds the item on its own (the plain form).
@Component({
  selector: 'app-add-product-wizard',
  standalone: true,
  imports: [FormsModule, RouterLink, DecimalPipe, PercentPipe, MoneyPipe, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <div class="modal wide" (click)="$event.stopPropagation()" role="dialog" aria-labelledby="wizard-title">
        <div class="modal-head">
          <div>
            <h2 id="wizard-title">Add product</h2>
            <ol class="steps" aria-label="Steps">
              @for (s of stepNames; track s; let i = $index) {
                <li [class.on]="step() === i + 1" [class.done]="step() > i + 1">{{ i + 1 }}. {{ s }}</li>
              }
            </ol>
          </div>
          <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Close"><app-icon name="x" /></button>
        </div>

        <!-- step 1: what do you need -->
        @if (step() === 1) {
          <div class="modal-body">
            <form class="find" (ngSubmit)="search()">
              <div class="field grow">
                <label for="need">What do you need?</label>
                <input class="input" id="need" name="need" [(ngModel)]="term" placeholder="e.g. milk, maize meal, candles"
                       autocomplete="off" required minlength="2" />
              </div>
              <button class="btn btn-primary" type="submit" [disabled]="searching() || term.trim().length < 2">
                {{ searching() ? 'Searching…' : 'Find suppliers' }}</button>
            </form>

            @if (error()) { <div class="notice notice-error" style="margin:0">{{ error() }}</div> }

            @if (alreadyStocked().length) {
              <div class="notice notice-accent" style="margin:0">
                <span>You already stock
                  @for (i of alreadyStocked(); track i.stockItemId; let last = $last) {
                    <a [routerLink]="['/stock', i.stockItemId]" (click)="closed.emit()">{{ i.name }}</a>{{ last ? '' : ', ' }}
                  }. To restock it, order from its page.</span>
              </div>
            }

            @if (result(); as r) {
              @if (r.options.length) {
                <p class="muted small">{{ r.options.length }} {{ r.options.length === 1 ? 'listing' : 'listings' }} from suppliers who reach you,
                  priced for {{ r.unitsWanted }} units delivered, cheapest first.</p>
                <div class="options">
                  @for (o of r.options; track o.supplierListingId; let i = $index) {
                    <button type="button" class="option" [class.top]="i === 0 && o.canFulfil" (click)="pick(o)" [disabled]="o.availableQuantity === 0">
                      <div class="o-main">
                        <div class="o-tags">
                          @if (i === 0 && o.canFulfil) { <span class="pill pill-solid pill-plain">Recommended</span> }
                          <span class="pill" [class]="'pill ' + tone[o.reach ?? 'unknown']">{{ label[o.reach ?? 'unknown'] }}</span>
                        </div>
                        <div class="o-name">{{ o.supplierName }}</div>
                        <div class="cell-sub">{{ o.productName }} · packs of {{ o.packSize }} · {{ o.leadTimeDays }}-day lead time ·
                          {{ o.reliabilityScore | percent }} on time</div>
                      </div>
                      <div class="o-cost">
                        <div class="figure" [class.figure-lg]="i === 0 && o.canFulfil">{{ o.total | money }}</div>
                        <div class="cell-sub">{{ o.unitPrice | money }} per unit + {{ o.deliveryCost | money }} delivery</div>
                        @if (!o.canFulfil) { <div class="cell-sub warn">{{ o.availableQuantity === 0 ? 'Out of stock' : 'Only ' + o.availableQuantity + ' packs' }}</div> }
                      </div>
                    </button>
                  }
                </div>
              } @else {
                <div class="none">
                  <app-icon name="truck" [size]="20" />
                  <div>
                    <strong>No supplier near you lists “{{ r.searchTerm }}”.</strong>
                    <p class="muted small">You can still add it to your stock and record restocks you buy elsewhere.</p>
                  </div>
                </div>
              }
            }
          </div>
          <div class="modal-foot spread">
            <button type="button" class="btn btn-text" (click)="plain.emit(term.trim())">Add without ordering</button>
            @if (result()?.options?.length === 0) {
              <button type="button" class="btn btn-primary" (click)="plain.emit(term.trim())">Add “{{ term.trim() }}” to stock</button>
            }
          </div>
        }

        <!-- step 2: supplier, quantity and price -->
        @if (step() === 2 && chosen(); as o) {
          <form class="modal-body" #f="ngForm" (ngSubmit)="step.set(3)" id="details">
            <div class="chosen">
              <div><div class="strong">{{ o.supplierName }}</div>
                <div class="cell-sub">{{ o.productName }} · packs of {{ o.packSize }} · {{ o.leadTimeDays }}-day lead time</div></div>
              <button type="button" class="btn btn-text btn-sm" (click)="step.set(1)">Change</button>
            </div>
            <div class="form-grid">
              <div class="field span-2">
                <label for="name">Product name in your stock</label>
                <input class="input" id="name" name="name" [(ngModel)]="form.name" required minlength="2" maxlength="120" />
              </div>
              <div class="field">
                <label for="packs">Packs to order</label>
                <input class="input" id="packs" name="packs" type="number" min="1" [max]="o.availableQuantity" [(ngModel)]="form.packs" required />
                <span class="hint">{{ units() }} units · {{ o.availableQuantity }} packs available</span>
              </div>
              <div class="field">
                <label for="unit">Sold per</label>
                <input class="input" id="unit" name="unit" [(ngModel)]="form.unit" required maxlength="30" placeholder="e.g. each, carton, loaf" />
              </div>
              <div class="field">
                <label for="category">Category</label>
                <select class="input" id="category" name="category" [(ngModel)]="form.category">
                  @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="reorderLevel">Reorder level</label>
                <input class="input" id="reorderLevel" name="reorderLevel" type="number" min="0" [(ngModel)]="form.reorderLevel" required />
                <span class="hint">An alert is raised at or below this.</span>
              </div>
              <div class="field">
                <label for="cost">Unit cost</label>
                <input class="input" id="cost" [value]="(o.unitPrice | money)" readonly />
                <span class="hint">{{ o.packPrice | money }} a pack of {{ o.packSize }}, from this listing</span>
              </div>
              <div class="field">
                <label for="sellingPrice">Selling price (R)</label>
                <input class="input" id="sellingPrice" name="sellingPrice" type="number" min="0" step="0.01" [(ngModel)]="form.sellingPrice" required />
                <span class="hint" [class.warn]="margin() <= 0">
                  @if (margin() > 0) { {{ margin() | percent: '1.0-0' }} margin · {{ form.sellingPrice - o.unitPrice | money }} a unit }
                  @else { Below cost: you would lose {{ o.unitPrice - form.sellingPrice | money }} a unit }
                  @if (form.sellingPrice !== suggested()) { · <button type="button" class="link" (click)="form.sellingPrice = suggested()">use {{ suggested() | money }}</button> }
                </span>
              </div>
            </div>
            <p class="muted small">Suggested price is cost plus {{ markup | percent }}, rounded to end in 99c.</p>
          </form>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" (click)="step.set(1)">Back</button>
            <button type="submit" form="details" class="btn btn-primary" [disabled]="!detailsValid()">Review</button>
          </div>
        }

        <!-- step 3: confirm -->
        @if (step() === 3 && chosen(); as o) {
          <div class="modal-body">
            <div class="review">
              <section>
                <h3>New stock item</h3>
                <dl class="dl">
                  <dt>Name</dt><dd>{{ form.name }}</dd>
                  <dt>On hand now</dt><dd>0 — the delivery adds {{ units() }}</dd>
                  <dt>Unit cost</dt><dd>{{ o.unitPrice | money }}</dd>
                  <dt>Selling price</dt><dd>{{ form.sellingPrice | money }} ({{ margin() | percent: '1.0-0' }} margin)</dd>
                  <dt>Reorder level</dt><dd>{{ form.reorderLevel }}</dd>
                </dl>
              </section>
              <section>
                <h3>Order</h3>
                <dl class="dl">
                  <dt>Supplier</dt><dd>{{ o.supplierName }}</dd>
                  <dt>{{ form.packs }} × {{ o.packPrice | money }}</dt><dd>{{ form.packs * o.packPrice | money }}</dd>
                  <dt>Delivery</dt><dd>{{ o.deliveryCost | money }}</dd>
                  <dt class="strong">Delivered cost</dt><dd class="strong">{{ form.packs * o.packPrice + o.deliveryCost | money }}</dd>
                  <dt>Lead time</dt><dd>{{ o.leadTimeDays }} {{ o.leadTimeDays === 1 ? 'day' : 'days' }}</dd>
                </dl>
              </section>
            </div>
            <div class="field">
              <label for="note">Note to the supplier <span class="muted">(optional)</span></label>
              <input class="input" id="note" name="note" [(ngModel)]="form.note" maxlength="255" />
            </div>
            <p class="muted small">The item starts at zero. Its stock arrives when you receive the delivery on the order.</p>
            @if (error()) { <div class="notice notice-error" style="margin:0">{{ error() }}</div> }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" (click)="step.set(2)">Back</button>
            <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="confirm(o)">
              {{ saving() ? 'Placing order…' : 'Add product and place order' }}</button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .wide { max-width: 720px; width: 100%; }
    .steps { display: flex; gap: var(--space-3); list-style: none; margin: var(--space-1) 0 0; padding: 0;
             font-size: var(--text-xs); color: var(--text-muted); flex-wrap: wrap; }
    .steps .on { color: var(--green-800); font-weight: 700; }
    .steps .done { color: var(--green-700); }
    .find { display: flex; gap: var(--space-3); align-items: flex-end; }
    .grow { flex: 1; }
    .options { display: grid; gap: var(--space-2); max-height: 420px; overflow: auto; }
    .option { display: flex; justify-content: space-between; gap: var(--space-4); text-align: left; width: 100%;
              padding: var(--space-3) var(--space-4); border: 1px solid var(--border); border-radius: var(--radius);
              background: var(--surface); cursor: pointer; font: inherit; color: inherit; }
    .option:hover:not(:disabled) { border-color: var(--green-500); background: var(--green-50); }
    .option:disabled { opacity: .55; cursor: not-allowed; }
    .option.top { border: 2px solid var(--green-600); background: var(--green-50); }
    .o-tags { display: flex; gap: var(--space-2); margin-bottom: var(--space-1); flex-wrap: wrap; }
    .o-name { font-weight: 700; }
    .o-cost { text-align: right; flex: none; }
    .top .o-cost .figure { color: var(--green-800); }
    .warn { color: var(--red-700) !important; }
    .none { display: flex; gap: var(--space-3); align-items: flex-start; padding: var(--space-4); border-radius: var(--radius);
            background: var(--gray-50); }
    .spread { justify-content: space-between; }
    .chosen { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3);
              padding: var(--space-3) var(--space-4); border-radius: var(--radius); background: var(--green-50); }
    .link { background: none; border: 0; padding: 0; font: inherit; color: var(--primary); text-decoration: underline; cursor: pointer; }
    .review { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }
    .review h3 { font-size: var(--text-sm); margin-bottom: var(--space-2); }
    @media (max-width: 640px) { .review, .find { grid-template-columns: 1fr; flex-direction: column; align-items: stretch; } }
  `],
})
export class AddProductWizardComponent {
  private api = inject(InventoryApi);
  private router = inject(Router);

  @Input() items: StockItem[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() plain = new EventEmitter<string>();   // add without ordering, with what was typed

  stepNames = ['Find it', 'Price and quantity', 'Confirm'];
  categories = CATEGORIES;
  label = REACH_LABEL;
  tone = REACH_TONE;
  markup = MARKUP;

  step = signal(1);
  term = '';
  searchedTerm = signal('');
  searching = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  result = signal<ListingSearch | null>(null);
  chosen = signal<SearchOption | null>(null);
  form = { name: '', unit: 'each', category: 'Groceries', packs: 1, reorderLevel: 1, sellingPrice: 0, note: '' };

  alreadyStocked = computed(() =>
    this.searchedTerm() ? this.items.filter(i => sameProduct(i.name, this.searchedTerm())) : []);
  suggested = computed(() => (this.chosen() ? suggestedPrice(this.chosen()!.unitPrice) : 0));

  units() { return (Number(this.form.packs) || 0) * (this.chosen()?.packSize ?? 0); }
  margin() {
    const cost = this.chosen()?.unitPrice ?? 0;
    const sell = Number(this.form.sellingPrice) || 0;
    return sell > 0 ? (sell - cost) / sell : -1;
  }
  detailsValid() {
    const o = this.chosen();
    return !!o && this.form.name.trim().length >= 2 && this.form.unit.trim().length > 0
      && this.form.packs >= 1 && this.form.packs <= o.availableQuantity && this.form.reorderLevel >= 0 && this.form.sellingPrice >= 0;
  }

  search() {
    const q = this.term.trim();
    this.searching.set(true);
    this.error.set(null);
    this.api.searchListings(q).subscribe({
      next: r => { this.result.set(r); this.searchedTerm.set(q); this.searching.set(false); },
      error: err => { this.error.set(problemText(err)); this.searching.set(false); },
    });
  }

  pick(o: SearchOption) {
    this.chosen.set(o);
    this.form = {
      name: o.productName, unit: 'each', category: CATEGORIES.includes(o.category) ? o.category : 'Groceries',
      packs: Math.min(Math.max(1, o.packs), o.availableQuantity), reorderLevel: Math.max(1, Math.round(o.packSize / 2)),
      sellingPrice: suggestedPrice(o.unitPrice), note: '',
    };
    this.error.set(null);
    this.step.set(2);
  }

  confirm(o: SearchOption) {
    this.saving.set(true);
    this.error.set(null);
    const f = this.form;
    this.api.newProductOrder({
      name: f.name.trim(), category: f.category, unit: f.unit.trim(), reorderLevel: Number(f.reorderLevel),
      sellingPrice: Number(f.sellingPrice), supplierListingId: o.supplierListingId, packs: Number(f.packs),
      note: f.note.trim() || null,
    }).subscribe({
      next: r => this.router.navigate(['/orders', r.order.purchaseOrderId], { queryParams: { placed: 1, added: r.item.name } }),
      error: err => { this.error.set(problemText(err)); this.saving.set(false); },
    });
  }
}
