import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../auth';
import { IconComponent } from '../shared/icon.component';

// Shown when a signed-in user opens a page that belongs to the other role
@Component({
  selector: 'app-not-authorised',
  standalone: true,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="card wrap">
      <div class="badge"><app-icon name="lock" [size]="24" /></div>
      <h1>You don't have access to this page</h1>
      <p>
        You're signed in as a <strong>{{ auth.role() === 'Supplier' ? 'supplier' : 'shop owner' }}</strong>,
        and this page is for {{ auth.role() === 'Supplier' ? 'shop owners' : 'suppliers' }}.
        If you need both, register a separate account for the other role.
      </p>
      <div class="actions">
        <a class="btn btn-primary" [routerLink]="auth.home()">Go to your dashboard</a>
        <button class="btn btn-secondary" (click)="auth.logout()">Sign out</button>
      </div>
    </div>
  `,
  styles: [`
    .wrap { max-width: 560px; margin: var(--space-8) auto; padding: var(--space-8) var(--space-6);
            display: grid; justify-items: center; text-align: center; gap: var(--space-3); }
    .badge { display: grid; place-items: center; width: 56px; height: 56px; border-radius: var(--radius-lg);
             background: var(--red-50); color: var(--red-600); margin-bottom: var(--space-2); }
    h1 { font-size: var(--text-xl); }
    p { color: var(--text-secondary); max-width: 440px; }
    .actions { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
  `],
})
export class NotAuthorisedComponent {
  auth = inject(AuthService);
}
