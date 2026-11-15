import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { InventoryApi, LOW_PACKS } from '../api';
import { AuthService } from '../auth';
import { IconComponent } from '../shared/icon.component';

interface NavItem { label: string; link: string; icon: string; exact?: boolean; }
interface Badge { count?: number; label: string; }

const OWNER_NAV: NavItem[] = [
  { label: 'Dashboard', link: '/dashboard', icon: 'dashboard' },
  { label: 'Stock', link: '/stock', icon: 'stock' },
  { label: 'Alerts', link: '/alerts', icon: 'bell' },
  { label: 'Suppliers', link: '/suppliers', icon: 'truck' },
  { label: 'Orders', link: '/orders', icon: 'orders' },
  { label: 'Settings', link: '/settings', icon: 'settings' },
];

const SUPPLIER_NAV: NavItem[] = [
  { label: 'Dashboard', link: '/supplier/dashboard', icon: 'dashboard' },
  { label: 'Listings', link: '/supplier/listings', icon: 'tag' },
  { label: 'Orders', link: '/supplier/orders', icon: 'orders' },
  { label: 'Settings', link: '/supplier/settings', icon: 'settings' },
];

// The signed-in layout: a persistent sidebar, a header with the user and sign out, and
// the page. The sidebar's items depend on the role.
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  template: `
    <div class="shell" [class.nav-open]="navOpen()">
      <aside class="sidebar">
        <a class="brand" [routerLink]="auth.home()">
          <span class="mark">IS</span>
          <span>IntelliStock</span>
        </a>
        <div class="role">{{ auth.role() === 'Supplier' ? 'Supplier' : 'Shop owner' }}</div>
        <nav>
          @for (item of nav(); track item.link) {
            <a class="nav-item" [routerLink]="item.link" routerLinkActive="active" (click)="navOpen.set(false)">
              <app-icon [name]="item.icon" />
              <span>{{ item.label }}</span>
              @if (badges()[item.link]; as b) {
                @if (b.count) { <span class="badge" [attr.aria-label]="b.label">{{ b.count }}</span> }
                @else { <span class="dot" [attr.aria-label]="b.label" role="img"></span> }
              }
            </a>
          }
        </nav>
        <div class="org">
          <div class="org-name">{{ auth.orgName() }}</div>
        </div>
      </aside>
      <div class="scrim" (click)="navOpen.set(false)"></div>

      <div class="main">
        <header class="header">
          <button class="icon-btn menu" (click)="navOpen.set(true)" aria-label="Open navigation">
            <app-icon name="menu" [size]="20" />
          </button>
          <div class="spacer"></div>
          @if (auth.user(); as user) {
            <div class="who">
              <span class="avatar" aria-hidden="true">{{ initials() }}</span>
              <div class="who-text">
                <div class="who-name">{{ user.fullName }}</div>
                <div class="who-org">{{ auth.orgName() }}</div>
              </div>
            </div>
          }
          <button class="btn btn-secondary btn-sm" (click)="auth.logout()">
            <app-icon name="logout" [size]="16" /> Sign out
          </button>
        </header>
        <main class="content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [`
    .shell { min-height: 100vh; display: grid; grid-template-columns: var(--sidebar-width) minmax(0, 1fr); }

    .sidebar {
      position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column;
      background: var(--green-900); color: #fff; padding: var(--space-5) var(--space-3);
    }
    .brand { display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-3);
             color: #fff; text-decoration: none; font-weight: 700; font-size: var(--text-lg); letter-spacing: -0.01em; }
    .mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius);
            background: var(--green-600); font-size: var(--text-xs); font-weight: 700; letter-spacing: .02em; }
    .role { margin: var(--space-5) var(--space-3) var(--space-2); font-size: 11px; font-weight: 600;
            text-transform: uppercase; letter-spacing: .08em; color: rgba(255,255,255,.5); }
    nav { display: grid; gap: 2px; }
    .nav-item {
      position: relative; display: flex; align-items: center; gap: var(--space-3);
      height: 40px; padding: 0 var(--space-3); border-radius: var(--radius);
      color: rgba(255,255,255,.78); text-decoration: none; font-weight: 500;
      transition: background-color var(--transition), color var(--transition);
    }
    .nav-item:hover { background: rgba(255,255,255,.07); color: #fff; }
    .nav-item:focus-visible { outline: 2px solid var(--green-200); outline-offset: -2px; }
    .nav-item.active { background: rgba(255,255,255,.12); color: #fff; font-weight: 600; }
    .nav-item.active::before {
      content: ""; position: absolute; left: calc(-1 * var(--space-3)); top: 8px; bottom: 8px; width: 3px;
      border-radius: 0 3px 3px 0; background: var(--green-200);
    }
    .badge { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
             display: inline-grid; place-items: center; background: var(--red-600); color: #fff;
             font-size: 11px; font-weight: 700; line-height: 1; }
    .dot { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: var(--red-600);
           box-shadow: 0 0 0 2px var(--green-900); }
    .org { margin-top: auto; padding: var(--space-4) var(--space-3) 0; border-top: 1px solid rgba(255,255,255,.1); }
    .org-name { font-size: var(--text-sm); color: rgba(255,255,255,.7); font-weight: 500; }

    .main { display: flex; flex-direction: column; min-width: 0; }
    .header {
      position: sticky; top: 0; z-index: 10; height: var(--header-height);
      display: flex; align-items: center; gap: var(--space-4); padding: 0 var(--space-6);
      background: rgba(242, 246, 244, .92); backdrop-filter: blur(6px); border-bottom: 1px solid var(--gray-200);
    }
    .spacer { flex: 1; }
    .who { display: flex; align-items: center; gap: var(--space-3); }
    .avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
              background: var(--green-100); color: var(--green-800); font-size: var(--text-xs); font-weight: 700; }
    .who-text { line-height: 1.3; }
    .who-name { font-weight: 600; font-size: var(--text-sm); }
    .who-org { font-size: var(--text-xs); color: var(--text-muted); }
    .content { width: 100%; max-width: 1240px; margin: 0 auto; padding: var(--space-6); }

    .menu, .scrim { display: none; }

    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: fixed; z-index: 40; left: 0; top: 0; width: var(--sidebar-width);
                 transform: translateX(-100%); visibility: hidden; }
      .nav-open .sidebar { transform: none; visibility: visible; }
      .nav-open .scrim { display: block; position: fixed; inset: 0; z-index: 30; background: rgba(14,26,20,.4); }
      .menu { display: inline-grid; }
      .header { padding: 0 var(--space-4); }
      .who-text { display: none; }
      .content { padding: var(--space-5) var(--space-4); }
    }
  `],
})
export class ShellComponent {
  auth = inject(AuthService);
  navOpen = signal(false);
  nav = computed(() => (this.auth.role() === 'Supplier' ? SUPPLIER_NAV : OWNER_NAV));
  initials = computed(() =>
    (this.auth.user()?.fullName ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join(''));

  // what needs the user's attention, per nav link; refreshed on every navigation, no realtime
  badges = signal<Record<string, Badge>>({});
  private api = inject(InventoryApi);

  constructor() {
    inject(Router).events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.navOpen.set(false);
      this.refreshBadges();
    });
  }

  private set(link: string, badge: Badge | null) {
    const next = { ...this.badges() };
    if (badge) next[link] = badge; else delete next[link];
    this.badges.set(next);
  }

  private refreshBadges() {
    const quiet = { error: () => {} };
    if (this.auth.role() === 'Supplier') {
      this.api.supplierOrders().subscribe({ ...quiet, next: o => {
        const n = o.filter(x => x.status === 'Placed').length;
        this.set('/supplier/orders', n ? { label: `${n} orders to confirm` } : null);
      } });
      this.api.myListings().subscribe({ ...quiet, next: l => {
        const n = l.filter(x => x.isActive && x.availableQuantity <= LOW_PACKS).length;
        this.set('/supplier/listings', n ? { label: `${n} listings low on stock` } : null);
      } });
    } else if (this.auth.role() === 'BusinessOwner') {
      this.api.alerts('open').subscribe({ ...quiet, next: a =>
        this.set('/alerts', a.length ? { count: a.length, label: `${a.length} open alerts` } : null) });
      // orders waiting on the owner: delivered and not yet received into stock
      this.api.orders().subscribe({ ...quiet, next: o => {
        const n = o.filter(x => x.canReceive).length;
        this.set('/orders', n ? { label: `${n} orders to receive` } : null);
      } });
    }
  }
}
