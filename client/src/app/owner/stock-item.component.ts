import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventoryApi, Movement, Prediction, StockItem, plural, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';

// One stock item: details, recent movements (FR-04), record a movement (FR-04),
// and the reorder recommendation (FR-08) with which path produced it (ETR-03, D25)
@Component({
  selector: 'app-stock-item',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, MoneyPipe, EmptyStateComponent, IconComponent],
  template: `
    <a class="back-link" routerLink="/stock"><app-icon name="back" [size]="16" /> All stock</a>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (item(); as it) {
      <div class="page-head">
        <div>
          <div class="title-row">
            <h1>{{ it.name }}</h1>
            @if (it.isLow) { <span class="pill pill-danger">Low stock</span> }
            @else { <span class="pill pill-success">In stock</span> }
          </div>
          <p class="subtitle">{{ it.category }} · sold per {{ it.unit }} · {{ it.sellingPrice | money }}
            <span class="muted">(cost {{ it.unitCost | money }})</span></p>
        </div>
        <div class="page-actions">
          <a class="btn btn-primary" routerLink="/suppliers"
             [queryParams]="{ q: it.name, item: it.stockItemId, qty: prediction()?.recommendedQuantity || null }">
            <app-icon name="truck" [size]="16" /> Order from a supplier
          </a>
        </div>
      </div>

      <div class="kpis">
        <div class="card kpi" [class.kpi-danger]="it.isLow">
          <span class="label">On hand</span>
          <span class="figure figure-lg" [class.figure-danger]="it.isLow">{{ it.quantityOnHand }}<span class="figure-unit">{{ plural(it.unit, it.quantityOnHand) }}</span></span>
        </div>
        <div class="card kpi">
          <span class="label">Reorder level</span>
          <span class="figure figure-lg">{{ it.reorderLevel }}</span>
          <span class="hint">an alert is raised at or below this</span>
        </div>
        <div class="card kpi">
          <span class="label">Days of cover</span>
          @if (prediction()?.daysUntilStockOut != null) {
            <span class="figure figure-lg">{{ prediction()!.daysUntilStockOut! | number: '1.0-1' }}<span class="figure-unit">days</span></span>
          } @else {
            <span class="figure figure-lg muted">—</span>
          }
          <span class="hint">at the forecast rate of sale</span>
        </div>
      </div>

      <div class="layout">
        <!-- left: the recommendation -->
        <section class="card reco">
          <div class="reco-head">
            <div class="reco-title">
              <span class="reco-icon"><app-icon name="trend" [size]="18" /></span>
              <h2>Reorder recommendation</h2>
            </div>
            @if (prediction(); as p) {
              <span class="pill" [class.pill-accent]="p.recommendationSource === 'model'"
                    [class.pill-neutral]="p.recommendationSource !== 'model'">
                {{ p.recommendationSource === 'model' ? 'Model forecast' : 'Threshold-based advice' }}
              </span>
            }
          </div>

          @if (predicting() && !prediction()) { <p class="muted">Calculating recommendation…</p> }
          @if (prediction(); as p) {
            <div class="reco-main">
              <div>
                <div class="label">Reorder by</div>
                <div class="figure accent-figure">{{ p.reorderByDate ? (p.reorderByDate | date: 'EEE d MMM') : 'Not needed' }}</div>
                @if (isToday(p.reorderByDate)) { <span class="pill pill-danger today">Today</span> }
              </div>
              <div>
                <div class="label">Order quantity</div>
                <div class="figure accent-figure">{{ p.recommendedQuantity }}<span class="figure-unit">{{ plural(it.unit, p.recommendedQuantity) }}</span></div>
              </div>
            </div>
            <dl class="dl">
              <dt>Forecast demand</dt><dd>{{ p.predictedDailyDemand | number: '1.1-2' }} {{ plural(it.unit, 2) }} / day</dd>
              <dt>Runs out in</dt>
              <dd>{{ p.daysUntilStockOut === null ? '—' : (p.daysUntilStockOut | number: '1.0-1') + ' days' }}</dd>
              <dt>Confidence</dt><dd>{{ p.confidence === null ? 'not available' : (p.confidence | number: '1.2-2') }}</dd>
              <dt>Model version</dt><dd>{{ p.modelVersion ?? 'not used' }}</dd>
            </dl>
            <p class="basis" [class.basis-fallback]="p.recommendationSource !== 'model'">{{ p.basis }}</p>
          }
        </section>

        <!-- right: record a movement -->
        <form class="card" (ngSubmit)="record()">
          <div class="card-head"><div><h2>Record a stock movement</h2><p>Movements are permanent. To correct a mistake, record an adjustment.</p></div></div>
          <div class="form-grid">
            <div class="field">
              <label for="type">Type</label>
              <select class="input" id="type" name="type" [(ngModel)]="type">
                <option value="Sale">Sale</option>
                <option value="Restock">Restock</option>
                <option value="Adjustment">Adjustment (+/−)</option>
              </select>
            </div>
            <div class="field">
              <label for="qty">Quantity</label>
              <input class="input" id="qty" name="qty" type="number" [(ngModel)]="quantity" />
            </div>
            <div class="field span-2">
              <label for="note">Note <span class="muted">(optional)</span></label>
              <input class="input" id="note" name="note" [(ngModel)]="note" maxlength="255"
                     placeholder="e.g. Wholesaler trip, damaged tin" />
            </div>
          </div>
          @if (formError()) { <div class="notice notice-error msg">{{ formError() }}</div> }
          @if (formOk()) { <div class="notice notice-success msg">{{ formOk() }}</div> }
          <div class="foot">
            <button class="btn btn-primary" type="submit" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Record movement' }}
            </button>
          </div>
        </form>
      </div>

      <section class="card card-flush movements">
        <div class="card-head"><div><h2>Recent movements</h2><p>The last {{ movements().length }} entries in the log</p></div></div>
        @if (movements().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>When</th><th>Type</th><th class="num">Change</th><th class="num">Balance</th><th>Note</th></tr>
              </thead>
              <tbody>
                @for (m of movements(); track m.transactionId) {
                  <tr>
                    <td class="nowrap secondary">{{ m.occurredAt | date: 'd MMM, HH:mm' }}</td>
                    <td><span class="pill pill-plain" [class]="'pill pill-plain ' + typeTone(m.type)">{{ m.type }}</span></td>
                    <td class="num"><span class="qty" [class.neg]="m.quantityChange < 0" [class.pos]="m.quantityChange > 0">
                      {{ m.quantityChange > 0 ? '+' : '' }}{{ m.quantityChange }}</span></td>
                    <td class="num">{{ m.quantityAfter }}</td>
                    <td class="secondary">{{ m.note }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <app-empty-state compact icon="clock" title="No movements yet"
                           text="Sales, restocks and adjustments you record appear here, newest first." />
        }
      </section>
    }
  `,
  styles: [`
    .title-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    .layout { display: grid; grid-template-columns: 5fr 6fr; gap: var(--space-5); align-items: start; margin-bottom: var(--space-5); }
    .reco { box-shadow: var(--shadow), inset 0 3px 0 var(--amber-500); }
    .reco-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
    .reco-title { display: flex; align-items: center; gap: var(--space-2); }
    .reco-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius);
                 background: var(--amber-50); color: var(--amber-600); }
    .reco-main { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin: var(--space-5) 0;
                 padding: var(--space-4); border-radius: var(--radius); background: var(--amber-50); }
    .accent-figure { color: var(--amber-700); margin-top: var(--space-1); }
    .today { margin-top: var(--space-2); }
    .basis { margin-top: var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius);
             font-size: var(--text-sm); background: var(--gray-50); color: var(--gray-700); }
    .basis-fallback { background: var(--amber-50); color: var(--amber-700); }
    .msg { margin: var(--space-4) 0 0; }
    .foot { display: flex; justify-content: flex-end; margin-top: var(--space-5); }
    .neg { color: var(--red-600); }
    .pos { color: var(--green-700); }
    .type-sale { background: var(--gray-100); color: var(--gray-700); }
    .type-restock { background: var(--green-100); color: var(--green-800); }
    .type-adjustment { background: var(--amber-100); color: var(--amber-700); }
    @media (max-width: 960px) { .layout { grid-template-columns: 1fr; } }
  `],
})
export class StockItemComponent implements OnInit {
  private api = inject(InventoryApi);

