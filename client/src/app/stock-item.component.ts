import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { InventoryApi, Movement, Prediction, StockItem, plural, problemText } from './api';

// One stock item: details, recent movements (FR-04), record a movement (FR-04),
// and the reorder recommendation (FR-08) with which path produced it (ETR-03, D25)
@Component({
  selector: 'app-stock-item',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe],
  template: `
    <a class="back" routerLink="/stock">← All stock</a>

    @if (error()) { <div class="error">{{ error() }}</div> }

    @if (item(); as it) {
      <div class="heading">
        <div>
          <h1>{{ it.name }}</h1>
          <p class="muted">{{ it.category }} · sold per {{ it.unit }} · R {{ it.sellingPrice.toFixed(2) }}
            (cost R {{ it.unitCost.toFixed(2) }})</p>
        </div>
        @if (it.isLow) { <span class="badge badge-low big">Low stock</span> }
        @else { <span class="badge badge-ok big">In stock</span> }
      </div>

      <div class="grid">
        <!-- left column: numbers and the recommendation -->
        <div class="col">
          <div class="stats">
            <div class="card stat" [class.stat-low]="it.isLow">
              <div class="label">On hand</div>
              <div class="value">{{ it.quantityOnHand }}</div>
              <div class="muted small">{{ plural(it.unit, it.quantityOnHand) }}</div>
            </div>
            <div class="card stat">
              <div class="label">Reorder level</div>
              <div class="value">{{ it.reorderLevel }}</div>
              <div class="muted small">alert at or below</div>
            </div>
          </div>

          <div class="card reco">
            <div class="reco-head">
              <h2>Reorder recommendation</h2>
              @if (prediction(); as p) {
                <span class="badge" [class.badge-model]="p.recommendationSource === 'model'"
                      [class.badge-fallback]="p.recommendationSource !== 'model'">
                  {{ p.recommendationSource === 'model' ? 'Model forecast' : 'Threshold-based advice' }}
                </span>
              }
            </div>

            @if (predicting()) { <p class="muted">Calculating recommendation…</p> }
            @if (prediction(); as p) {
              <div class="reco-main">
                <div>
                  <div class="label">Reorder by</div>
                  <div class="big-value">{{ p.reorderByDate ? (p.reorderByDate | date: 'EEE d MMM') : 'Not needed' }}</div>
                  @if (isToday(p.reorderByDate)) { <div class="today">today</div> }
                </div>
                <div>
                  <div class="label">Order quantity</div>
                  <div class="big-value">{{ p.recommendedQuantity }}</div>
                  <div class="muted small">{{ plural(it.unit, p.recommendedQuantity) }}</div>
                </div>
              </div>
              <dl class="facts">
                <dt>Forecast demand</dt><dd>{{ p.predictedDailyDemand | number: '1.1-2' }} {{ plural(it.unit, 2) }} / day</dd>
                <dt>Runs out in</dt>
                <dd>{{ p.daysUntilStockOut === null ? '—' : (p.daysUntilStockOut | number: '1.0-1') + ' days' }}</dd>
                <dt>Confidence</dt><dd>{{ p.confidence === null ? 'not available' : (p.confidence | number: '1.2-2') }}</dd>
                <dt>Model version</dt><dd>{{ p.modelVersion ?? 'not used' }}</dd>
              </dl>
              <p class="basis" [class.basis-fallback]="p.recommendationSource !== 'model'">{{ p.basis }}</p>
            }
          </div>
        </div>

        <!-- right column: record a movement, then the log -->
        <div class="col">
          <form class="card" (ngSubmit)="record()">
            <h2>Record a stock movement</h2>
            <div class="form-row">
              <div>
                <label for="type">Type</label>
                <select id="type" name="type" [(ngModel)]="type">
                  <option value="Sale">Sale</option>
                  <option value="Restock">Restock</option>
                  <option value="Adjustment">Adjustment (+/−)</option>
                </select>
              </div>
              <div>
                <label for="qty">Quantity</label>
                <input id="qty" name="qty" type="number" [(ngModel)]="quantity" />
              </div>
            </div>
            <label for="note">Note <span class="muted">(optional)</span></label>
            <input id="note" name="note" [(ngModel)]="note" maxlength="255"
                   placeholder="e.g. Wholesaler trip, damaged tin" />
            @if (formError()) { <div class="error">{{ formError() }}</div> }
            @if (formOk()) { <div class="ok">{{ formOk() }}</div> }
            <button class="btn btn-primary" type="submit" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Record movement' }}
            </button>
            <p class="muted small hint">Movements are permanent. To correct a mistake, record an Adjustment.</p>
          </form>

          <div class="card table-card">
            <h2 class="pad">Recent movements</h2>
            <table>
              <thead>
                <tr><th>When</th><th>Type</th><th class="num">Change</th><th class="num">Balance</th><th>Note</th></tr>
              </thead>
              <tbody>
                @for (m of movements(); track m.transactionId) {
                  <tr>
                    <td class="nowrap">{{ m.occurredAt | date: 'd MMM, HH:mm' }}</td>
                    <td><span class="type type-{{ m.type.toLowerCase() }}">{{ m.type }}</span></td>
                    <td class="num strong" [class.neg]="m.quantityChange < 0" [class.pos]="m.quantityChange > 0">
                      {{ m.quantityChange > 0 ? '+' : '' }}{{ m.quantityChange }}</td>
                    <td class="num">{{ m.quantityAfter }}</td>
                    <td class="muted">{{ m.note }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .back { display: inline-block; margin-bottom: 14px; color: var(--brand); text-decoration: none; font-weight: 600; }
    .heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { margin: 0 0 4px; }
    .heading p { margin: 0; }
    .big { font-size: 13px; padding: 6px 12px; }
    h2 { font-size: 16px; margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: 5fr 7fr; gap: 20px; align-items: start; }
    .col { display: grid; gap: 20px; }
    .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .stat { padding: 16px 18px; }
    .stat .value { font-size: 32px; font-weight: 700; line-height: 1.1; margin-top: 4px; }
    .stat-low { border-color: var(--danger-soft); background: #fff7f6; }
    .stat-low .value { color: var(--danger); }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); font-weight: 600; }
    .small { font-size: 12.5px; }
    .reco-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .reco-head h2 { margin: 0; }
    .reco-main { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 18px 0 14px; }
    .big-value { font-size: 26px; font-weight: 700; margin-top: 2px; }
    .today { display: inline-block; font-size: 12px; font-weight: 700; color: var(--danger); }
    .facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; padding: 12px 0;
             border-top: 1px solid var(--line); font-size: 14px; }
    .facts dt { color: var(--muted); }
    .facts dd { margin: 0; font-weight: 600; }
    .basis { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; font-size: 13.5px;
             background: var(--brand-soft); color: var(--brand-dark); }
    .basis-fallback { background: var(--amber-soft); color: #7a4b00; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    label { display: block; font-size: 13px; font-weight: 600; margin: 10px 0 6px; }
    input, select { width: 100%; }
    form .btn { margin-top: 16px; }
    .hint { margin: 10px 0 0; }
    .pad { padding: 18px 18px 0; }
    .nowrap { white-space: nowrap; }
    .strong { font-weight: 700; }
    .neg { color: var(--danger); }
    .pos { color: var(--brand); }
    .type { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }
    .type-sale { background: #eef1f5; color: #3d4a5c; }
    .type-restock { background: var(--brand-soft); color: var(--brand-dark); }
    .type-adjustment { background: var(--amber-soft); color: #7a4b00; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
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
      error: err => { this.error.set(problemText(err)); this.predicting.set(false); },
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
        let msg = `Recorded ${r.transaction.type.toLowerCase()} of ${change > 0 ? '+' : ''}${change}. ` +
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
