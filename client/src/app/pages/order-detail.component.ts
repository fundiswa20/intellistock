import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InventoryApi, Order, OrderStatus, StockItem, orderTone, problemText } from '../api';
import { AuthService } from '../auth';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';

interface Step { label: string; at: string | null; state: 'done' | 'current' | 'todo' | 'closed'; }

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  Confirmed: 'Confirm order', Declined: 'Decline', Dispatched: 'Mark dispatched', Delivered: 'Mark delivered',
};

// FR-10: one order. The owner can cancel it before it is confirmed and book a delivery into
// stock; the supplier moves it from placed to delivered, or declines it.
@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, PercentPipe, MoneyPipe, IconComponent],
  template: `
    <a class="back-link" [routerLink]="owner ? '/orders' : '/supplier/orders'"><app-icon name="back" [size]="16" /> All orders</a>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }
    @if (message()) { <div class="notice notice-success">{{ message() }}</div> }

    @if (order(); as o) {
      <div class="page-head">
        <div>
          <div class="title-row">
            <h1>Order #{{ o.purchaseOrderId }}</h1>
            <span [class]="'pill ' + tone(o.status)">{{ o.status }}</span>
            @if (o.receivedAt) { <span class="pill pill-success pill-plain">Received into stock</span> }
          </div>
          <p class="subtitle">{{ o.productName }} · placed {{ o.createdAt | date: 'EEE d MMM y, HH:mm' }}</p>
        </div>
        <div class="page-actions">
          @if (owner) {
            @if (o.canCancel) {
              <button class="btn btn-danger" [disabled]="busy()" (click)="cancel(o)">Cancel order</button>
            }
          } @else {
            @for (s of o.nextStatuses; track s) {
              <button class="btn" [class.btn-primary]="s !== 'Declined'" [class.btn-danger]="s === 'Declined'"
                      [disabled]="busy()" (click)="setStatus(o, s)">{{ actionLabel(s) }}</button>
            }
          }
        </div>
      </div>

      @if (owner && o.canReceive) {
        <section class="card receive">
          <div class="receive-text">
            <h2>Delivered — book it into stock</h2>
            <p class="secondary">Adds {{ o.units }} units to the item as one restock, with this order's number in the note.</p>
          </div>
          <div class="receive-form">
            <select class="input" [(ngModel)]="receiveItem" aria-label="Stock item">
              <option [ngValue]="null">Choose a stock item</option>
              @for (i of items(); track i.stockItemId) { <option [ngValue]="i.stockItemId">{{ i.name }}</option> }
            </select>
            <button class="btn btn-primary" [disabled]="busy() || !receiveItem" (click)="receive(o)">Receive into stock</button>
          </div>
        </section>
      }

      <div class="layout">
        <section class="card">
          <div class="card-head"><h2>Summary</h2></div>
          <div class="figures">
            <div>
              <div class="label">Quantity</div>
              <div class="figure">{{ o.packs }}<span class="figure-unit">{{ o.packs === 1 ? 'pack' : 'packs' }} of {{ o.packSize }}</span></div>
              <div class="muted small">{{ o.units }} units</div>
            </div>
            <div>
              <div class="label">Delivered cost</div>
              <div class="figure">{{ o.total | money }}</div>
              <div class="muted small">{{ o.total / o.units | money }} per unit</div>
            </div>
          </div>
          <dl class="dl">
            <dt>Pack price</dt><dd>{{ o.packPrice | money }}</dd>
            <dt>{{ o.packs }} × {{ o.packPrice | money }}</dt><dd>{{ o.subtotal | money }}</dd>
            <dt>Delivery</dt><dd>{{ o.deliveryCost | money }}</dd>
            <dt class="total-label">Total</dt><dd class="total-value">{{ o.total | money }}</dd>
          </dl>
          @if (o.note) { <div class="note"><span class="label">Note</span><p>{{ o.note }}</p></div> }
          @if (owner && o.stockItemId) {
            <a class="btn btn-text btn-sm item-link" [routerLink]="['/stock', o.stockItemId]">View stock item <app-icon name="chevron" [size]="14" /></a>
          }
        </section>

        <div class="side">
          <section class="card">
            <div class="card-head"><h2>Progress</h2></div>
            <ol class="timeline">
              @for (s of steps(); track s.label) {
                <li [class]="s.state">
                  <span class="dot">@if (s.state === 'done') { <app-icon name="check" [size]="12" /> }</span>
                  <div>
                    <div class="step-label">{{ s.label }}</div>
                    <div class="muted small">{{ s.at ? (s.at | date: 'EEE d MMM, HH:mm') : (s.state === 'current' ? 'Waiting' : '—') }}</div>
                  </div>
                </li>
              }
            </ol>
          </section>

          <section class="card">
            @if (owner) {
              <div class="card-head"><h2>Supplier</h2></div>
              <div class="party">
                <div class="strong">{{ o.supplier.name }}</div>
                <dl class="dl">
                  <dt>Phone</dt><dd>{{ o.supplier.phone || '—' }}</dd>
                  <dt>Delivers to</dt><dd>{{ o.supplier.deliveryArea || '—' }}</dd>
                  <dt>On time</dt><dd>{{ o.supplier.reliabilityScore | percent }}</dd>
                </dl>
              </div>
            } @else {
              <div class="card-head"><h2>Shop</h2></div>
              <div class="party">
                <div class="strong">{{ o.owner?.name }}</div>
                <dl class="dl">
                  <dt>Contact</dt><dd>{{ o.owner?.contact }}</dd>
                  <dt>Phone</dt><dd>{{ o.owner?.phone || '—' }}</dd>
                  <dt>Deliver to</dt><dd>{{ o.owner?.location }}</dd>
                </dl>
              </div>
            }
          </section>
        </div>
      </div>
    } @else if (!error()) {
      <div class="card loading">Loading order…</div>
    }
  `,
  styles: [`
    .title-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
    .layout { display: grid; grid-template-columns: 3fr 2fr; gap: var(--space-5); align-items: start; }
    .side { display: grid; gap: var(--space-5); }
    .figures { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); padding: var(--space-4) 0 var(--space-5);
               margin-bottom: var(--space-4); border-bottom: 1px solid var(--gray-100); }
    .figures .figure { margin: var(--space-1) 0; }
    .total-label { color: var(--text) !important; font-weight: 600; padding-top: var(--space-2); border-top: 1px solid var(--gray-100); }
    .total-value { font-weight: 700 !important; padding-top: var(--space-2); border-top: 1px solid var(--gray-100); }
    .note { margin-top: var(--space-4); padding: var(--space-3) var(--space-4); background: var(--gray-50); border-radius: var(--radius); }
    .note p { margin-top: var(--space-1); }
    .item-link { margin-top: var(--space-3); margin-left: calc(-1 * var(--space-2)); }
    .party { display: grid; gap: var(--space-3); }

    .receive { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); flex-wrap: wrap;
               margin-bottom: var(--space-5); box-shadow: var(--shadow), inset 3px 0 0 var(--amber-500); }
    .receive-text { display: grid; gap: var(--space-1); }
    .receive-form { display: flex; gap: var(--space-2); flex-wrap: wrap; }
    .receive-form select { width: 260px; }

    .timeline { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: grid; gap: 0; }
    .timeline li { position: relative; display: flex; gap: var(--space-3); padding-bottom: var(--space-4); }
    .timeline li:last-child { padding-bottom: 0; }
    .timeline li:not(:last-child)::after { content: ""; position: absolute; left: 9px; top: 22px; bottom: 2px; width: 2px; background: var(--gray-200); }
    .timeline li.done:not(:last-child)::after { background: var(--green-200); }
    .dot { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
           border: 2px solid var(--gray-300); background: var(--surface); color: #fff; margin-top: 2px; }
    .done .dot { background: var(--green-600); border-color: var(--green-600); }
    .current .dot { border-color: var(--amber-500); box-shadow: 0 0 0 3px var(--amber-100); }
    .closed .dot { background: var(--red-600); border-color: var(--red-600); }
    .step-label { font-weight: 600; }
    .todo .step-label { color: var(--text-muted); font-weight: 500; }
    @media (max-width: 960px) { .layout { grid-template-columns: 1fr; } }
  `],
})
export class OrderDetailComponent implements OnInit {
  private api = inject(InventoryApi);
  private route = inject(ActivatedRoute);
  owner = inject(AuthService).role() === 'BusinessOwner';

