import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { InventoryApi, Order, isOpenOrder, orderTone, problemText } from '../api';
import { AuthService } from '../auth';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { MoneyPipe } from '../shared/money.pipe';

type Filter = 'all' | 'open' | 'delivered' | 'closed';

// FR-10: the orders list. An owner sees their orders with suppliers; a supplier sees the
// orders shops have placed with them.
@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [RouterLink, DatePipe, MoneyPipe, EmptyStateComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>Orders</h1>
        <p class="subtitle">{{ owner ? 'Orders you have placed with suppliers.' : 'Orders shops have placed with you.' }}</p>
      </div>
      @if (owner) { <a class="btn btn-primary" routerLink="/suppliers">New order</a> }
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (loading()) {
      <div class="card loading">Loading orders…</div>
    } @else if (!error()) {
      <div class="card card-flush">
        <div class="toolbar">
          <div class="segmented" role="group" aria-label="Filter orders">
            @for (f of filters; track f.key) {
              <button [class.active]="filter() === f.key" (click)="filter.set(f.key)">
                {{ f.label }}<span class="count">{{ count(f.key) }}</span>
              </button>
            }
          </div>
        </div>

        @if (shown().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Order</th><th>Product</th><th>{{ owner ? 'Supplier' : 'Shop' }}</th>
                  <th class="num">Quantity</th><th class="num">Total</th><th>Placed</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (o of shown(); track o.purchaseOrderId) {
                  <tr class="clickable" (click)="open(o)">
                    <td class="tabular secondary">#{{ o.purchaseOrderId }}</td>
                    <td class="cell-title">{{ o.productName }}</td>
                    <td>
                      @if (owner) { {{ o.supplier.name }} }
                      @else { <div class="strong">{{ o.owner?.name }}</div><div class="cell-sub">{{ o.owner?.location }}</div> }
                    </td>
                    <td class="num"><span class="qty">{{ o.packs }}</span> <span class="cell-sub">× {{ o.packSize }}</span></td>
                    <td class="num"><span class="qty">{{ o.total | money }}</span></td>
                    <td class="nowrap secondary">{{ o.createdAt | date: 'd MMM y' }}</td>
                    <td>
                      <span [class]="'pill ' + tone(o.status)">{{ o.status }}</span>
                      @if (owner && o.canReceive) { <span class="pill pill-accent pill-plain extra">To receive</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (orders().length) {
          <app-empty-state icon="orders" title="No orders here" text="No orders match this filter.">
            <button class="btn btn-secondary btn-sm" (click)="filter.set('all')">Show all orders</button>
          </app-empty-state>
        } @else if (owner) {
          <app-empty-state icon="orders" title="No orders yet"
                           text="Compare supplier prices and place your first order. You can track it here until it's delivered.">
            <a class="btn btn-primary btn-sm" routerLink="/suppliers">Browse suppliers</a>
          </app-empty-state>
        } @else {
          <app-empty-state icon="orders" title="No orders yet"
                           text="When a shop orders one of your listings, it appears here for you to confirm.">
            <a class="btn btn-secondary btn-sm" routerLink="/supplier/listings">Check your listings</a>
          </app-empty-state>
        }
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--gray-100); }
    .extra { margin-left: var(--space-1); }
  `],
})
export class OrdersComponent implements OnInit {
  private api = inject(InventoryApi);
  private router = inject(Router);
  owner = inject(AuthService).role() === 'BusinessOwner';

  orders = signal<Order[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  filter = signal<Filter>('all');
  tone = orderTone;

  filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'open', label: 'Open' },
    { key: 'delivered', label: 'Delivered' }, { key: 'closed', label: 'Declined / cancelled' },
  ];

  private matches(o: Order, f: Filter) {
    return f === 'all' || (f === 'open' && isOpenOrder(o)) || (f === 'delivered' && o.status === 'Delivered')
      || (f === 'closed' && (o.status === 'Declined' || o.status === 'Cancelled'));
  }
  shown = computed(() => this.orders().filter(o => this.matches(o, this.filter())));
  count(f: Filter) { return this.orders().filter(o => this.matches(o, f)).length; }

  ngOnInit() {
    const source: Observable<Order[]> = this.owner ? this.api.orders() : this.api.supplierOrders();
    source.subscribe({
      next: o => { this.orders.set(o); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  open(o: Order) { this.router.navigate([this.owner ? '/orders' : '/supplier/orders', o.purchaseOrderId]); }
}
