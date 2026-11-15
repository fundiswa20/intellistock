import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../shared/icon.component';

// What IntelliStock is and who it is for, in one screen, for signed-out visitors
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="page">
      <header class="top">
        <div class="brand"><span class="mark">IS</span> IntelliStock</div>
        <div class="top-actions">
          <a class="btn btn-text" routerLink="/login">Sign in</a>
          <a class="btn btn-primary" routerLink="/register">Create an account</a>
        </div>
      </header>

      <main class="hero">
        <div class="intro">
          <div class="label">Stock control for spaza shops</div>
          <h1>Know what to reorder before the shelf runs empty.</h1>
          <p class="lead">
            IntelliStock records every sale and delivery, warns you when a product runs low, and forecasts
            how much to order and by when. Order from local suppliers in the same place.
          </p>
          <div class="cta">
            <a class="btn btn-primary btn-lg" routerLink="/register">Create an account</a>
            <a class="btn btn-secondary btn-lg" routerLink="/login">Sign in</a>
          </div>
        </div>

        <div class="audiences">
          <section class="card audience">
            <div class="icon"><app-icon name="store" [size]="20" /></div>
            <h2>For shop owners</h2>
            <ul>
              <li><app-icon name="check" [size]="16" /> Stock on hand, kept from every sale and restock</li>
              <li><app-icon name="check" [size]="16" /> Low-stock alerts at the level you set</li>
              <li><app-icon name="check" [size]="16" /> A reorder date and quantity, forecast from your sales</li>
              <li><app-icon name="check" [size]="16" /> Compare suppliers' prices and order in one step</li>
            </ul>
          </section>
          <section class="card audience">
            <div class="icon"><app-icon name="truck" [size]="20" /></div>
            <h2>For suppliers</h2>
            <ul>
              <li><app-icon name="check" [size]="16" /> List your products, pack sizes and prices</li>
              <li><app-icon name="check" [size]="16" /> Receive orders from shops in your area</li>
              <li><app-icon name="check" [size]="16" /> Confirm, dispatch and deliver, with the shop kept informed</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100vh; display: flex; flex-direction: column; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4);
           padding: var(--space-4) var(--space-6); }
    .brand { display: flex; align-items: center; gap: var(--space-3); font-weight: 700; font-size: var(--text-lg); color: var(--green-900); }
    .mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius);
            background: var(--green-700); color: #fff; font-size: var(--text-xs); }
    .top-actions { display: flex; gap: var(--space-2); }
    .hero { flex: 1; width: 100%; max-width: 1160px; margin: 0 auto; padding: var(--space-8) var(--space-6);
            display: grid; grid-template-columns: 1.1fr 1fr; gap: var(--space-8); align-items: center; }
    .intro { display: grid; gap: var(--space-4); }
    h1 { font-size: 44px; line-height: 1.1; letter-spacing: -0.03em; color: var(--green-900); max-width: 560px; }
    .lead { font-size: var(--text-lg); line-height: 1.6; color: var(--text-secondary); max-width: 520px; }
    .cta { display: flex; gap: var(--space-3); margin-top: var(--space-3); flex-wrap: wrap; }
    .audiences { display: grid; gap: var(--space-4); }
    .audience { display: grid; gap: var(--space-3); padding: var(--space-5) var(--space-6); }
    .icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius);
            background: var(--green-50); color: var(--green-700); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
    li { display: flex; gap: var(--space-2); align-items: flex-start; color: var(--gray-700); }
    li app-icon { color: var(--green-600); margin-top: 4px; }
    @media (max-width: 900px) {
      .hero { grid-template-columns: 1fr; padding: var(--space-5) var(--space-4); gap: var(--space-6); }
      h1 { font-size: 34px; }
      .top { padding: var(--space-3) var(--space-4); }
      .top-actions .btn-primary { display: none; }
    }
  `],
})
export class LandingComponent {}