  @Input() id!: string;

  order = signal<Order | null>(null);
  items = signal<StockItem[]>([]);
  error = signal<string | null>(null);
  message = signal<string | null>(null);
  busy = signal(false);
  receiveItem: number | null = null;
  tone = orderTone;

  steps = computed<Step[]>(() => {
    const o = this.order();
    if (!o) return [];
    if (o.status === 'Declined' || o.status === 'Cancelled')
      return [
        { label: 'Placed', at: o.createdAt, state: 'done' },
        { label: o.status, at: o.closedAt, state: 'closed' },
      ];
    const list: [string, string | null][] = [
      ['Placed', o.createdAt], ['Confirmed', o.confirmedAt], ['Dispatched', o.dispatchedAt], ['Delivered', o.deliveredAt],
    ];
    if (this.owner) list.push(['Received into stock', o.receivedAt]);
    const firstOpen = list.findIndex(([, at]) => !at);
    return list.map(([label, at], i) => ({ label, at, state: at ? 'done' : i === firstOpen ? 'current' : 'todo' }));
  });

  ngOnInit() {
    if (this.route.snapshot.queryParamMap.get('placed')) this.message.set('Order placed. It is waiting for the supplier to confirm.');
    const id = Number(this.id);
    (this.owner ? this.api.order(id) : this.api.supplierOrder(id)).subscribe({
      next: o => { this.order.set(o); this.receiveItem = o.stockItemId; },
      error: err => this.error.set(err.status === 404 ? 'This order does not exist.' : problemText(err)),
    });
    if (this.owner) this.api.stock().subscribe({ next: i => this.items.set(i) });
  }

