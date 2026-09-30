import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from './auth';

// UML: InventoryDashboard - the Angular client's root component
@Component({
  selector: 'inventory-dashboard',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    @if (auth.user(); as user) {
      <header class="topbar">
        <a class="brand" routerLink="/stock">
          <span class="logo">IS</span>
          <span>IntelliStock</span>
        </a>
        <div class="who">
          <div class="business">{{ user.businessName }}</div>
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
             font-weight: 700; font-size: 18px; letter-spacing: .2px; margin-right: auto; }
    .logo { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px;
            background: var(--brand); font-size: 13px; }
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
}
