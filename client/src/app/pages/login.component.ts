import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, HOME } from '../auth';
import { problemText } from '../api';
import { AUTH_STYLES } from './auth-layout';

// FR-02: sign in. Each role lands on its own dashboard, or on the page it was sent from.
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page">
      <div class="panel">
        <a class="brand" routerLink="/"><span class="mark">IS</span> IntelliStock</a>
        <form class="card" (ngSubmit)="submit()" #f="ngForm">
          <div class="head">
            <h1>Sign in</h1>
            <p>Welcome back. Use the email you registered with.</p>
          </div>

          <div class="field">
            <label for="email">Email</label>
            <input class="input" id="email" name="email" type="email" [(ngModel)]="email" required autocomplete="username" />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input class="input" id="password" name="password" type="password" [(ngModel)]="password" required
                   autocomplete="current-password" />
          </div>

          @if (error()) { <div class="notice notice-error" role="alert">{{ error() }}</div> }

          <button class="btn btn-primary btn-block btn-lg" type="submit" [disabled]="busy() || !f.valid">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
        <p class="switch">New to IntelliStock? <a routerLink="/register">Create an account</a></p>
      </div>
    </div>
  `,
  styles: [AUTH_STYLES],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  email = '';
  password = '';
  busy = signal(false);
  error = signal<string | null>(null);

  submit() {
    this.busy.set(true);
    this.error.set(null);
    this.auth.login(this.email.trim(), this.password).subscribe({
      next: res => this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('returnUrl') || HOME[res.user.role]),
      error: err => { this.error.set(problemText(err)); this.busy.set(false); },
    });
  }
}
