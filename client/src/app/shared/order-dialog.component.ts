import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { InventoryApi, Listing, StockItem, problemText } from '../api';
import { IconComponent } from './icon.component';
import { MoneyPipe } from './money.pipe';

// FR-10: place an order for whole packs of one listing. Used from the Suppliers page and
// from a stock item's restocking comparison (D39).
@Component({
  selector: 'app-order-dialog',
  standalone: true,
  imports: [FormsModule, MoneyPipe, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="place()" role="dialog" aria-labelledby="order-title">
        <div class="modal-head">
          <div>
            <h2 id="order-title">Order {{ listing.productName }}</h2>
            <p class="muted small">from {{ listing.supplierName }} · packs of {{ listing.packSize }} · {{ listing.leadTimeDays }}-day lead time</p>
          </div>
          <button type="button" class="icon-btn" (click)="closed.emit()" aria-label="Close"><app-icon name="x" /></button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field">
              <label for="packs">Packs</label>
              <input class="input" id="packs" name="packs" type="number" min="1" [max]="listing.availableQuantity"
                     [(ngModel)]="packs" required />
              <span class="hint">{{ listing.availableQuantity }} available · {{ (packs || 0) * listing.packSize }} units</span>
            </div>
            <div class="field">
              <label for="item">Book into stock item</label>
              <select class="input" id="item" name="item" [(ngModel)]="stockItemId">
                <option [ngValue]="null">Not linked</option>
                @for (i of items; track i.stockItemId) { <option [ngValue]="i.stockItemId">{{ i.name }}</option> }
              </select>
              <span class="hint">When you receive the delivery, the units are added to this item.</span>
            </div>
            <div class="field span-2">
              <label for="note">Note to the supplier <span class="muted">(optional)</span></label>
              <input class="input" id="note" name="note" [(ngModel)]="note" maxlength="255" />
            </div>
          </div>

          @if (suggestedPacks(); as s) {
            <div class="notice notice-accent hint-box">
              <app-icon name="trend" [size]="16" />
              <span>The forecast recommends {{ recommendedUnits }} units: {{ s }} {{ s === 1 ? 'pack' : 'packs' }} of {{ listing.packSize }}.</span>
            </div>
          }

          <div class="summary">
            <dl class="dl">
              <dt>{{ packs || 0 }} × {{ listing.packPrice | money }}</dt><dd>{{ (packs || 0) * listing.packPrice | money }}</dd>
              <dt>Delivery</dt><dd>{{ listing.deliveryCost | money }}</dd>
            </dl>
            <div class="total">
              <span class="label">Delivered cost</span>
              <span class="figure">{{ (packs || 0) * listing.packPrice + listing.deliveryCost | money }}</span>
            </div>
          </div>

          @if (error()) { <div class="notice notice-error" style="margin:0">{{ error() }}</div> }
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="placing() || !packs || packs < 1 || packs > listing.availableQuantity">
            {{ placing() ? 'Placing order…' : 'Place order' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .summary { display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius); background: var(--gray-50); }
    .total { display: flex; justify-content: space-between; align-items: baseline; padding-top: var(--space-3);
             border-top: 1px solid var(--gray-200); }
    .hint-box { margin: 0; align-items: center; }
  `],
})
export class OrderDialogComponent implements OnInit {
  private api = inject(InventoryApi);
  private router = inject(Router);

  @Input({ required: true }) listing!: Listing;
  @Input() items: StockItem[] = [];
  @Input() stockItemId: number | null = null;
  @Input() recommendedUnits: number | null = null;
  @Output() closed = new EventEmitter<void>();

  packs: number | null = 1;
  note = '';
  placing = signal(false);
  error = signal<string | null>(null);

  ngOnInit() { this.packs = Math.min(this.suggestedPacks() ?? 1, this.listing.availableQuantity); }

  suggestedPacks() {
    return this.recommendedUnits ? Math.max(1, Math.ceil(this.recommendedUnits / this.listing.packSize)) : null;
  }

  place() {
    this.placing.set(true);
    this.error.set(null);
    this.api.placeOrder({
      supplierListingId: this.listing.supplierListingId, packs: Number(this.packs), stockItemId: this.stockItemId,
      note: this.note.trim() || null,
    }).subscribe({
      next: o => this.router.navigate(['/orders', o.purchaseOrderId], { queryParams: { placed: 1 } }),
      error: err => { this.error.set(problemText(err)); this.placing.set(false); },
    });
  }
}