  @Input() id!: string;   // from the route, via withComponentInputBinding

  item = signal<StockItem | null>(null);
  movements = signal<Movement[]>([]);
  prediction = signal<Prediction | null>(null);
  predicting = signal(false);
  error = signal<string | null>(null);

  type = 'Sale';
  quantity: number | null = 1;
  note = '';
  saving = signal(false);
  formError = signal<string | null>(null);
  formOk = signal<string | null>(null);

  plural = plural;
  typeTone = (t: string) => 'type-' + t.toLowerCase();

  ngOnInit() { this.load(); }

  private get itemId() { return Number(this.id); }

  load() {
    this.api.item(this.itemId).subscribe({
      next: it => this.item.set(it),
      error: err => this.error.set(err.status === 404 ? 'This item does not exist.' : problemText(err)),
    });
    this.api.movements(this.itemId).subscribe({ next: m => this.movements.set(m) });
    this.predict();
  }

  // every view asks for a fresh recommendation; the API stores each one it shows (FR-08)
  predict() {
    this.predicting.set(true);
    this.api.predict(this.itemId).subscribe({
      next: p => { this.prediction.set(p); this.predicting.set(false); },
      error: err => { if (err.status !== 404) this.error.set(problemText(err)); this.predicting.set(false); },
    });
  }

  record() {
    this.formError.set(null);
    this.formOk.set(null);
    this.saving.set(true);
    this.api.recordMovement(this.itemId, {
      type: this.type, quantity: Number(this.quantity), note: this.note.trim() || null,
    }).subscribe({
      next: r => {
        const it = r.item;
        const change = r.transaction.quantityChange;
        // a sale or restock reads as a plain amount ("sale of 1"); only an adjustment is signed
        const amount = r.transaction.type === 'Adjustment'
          ? `${change > 0 ? '+' : ''}${change}`
          : `${Math.abs(change)}`;
        let msg = `Recorded ${r.transaction.type.toLowerCase()} of ${amount}. ` +
                  `${it.quantityOnHand} ${plural(it.unit, it.quantityOnHand)} now on hand.`;
        if (r.alert === 'raised') msg += ' Low-stock alert raised.';
        if (r.alert === 'resolved') msg += ' Low-stock alert cleared.';
        this.formOk.set(msg);
        this.note = '';
        this.saving.set(false);
        this.load();
      },
      error: err => { this.formError.set(problemText(err)); this.saving.set(false); },
    });
  }

  isToday(d: string | null) {
    if (!d) return false;
    const now = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);   // SA time, as the API
    return d === now;
  }
}
