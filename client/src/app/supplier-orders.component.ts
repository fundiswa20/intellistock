import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Order, OrderStatus, SupplierApi, problemText } from './api';

// the one step a supplier can take from each status; Delivered is final
const NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  Placed: { status: 'Confirmed', label: 'Confirm' },
  Confirmed: { status: 'Dispatched', label: 'Dispatch' },
  Dispatched: { status: 'Delivered', label: 'Mark delivered' },
};

// FR-10: orders placed with the signed-in supplier, moved on one status at a time
@Component({
  selector: 'app-supplier-orders',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="heading">
      <div>
        <h1>Orders</h1>
        @if (orders().length) { <p class="muted">{{ orders().length }} {{ orders().length === 1 ? 'order' : 'orders' }} from your customers</p> }
      </div>
    </div>

    @if (error()) { <div class="error">{{ error() }}</div> }
    @if (loading()) { <div class="card empty muted">Loading orders…</div> }
    @else if (!orders().length && !error()) { <div class="card empty muted">No orders yet.</div> }

    @if (orders().length) {
      <div class="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ordered</th>
              <th>Business</th>
              <th>Product</th>
              <th class="num">Quantity</th>
              <th class="num">Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (o of orders(); track o.orderId) {
              <tr>
                <td class="nowrap">{{ o.placedAt | date: 'd MMM' }}</td>
                <td class="name">{{ o.companyName }}</td>
                <td>{{ o.lines[0]?.productName }}</td>
                <td class="num">{{ o.lines[0]?.quantity }}</td>
                <td class="num nowrap">R {{ o.totalCost.toFixed(2) }}</td>
                <td><span class="badge" [class.badge-ok]="o.status === 'Delivered'"
                          [class.badge-fallback]="o.status !== 'Delivered'">{{ o.status }}</span></td>
                <td class="num">
                  @if (next(o); as n) {
                    <button class="btn btn-primary step" type="button" (click)="advance(o, n.status)"
                            [disabled]="busyId() !== null">{{ busyId() === o.orderId ? 'Saving…' : n.label }}</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .heading { display: flex; align-items: flex-end; margin-bottom: 18px; }
    h1 { margin: 0 0 4px; }
    .heading p { margin: 0; }
    .name { font-weight: 600; }
    .nowrap { white-space: nowrap; }
    .step { padding: 5px 12px; font-size: 13px; white-space: nowrap; }
  `],
})
export class SupplierOrdersComponent implements OnInit {
  private api = inject(SupplierApi);

  orders = signal<Order[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  busyId = signal<number | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.api.orders().subscribe({
      next: orders => { this.orders.set(orders); this.error.set(null); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  next(o: Order) { return NEXT[o.status] ?? null; }

  advance(o: Order, status: OrderStatus) {
    this.busyId.set(o.orderId);
    this.error.set(null);
    this.api.updateOrderStatus(o.orderId, status).subscribe({
      next: () => { this.busyId.set(null); this.load(); },
      error: err => { this.error.set(problemText(err)); this.busyId.set(null); },
    });
  }
}
