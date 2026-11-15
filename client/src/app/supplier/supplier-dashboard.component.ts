import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { InventoryApi, MyListing, Order, isOpenOrder, orderTone, problemText } from '../api';
import { AuthService } from '../auth';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { MoneyPipe } from '../shared/money.pipe';

// The supplier's overview: orders to act on, and listings running out
@Component({
  selector: 'app-supplier-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe, MoneyPipe, EmptyStateComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>{{ auth.orgName() }}</h1>
        <p class="subtitle">Orders waiting on you and listings that need restocking.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" routerLink="/supplier/listings">Manage listings</a>
        <a class="btn btn-primary" routerLink="/supplier/orders">View orders</a>
      </div>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (loaded()) {
      <div class="kpis">
        <a class="card kpi link" [class.kpi-accent]="newOrders().length > 0" routerLink="/supplier/orders">
          <span class="label">New orders</span>
          <span class="figure" [class.figure-accent]="newOrders().length > 0">{{ newOrders().length }}</span>
          <span class="hint">waiting for you to confirm</span>
        </a>
        <a class="card kpi link" routerLink="/supplier/orders">
          <span class="label">In progress</span>
          <span class="figure">{{ inProgress().length }}</span>
          <span class="hint">confirmed or on the way</span>
        </a>
        <a class="card kpi link" routerLink="/supplier/listings">
          <span class="label">Active listings</span>
          <span class="figure">{{ active().length }}</span>
          <span class="hint">of {{ listings().length }} on your price list</span>
        </a>
        <div class="card kpi">
          <span class="label">Open order value</span>
          <span class="figure">{{ openValue() | money }}</span>
          <span class="hint">placed, confirmed or on the way</span>
        </div>
      </div>

      <div class="grid-2">
        <section class="card card-flush">
          <div class="card-head">
            <div><h2>Orders to act on</h2><p>Oldest first</p></div>
            @if (toAct().length) { <a class="btn btn-text btn-sm" routerLink="/supplier/orders">All orders</a> }
          </div>
          @if (toAct().length) {
            <table class="table">
              <thead><tr><th>Order</th><th class="num">Total</th><th>Status</th></tr></thead>
              <tbody>
                @for (o of toAct().slice(0, 6); track o.purchaseOrderId) {
                  <tr class="clickable" (click)="router.navigate(['/supplier/orders', o.purchaseOrderId])">
                    <td>
                      <div class="cell-title">{{ o.packs }} × {{ o.productName }}</div>
                      <div class="cell-sub">{{ o.owner?.name }} · {{ o.createdAt | date: 'd MMM' }}</div>
                    </td>
                    <td class="num">{{ o.total | money }}</td>
                    <td><span [class]="'pill ' + tone(o.status)">{{ o.status }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <app-empty-state compact icon="checkCircle" tone="ok" title="You're up to date"
                             text="No orders are waiting on you. New orders from shops appear here." />
          }
        </section>

        <section class="card card-flush">
          <div class="card-head">
            <div><h2>Running low</h2><p>Active listings with 5 packs or fewer available</p></div>
          </div>
          @if (low().length) {
            <table class="table">
              <thead><tr><th>Listing</th><th class="num">Available</th></tr></thead>
              <tbody>
                @for (l of low(); track l.supplierListingId) {
                  <tr class="clickable" (click)="router.navigate(['/supplier/listings'])">
                    <td><div class="cell-title">{{ l.productName }}</div><div class="cell-sub">packs of {{ l.packSize }}</div></td>
                    <td class="num">
                      @if (l.availableQuantity === 0) { <span class="pill pill-danger">Out of stock</span> }
                      @else { <span class="qty figure-danger">{{ l.availableQuantity }}</span> <span class="cell-sub">packs</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          } @else if (listings().length) {
            <app-empty-state compact icon="checkCircle" tone="ok" title="All listings are well stocked"
                             text="Listings with 5 packs or fewer available show up here." />
          } @else {
            <app-empty-state compact icon="tag" title="No listings yet"
                             text="Add your products, pack sizes and prices so shops can order from you.">
              <a class="btn btn-primary btn-sm" routerLink="/supplier/listings">Add a listing</a>
            </app-empty-state>
          }
        </section>
      </div>
    } @else if (!error()) {
      <div class="card loading">Loading your dashboard…</div>
    }
  `,
  styles: [`
    .link { text-decoration: none; color: inherit; transition: box-shadow var(--transition); }
    .link:hover { box-shadow: var(--shadow-lg); }
  `],
})
export class SupplierDashboardComponent implements OnInit {
  private api = inject(InventoryApi);
  auth = inject(AuthService);
  router = inject(Router);

  orders = signal<Order[]>([]);
  listings = signal<MyListing[]>([]);
  loaded = signal(false);
  error = signal<string | null>(null);
  tone = orderTone;

  newOrders = computed(() => this.orders().filter(o => o.status === 'Placed'));
  inProgress = computed(() => this.orders().filter(o => o.status === 'Confirmed' || o.status === 'Dispatched'));
  toAct = computed(() => this.orders().filter(isOpenOrder)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  openValue = computed(() => this.orders().filter(isOpenOrder).reduce((sum, o) => sum + o.total, 0));
  active = computed(() => this.listings().filter(l => l.isActive));
  low = computed(() => this.active().filter(l => l.availableQuantity <= 5)
    .sort((a, b) => a.availableQuantity - b.availableQuantity).slice(0, 6));

  ngOnInit() {
    forkJoin({ orders: this.api.supplierOrders(), listings: this.api.myListings() }).subscribe({
      next: r => { this.orders.set(r.orders); this.listings.set(r.listings); this.loaded.set(true); },
      error: err => this.error.set(problemText(err)),
    });
  }
}