  actionLabel(s: OrderStatus) { return ACTION_LABEL[s] ?? s; }

  private run(call: ReturnType<InventoryApi['order']>, done: (o: Order) => string) {
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    call.subscribe({
      next: o => { this.order.set(o); this.message.set(done(o)); this.busy.set(false); },
      error: err => { this.error.set(problemText(err)); this.busy.set(false); },
    });
  }

  cancel(o: Order) {
    if (!confirm(`Cancel order #${o.purchaseOrderId}? The supplier will see it as cancelled.`)) return;
    this.run(this.api.cancelOrder(o.purchaseOrderId), () => 'Order cancelled.');
  }

  setStatus(o: Order, s: OrderStatus) {
    if (s === 'Declined' && !confirm(`Decline order #${o.purchaseOrderId}? The shop will see it as declined.`)) return;
    this.run(this.api.setOrderStatus(o.purchaseOrderId, s), n => `Order marked ${n.status.toLowerCase()}.`);
  }

  receive(o: Order) {
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    this.api.receiveOrder(o.purchaseOrderId, this.receiveItem).subscribe({
      next: r => {
        this.order.set(r.order);
        this.message.set(`Received ${r.order.units} units into stock. ${r.quantityOnHand} now on hand.`
          + (r.alert === 'resolved' ? ' Low-stock alert cleared.' : ''));
        this.busy.set(false);
      },
      error: err => { this.error.set(problemText(err)); this.busy.set(false); },
    });
  }
}
