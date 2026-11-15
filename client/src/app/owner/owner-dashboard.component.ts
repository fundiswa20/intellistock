import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Alert, InventoryApi, Order, StockItem, isOpenOrder, orderTone, plural, problemText } from '../api';
import { AuthService } from '../auth';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { IconComponent } from '../shared/icon.component';
import { MoneyPipe } from '../shared/money.pipe';

// The owner's overview: what needs attention today
@Component({
  selector: 'app-owner-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, MoneyPipe, EmptyStateComponent, IconComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>{{ greeting() }}, {{ firstName() }}</h1>
        <p class="subtitle">Here's what needs attention at {{ auth.orgName() }}.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" routerLink="/stock">View stock</a>
        <a class="btn btn-primary" routerLink="/suppliers"><app-icon name="plus" [size]="16" /> New order</a>
      </div>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (loaded()) {
      <div class="kpis">
        <a class="card kpi link" routerLink="/stock">
          <span class="label">Products</span>
          <span class="figure">{{ items().length }}</span>
          <span class="hint">being tracked</span>
        </a>
        <a class="card kpi link" [class.kpi-danger]="low().length > 0" routerLink="/alerts">
          <span class="label">Low stock</span>
          <span class="figure" [class.figure-danger]="low().length > 0">{{ low().length }}</span>
          <span class="hint">at or below reorder level</span>
        </a>
        <a class="card kpi link" routerLink="/orders">
          <span class="label">Open orders</span>
          <span class="figure">{{ openOrders().length }}</span>
          <span class="hint">placed, confirmed or on the way</span>
        </a>
        <a class="card kpi link" [class.kpi-accent]="toReceive().length > 0" routerLink="/orders">
          <span class="label">To receive</span>
          <span class="figure" [class.figure-accent]="toReceive().length > 0">{{ toReceive().length }}</span>
          <span class="hint">delivered, not yet booked into stock</span>
        </a>
      </div>

      <div class="grid-2">
        <section class="card card-flush">
          <div class="card-head">
            <div><h2>Low stock</h2><p>Items at or below their reorder level</p></div>
            @if (low().length) { <a class="btn btn-text btn-sm" routerLink="/alerts">All alerts</a> }
          </div>
          @if (low().length) {
            <table class="table">
              <thead><tr><th>Product</th><th class="num">On hand</th><th class="num">Reorder at</th></tr></thead>
              <tbody>
                @for (i of low().slice(0, 6); track i.stockItemId) {
                  <tr class="clickable" (click)="router.navigate(['/stock', i.stockItemId])">
                    <td class="cell-title">{{ i.name }}</td>
                    <td class="num"><span class="qty figure-danger">{{ i.quantityOnHand }}</span>
                      <span class="cell-sub"> {{ plural(i.unit, i.quantityOnHand) }}</span></td>
                    <td class="num secondary">{{ i.reorderLevel }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else if (!items().length) {
            <app-empty-state compact icon="stock" title="No products yet"
                             text="Add the products you sell to track stock, get low-stock alerts and reorder advice.">
              <a class="btn btn-primary btn-sm" routerLink="/stock" [queryParams]="{ new: '' }">Add product</a>
            </app-empty-state>
          } @else {
            <app-empty-state compact icon="checkCircle" tone="ok" title="Nothing is running low"
                             text="Every product is above its reorder level. Alerts appear here as soon as one drops.">
              <a class="btn btn-secondary btn-sm" routerLink="/stock">View stock</a>
            </app-empty-state>
          }
        </section>

        <section class="card card-flush">
          <div class="card-head">
            <div><h2>Recent orders</h2><p>Your latest orders with suppliers</p></div>
            @if (orders().length) { <a class="btn btn-text btn-sm" routerLink="/orders">All orders</a> }
          </div>
          @if (orders().length) {
            <table class="table">
              <thead><tr><th>Order</th><th class="num">Total</th><th>Status</th></tr></thead>
              <tbody>
                @for (o of orders().slice(0, 6); track o.purchaseOrderId) {
                  <tr class="clickable" (click)="router.navigate(['/orders', o.purchaseOrderId])">
                    <td>
                      <div class="cell-title">{{ o.productName }}</div>
                      <div class="cell-sub">{{ o.supplier.name }} · {{ o.createdAt | date: 'd MMM' }}</div>
                    </td>
                    <td class="num">{{ o.total | money }}</td>
                    <td><span class="pill" [class]="'pill ' + tone(o.status)">{{ o.status }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <app-empty-state compact icon="orders" title="No orders yet"
                             text="Compare suppliers' prices and place your first order.">
              <a class="btn btn-primary btn-sm" routerLink="/suppliers">Browse suppliers</a>
            </app-empty-state>
          }
        </section>
      </div>

      @if (alerts().length) {
        <p class="muted small foot">{{ alerts().length }} open low-stock {{ alerts().length === 1 ? 'alert' : 'alerts' }}.</p>
      }
    } @else if (!error()) {
      <div class="card loading">Loading your dashboard…</div>
    }
  `,
  styles: [`
    .link { text-decoration: none; color: inherit; transition: box-shadow var(--transition); }
    .link:hover { box-shadow: var(--shadow-lg); }
    .foot { margin-top: var(--space-4); }
  `],
})
export class OwnerDashboardComponent implements OnInit {
  private api = inject(InventoryApi);
  auth = inject(AuthService);
  router = inject(Router);

  items = signal<StockItem[]>([]);
  orders = signal<Order[]>([]);
  alerts = signal<Alert[]>([]);
  loaded = signal(false);
  error = signal<string | null>(null);

  low = computed(() => this.items().filter(i => i.isLow).sort((a, b) => a.quantityOnHand - b.quantityOnHand));
  openOrders = computed(() => this.orders().filter(isOpenOrder));
  toReceive = computed(() => this.orders().filter(o => o.canReceive));
  firstName = computed(() => (this.auth.user()?.fullName ?? '').split(' ')[0]);
  plural = plural;
  tone = orderTone;

  greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  ngOnInit() {
    forkJoin({ items: this.api.stock(), orders: this.api.orders(), alerts: this.api.alerts() }).subscribe({
      next: r => { this.items.set(r.items); this.orders.set(r.orders); this.alerts.set(r.alerts); this.loaded.set(true); },
      error: err => this.error.set(problemText(err)),
    });
  }
}
