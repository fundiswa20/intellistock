import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from './auth';

// UML: InventoryDashboard - the Angular client's root component
@Component({
  selector: 'inventory-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    @if (auth.user(); as user) {
      <header class="topbar">
        <a class="brand" [routerLink]="user.role === 'Supplier' ? '/supplier/listings' : '/stock'">
          <span class="logo">IS</span>
          <span>IntelliStock</span>
        </a>
        <nav>
          @if (user.role === 'Supplier') {
            <a routerLink="/supplier/listings" [class.active]="section() === 'listings'">My listings</a>
            <a routerLink="/supplier/orders" [class.active]="section() === 'orders'">Orders</a>
          } @else {
            <a routerLink="/stock" [class.active]="section() === 'stock'">Stock</a>
            <a routerLink="/stock" fragment="needs-attention" [class.active]="section() === 'alerts'">Alerts</a>
          }
        </nav>
        <div class="who">
          <div class="business">{{ user.businessName ?? user.companyName }}</div>
          <div class="person">{{ user.fullName }}</div>
        </div>
        <button class="btn btn-ghost" (click)="auth.logout()">Sign out</button>
      </header>
    }
    <main [class.bare]="!auth.user()">
      <router-outlet />
    </main>
  `,
  styles: [`
    .topbar {
      display: flex; align-items: center; gap: 16px;
      padding: 12px 28px; background: var(--brand-dark); color: #fff;
    }
    .brand { display: flex; align-items: center; gap: 10px; color: #fff; text-decoration: none;
             font-weight: 700; font-size: 18px; letter-spacing: .2px; }
    .logo { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px;
            background: var(--brand); font-size: 13px; }
    nav { display: flex; gap: 4px; margin-left: 12px; margin-right: auto; }
    nav a { color: #fff; text-decoration: none; font-weight: 600; font-size: 14px;
            padding: 7px 12px; border-radius: 8px; opacity: .75; }
    nav a:hover { opacity: 1; background: rgba(255,255,255,.1); }
    nav a.active { opacity: 1; background: rgba(255,255,255,.16); }
    .who { text-align: right; line-height: 1.25; }
    .business { font-weight: 600; }
    .person { font-size: 13px; opacity: .75; }
    .btn-ghost { color: #fff; border-color: rgba(255,255,255,.35); }
    .btn-ghost:hover { background: rgba(255,255,255,.1); }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    main.bare { max-width: none; padding: 0; }
  `],
})
export class InventoryDashboard {
  auth = inject(AuthService);
  private router = inject(Router);

  private url = toSignal(this.router.events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(e => (e as NavigationEnd).urlAfterRedirects)), { initialValue: this.router.url });

  // "Alerts" is the needs-attention group on the stock list, so it shares /stock
  section = computed(() => {
    const url = this.url();
    if (url.startsWith('/supplier/orders')) return 'orders';
    if (url.startsWith('/supplier')) return 'listings';
    if (url.includes('#needs-attention')) return 'alerts';
    return url.startsWith('/stock') ? 'stock' : null;
  });
}
