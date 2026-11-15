import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Comparison, ComparisonOption, InventoryApi, Movement, Prediction, StockItem, plural, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';
import { OrderDialogComponent } from '../shared/order-dialog.component';

// One stock item: details, recent movements (FR-04), record a movement (FR-04),
// the reorder recommendation (FR-08) with which path produced it (ETR-03, D25), and
// restocking from a supplier without leaving the item (D39)
@Component({
  selector: 'app-stock-item',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, PercentPipe, MoneyPipe, EmptyStateComponent, IconComponent,
            OrderDialogComponent],
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
          <button class="btn btn-primary" (click)="toggleCompare()" [attr.aria-expanded]="comparing()">
            <app-icon name="truck" [size]="16" /> {{ comparing() ? 'Hide suppliers' : 'Order from a supplier' }}
          </button>
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

      <!-- D39: restocking - every supplier of this product, priced for the recommended quantity -->
      @if (comparing()) {
        <section class="card compare">
          <div class="card-head">
            <div>
              <h2>Restock from a supplier</h2>
              @if (comparison(); as c) {
                <p>{{ c.options.length }} {{ c.options.length === 1 ? 'listing matches' : 'listings match' }} “{{ c.searchTerm }}”,
                  priced for {{ c.unitsWanted }} {{ plural(it.unit, c.unitsWanted) }} delivered, cheapest first.</p>
              }
            </div>
            @if (comparison(); as c) {
              <a class="btn btn-text btn-sm" routerLink="/suppliers" [queryParams]="{ q: c.searchTerm, item: it.stockItemId, qty: c.unitsWanted }">
                All listings <app-icon name="chevron" [size]="14" /></a>
            }
          </div>

          @if (compareError()) { <div class="notice notice-error">{{ compareError() }}</div> }
          @if (!comparison() && !compareError()) { <p class="muted">Comparing suppliers…</p> }

          @if (comparison(); as c) {
            @if (c.lastSupplier; as last) {
              <div class="notice notice-success usual">
                <app-icon name="clock" [size]="16" />
                <span>Last time you ordered this from <strong>{{ last.supplierName }}</strong>
                  ({{ last.packs }} {{ last.packs === 1 ? 'pack' : 'packs' }}, {{ last.total | money }}, {{ last.createdAt | date: 'd MMM' }}).
                  @if (usual(); as u) {
                    @if (recommended(); as r) {
                      @if (u === r) { They are still the cheapest option. }
                      @else { {{ r.supplierName }} would save you {{ u.total - r.total | money }} on this order. }
                    }
                  } @else { They don't list it any more. }
                </span>
              </div>
            }

            @if (c.options.length) {
              <div class="cards" [class]="'cards cards-' + cards().length">
                @for (o of cards(); track o.supplierListingId) {
                  <article class="option" [class.option-top]="o === recommended()" [class.option-usual]="o.orderedLastTime">
                    <div class="option-tags">
                      @if (o === recommended()) { <span class="pill pill-solid pill-plain">Recommended</span> }
                      @else { <span class="pill pill-neutral pill-plain">#{{ rank(o) }}</span> }
                      @if (o.orderedLastTime) { <span class="pill pill-plain usual-pill">You ordered from them last time</span> }
                    </div>
                    <div class="option-company">{{ o.supplierName }}</div>
                    <div class="cell-sub">{{ o.productName }}
                      @if (!o.sameProduct) { <span class="pill pill-muted pill-plain mini">Similar product</span> }</div>
                    <div class="option-total">
                      <span class="label">Delivered cost</span>
                      <span class="figure" [class.figure-lg]="o === recommended()">{{ o.total | money }}</span>
                      @if (recommended(); as r) {
                        @if (o !== r && o.total > r.total) { <span class="cell-sub more">+{{ o.total - r.total | money }} vs recommended</span> }
                      }
                    </div>
                    <dl class="dl option-dl">
                      <dt>{{ o.packs }} × {{ o.packPrice | money }}</dt><dd>{{ o.subtotal | money }}</dd>
                      <dt>Delivery</dt><dd>{{ o.deliveryCost | money }}</dd>
                      <dt>Lead time</dt><dd>{{ o.leadTimeDays }} {{ o.leadTimeDays === 1 ? 'day' : 'days' }}</dd>
                      <dt>Reliability</dt><dd>{{ o.reliabilityScore | percent }} on time</dd>
                    </dl>
                    <div class="option-foot">
                      <span class="pill" [class.pill-success]="o.inYourArea" [class.pill-accent]="!o.inYourArea">
                        {{ o.inYourArea ? 'In your area' : 'Outside your area' }}</span>
                      @if (!o.canFulfil) {
                        <span class="cell-sub">{{ o.availableQuantity === 0 ? 'Out of stock' : 'Only ' + o.availableQuantity + ' packs' }}</span>
                      }
                      <button class="btn btn-sm" [class.btn-primary]="o === recommended()" [class.btn-secondary]="o !== recommended()"
                              [disabled]="o.availableQuantity === 0" (click)="ordering.set(o)">Order</button>
                    </div>
                  </article>
                }
              </div>

              @if (rest().length) {
                <div class="table-wrap rest">
                  <table class="table">
                    <thead>
                      <tr><th>Supplier</th><th class="num">Packs</th><th class="num">Delivered cost</th><th class="num">vs recommended</th>
                        <th class="num">Lead time</th><th>Area</th><th></th></tr>
                    </thead>
                    <tbody>
                      @for (o of rest(); track o.supplierListingId) {
                        <tr>
                          <td><div class="strong">{{ o.supplierName }}</div>
                            <div class="cell-sub">{{ o.productName }} · {{ o.reliabilityScore | percent }} on time</div></td>
                          <td class="num secondary nowrap">{{ o.packs }} × {{ o.packSize }}</td>
                          <td class="num"><span class="qty">{{ o.total | money }}</span></td>
                          <td class="num secondary">@if (recommended(); as r) { +{{ o.total - r.total | money }} } @else { — }</td>
                          <td class="num secondary nowrap">{{ o.leadTimeDays }} {{ o.leadTimeDays === 1 ? 'day' : 'days' }}</td>
                          <td><span class="pill" [class.pill-success]="o.inYourArea" [class.pill-accent]="!o.inYourArea">
                            {{ o.inYourArea ? 'In your area' : 'Outside your area' }}</span></td>
                          <td class="num"><button class="btn btn-secondary btn-sm" [disabled]="o.availableQuantity === 0"
                                                  (click)="ordering.set(o)">Order</button></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            } @else {
              <app-empty-state compact icon="truck" title="No supplier lists this yet"
                               [text]="'No active listing matches “' + c.searchTerm + '”. Record a restock below when you buy it elsewhere.'" />
            }
          }
        </section>
      }

      @if (ordering(); as o) {
        <app-order-dialog [listing]="o" [items]="items()" [stockItemId]="it.stockItemId"
                          [recommendedUnits]="prediction()?.recommendedQuantity || null" (closed)="ordering.set(null)" />
      }

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
    .compare { margin-bottom: var(--space-5); box-shadow: var(--shadow), inset 0 3px 0 var(--green-600); }
    .usual { align-items: center; }
    .cards { display: grid; grid-template-columns: 1fr; gap: var(--space-4); align-items: stretch; }
    .cards-2 { grid-template-columns: 1.4fr 1fr; }
    .cards-3 { grid-template-columns: 1.4fr 1fr 1fr; }
    .cards-4 { grid-template-columns: 1.3fr 1fr 1fr 1fr; }
    .option { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4);
              border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .option-top { border: 2px solid var(--green-600); background: var(--green-50); padding: var(--space-5); }
    .option-usual:not(.option-top) { border-color: var(--green-200); }
    .option-tags { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .usual-pill { background: var(--green-100); color: var(--green-800); }
    .option-company { font-weight: 700; font-size: var(--text-lg); }
    .option-top .option-company { color: var(--green-900); }
    .option-total { display: grid; gap: 2px; margin: var(--space-2) 0; }
    .option-top .option-total .figure { color: var(--green-800); }
    .more { color: var(--amber-700); }
    .option-dl { font-size: var(--text-sm); }
    .option-foot { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; margin-top: auto; padding-top: var(--space-3); }
    .option-foot .btn { margin-left: auto; }
    .mini { font-size: 11px; line-height: 18px; padding: 0 6px; margin-left: 4px; }
    .rest { margin-top: var(--space-5); border-top: 1px solid var(--gray-100); }
    @media (max-width: 960px) { .layout, .cards { grid-template-columns: 1fr; } }
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

  // D39: restocking comparison
  comparing = signal(false);
  comparison = signal<Comparison | null>(null);
  compareError = signal<string | null>(null);
  ordering = signal<ComparisonOption | null>(null);
  items = signal<StockItem[]>([]);
  // the cheapest option that can supply all of it
  recommended = computed(() => {
    const first = this.comparison()?.options[0];
    return first && first.canFulfil ? first : null;
  });
  usual = computed(() => this.comparison()?.options.find(o => o.orderedLastTime) ?? null);
  // the top three, plus the usual supplier pinned beside them when they rank lower
  cards = computed(() => {
    const opts = this.comparison()?.options ?? [];
    const top = opts.slice(0, 3);
    const u = this.usual();
    return u && !top.includes(u) ? [...top, u] : top;
  });
  rest = computed(() => (this.comparison()?.options ?? []).filter(o => !this.cards().includes(o)));
  rank = (o: ComparisonOption) => (this.comparison()?.options.indexOf(o) ?? 0) + 1;

  plural = plural;
  typeTone = (t: string) => 'type-' + t.toLowerCase();

  ngOnInit() {
    this.load();
    this.api.stock().subscribe({ next: i => this.items.set(i) });
  }

  toggleCompare() {
    this.comparing.set(!this.comparing());
    if (this.comparing()) this.compare();
  }

  // priced for the forecast's quantity once it has loaded
  compare() {
    this.compareError.set(null);
    this.api.compare(this.itemId, this.prediction()?.recommendedQuantity || null).subscribe({
      next: c => this.comparison.set(c),
      error: err => this.compareError.set(problemText(err)),
    });
  }

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
      next: p => { this.prediction.set(p); this.predicting.set(false); if (this.comparing()) this.compare(); },
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
