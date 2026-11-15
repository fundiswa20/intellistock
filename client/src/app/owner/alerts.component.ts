import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Alert, InventoryApi, plural, problemText } from '../api';
import { EmptyStateComponent } from '../shared/empty-state.component';

// FR-05: open low-stock alerts, and the recently resolved ones
@Component({
  selector: 'app-alerts',
  standalone: true,
  imports: [RouterLink, DatePipe, EmptyStateComponent],
  template: `
    <div class="page-head">
      <div>
        <h1>Alerts</h1>
        <p class="subtitle">An alert opens when an item reaches its reorder level, and resolves when a restock takes it back above.</p>
      </div>
      <div class="segmented" role="group" aria-label="Show">
        <button [class.active]="view() === 'open'" (click)="view.set('open')">Open<span class="count">{{ open().length }}</span></button>
        <button [class.active]="view() === 'resolved'" (click)="view.set('resolved')">Resolved<span class="count">{{ resolved().length }}</span></button>
      </div>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (loading()) {
      <div class="card loading">Loading alerts…</div>
    } @else if (!error()) {
      <div class="card card-flush">
        @if (view() === 'open') {
          @if (open().length) {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Product</th><th class="num">At alert</th><th class="num">On hand now</th><th class="num">Reorder level</th><th>Raised</th><th></th></tr></thead>
                <tbody>
                  @for (a of open(); track a.alertId) {
                    <tr class="clickable" (click)="router.navigate(['/stock', a.stockItemId])">
                      <td><div class="cell-title">{{ a.stockItemName }}</div><div class="cell-sub">{{ a.message }}</div></td>
                      <td class="num secondary">{{ a.quantityAtAlert }}</td>
                      <td class="num"><span class="qty figure-danger">{{ a.currentQuantity }}</span>
                        <span class="cell-sub"> {{ plural(a.unit, a.currentQuantity) }}</span></td>
                      <td class="num secondary">{{ a.reorderLevel }}</td>
                      <td class="nowrap secondary">{{ a.createdAt | date: 'd MMM, HH:mm' }}</td>
                      <td class="num"><a class="btn btn-secondary btn-sm" routerLink="/suppliers"
                             [queryParams]="{ q: a.stockItemName, item: a.stockItemId }" (click)="$event.stopPropagation()">Reorder</a></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <app-empty-state icon="checkCircle" tone="ok" title="No open alerts"
                             text="Every product is above its reorder level. You'll see an alert here the moment one drops.">
              <a class="btn btn-secondary btn-sm" routerLink="/stock">View stock</a>
            </app-empty-state>
          }
        } @else {
          @if (resolved().length) {
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Product</th><th class="num">At alert</th><th>Raised</th><th>Resolved</th><th class="num">Open for</th></tr></thead>
                <tbody>
                  @for (a of resolved(); track a.alertId) {
                    <tr class="clickable" (click)="router.navigate(['/stock', a.stockItemId])">
                      <td><div class="cell-title">{{ a.stockItemName }}</div></td>
                      <td class="num secondary">{{ a.quantityAtAlert }} {{ plural(a.unit, a.quantityAtAlert) }}</td>
                      <td class="nowrap secondary">{{ a.createdAt | date: 'd MMM, HH:mm' }}</td>
                      <td class="nowrap secondary">{{ a.resolvedAt | date: 'd MMM, HH:mm' }}</td>
                      <td class="num"><span class="pill pill-plain pill-neutral">{{ duration(a) }}</span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="muted small foot">Showing the latest {{ resolved().length }} resolved alerts.</p>
          } @else {
            <app-empty-state icon="bell" title="No resolved alerts yet"
                             text="When a restock takes an item back above its reorder level, the alert moves here." />
          }
        }
      </div>
    }
  `,
  styles: [`.foot { padding: var(--space-3) var(--space-5); border-top: 1px solid var(--gray-100); }`],
})
export class AlertsComponent implements OnInit {
  private api = inject(InventoryApi);
  router = inject(Router);

  view = signal<'open' | 'resolved'>('open');
  open = signal<Alert[]>([]);
  resolved = signal<Alert[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  plural = plural;

  ngOnInit() {
    forkJoin({ open: this.api.alerts('open'), resolved: this.api.alerts('resolved') }).subscribe({
      next: r => { this.open.set(r.open); this.resolved.set(r.resolved); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  duration(a: Alert) {
    const hours = (new Date(a.resolvedAt!).getTime() - new Date(a.createdAt).getTime()) / 3_600_000;
    if (hours < 1) return 'under 1 h';
    if (hours < 48) return `${Math.round(hours)} h`;
    return `${Math.round(hours / 24)} days`;
  }
}
