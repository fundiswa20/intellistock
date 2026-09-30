import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from './auth';
import { problemText } from './api';

// FR-02: sign in. Accounts are seeded - there is no registration screen (FR-01 Partial).
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page">
      <form class="card login" (ngSubmit)="submit()" #f="ngForm">
        <div class="logo">IS</div>
        <h1>IntelliStock</h1>
        <p class="muted tagline">Stock control and reorder advice for spaza shops</p>

        <label for="email">Email</label>
        <input id="email" name="email" type="email" [(ngModel)]="email" required autocomplete="username" />

        <label for="password">Password</label>
        <input id="password" name="password" type="password" [(ngModel)]="password" required
               autocomplete="current-password" />

        @if (error()) { <div class="error">{{ error() }}</div> }

        <button class="btn btn-primary wide" type="submit" [disabled]="busy() || !f.valid">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  `,
  styles: [`
    .page { min-height: 100vh; display: grid; place-items: center;
            background: linear-gradient(160deg, var(--brand-dark) 0%, var(--brand) 100%); }
    .login { width: 360px; padding: 36px 32px; }
    .logo { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px;
            background: var(--brand); color: #fff; font-weight: 700; margin-bottom: 14px; }
    h1 { margin: 0; font-size: 26px; }
    .tagline { margin: 4px 0 24px; }
    label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
    input { width: 100%; }
    .error { margin-top: 14px; }
    .wide { width: 100%; margin-top: 22px; padding: 11px; }
  `],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  busy = signal(false);
  error = signal<string | null>(null);

  submit() {
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(this.email.trim(), this.password).subscribe({
      next: () => this.router.navigate(['/stock']),
      error: err => { this.error.set(problemText(err)); this.busy.set(false); },
    });
  }
}
