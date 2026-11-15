import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, HOME, Registration, Role } from '../auth';
import { problemText } from '../api';
import { AUTH_STYLES } from './auth-layout';

// FR-01: one form for both roles; the shop or company fields follow the choice
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page">
      <div class="panel">
        <a class="brand" routerLink="/"><span class="mark">IS</span> IntelliStock</a>
        <form class="card" (ngSubmit)="submit()" #f="ngForm">
          <div class="head">
            <h1>Create an account</h1>
            <p>Takes a minute. You can change these details later in Settings.</p>
          </div>

          <div class="field">
            <span class="field-label">I am</span>
            <div class="segmented roles" role="group" aria-label="Account type">
              <button type="button" [class.active]="r.role === 'BusinessOwner'" (click)="setRole('BusinessOwner')">A shop owner</button>
              <button type="button" [class.active]="r.role === 'Supplier'" (click)="setRole('Supplier')">A supplier</button>
            </div>
          </div>

          <div class="field">
            <label for="fullName">Your name</label>
            <input class="input" id="fullName" name="fullName" [(ngModel)]="r.fullName" required minlength="2" autocomplete="name" />
          </div>

          @if (r.role === 'BusinessOwner') {
            <div class="field">
              <label for="businessName">Shop name</label>
              <input class="input" id="businessName" name="businessName" [(ngModel)]="r.businessName" required />
            </div>
            <div class="field">
              <label for="location">Where is the shop?</label>
              <input class="input" id="location" name="location" [(ngModel)]="r.location" required
                     placeholder="e.g. Section 3, Khayelitsha" />
            </div>
          } @else {
            <div class="field">
              <label for="companyName">Company name</label>
              <input class="input" id="companyName" name="companyName" [(ngModel)]="r.companyName" required />
            </div>
            <div class="field">
              <label for="deliveryArea">Areas you deliver to <span class="muted">(optional)</span></label>
              <input class="input" id="deliveryArea" name="deliveryArea" [(ngModel)]="r.deliveryArea"
                     placeholder="e.g. Cape Flats, Mitchells Plain" />
            </div>
          }

          <div class="field">
            <label for="email">Email</label>
            <input class="input" id="email" name="email" type="email" [(ngModel)]="r.email" required email autocomplete="email" />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input class="input" id="password" name="password" type="password" [(ngModel)]="r.password" required
                   minlength="8" autocomplete="new-password" />
            <span class="hint">At least 8 characters.</span>
          </div>

          @if (error()) { <div class="notice notice-error" role="alert">{{ error() }}</div> }

          <button class="btn btn-primary btn-block btn-lg" type="submit" [disabled]="busy() || !f.valid">
            {{ busy() ? 'Creating your account…' : 'Create account' }}
          </button>
        </form>
        <p class="switch">Already registered? <a routerLink="/login">Sign in</a></p>
      </div>
    </div>
  `,
  styles: [AUTH_STYLES, `.roles { display: grid; grid-template-columns: 1fr 1fr; } .roles button { height: 36px; }`],
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  r: Registration = {
    role: 'BusinessOwner', fullName: '', email: '', password: '', phone: null,
    businessName: '', location: '', companyName: '', deliveryArea: '',
  };
  busy = signal(false);
  error = signal<string | null>(null);

  setRole(role: Role) { this.r.role = role; }

  submit() {
    this.busy.set(true);
    this.error.set(null);
    const owner = this.r.role === 'BusinessOwner';
    this.auth.register({
      ...this.r,
      email: this.r.email.trim(),
      businessName: owner ? this.r.businessName : null,
      location: owner ? this.r.location : null,
      companyName: owner ? null : this.r.companyName,
      deliveryArea: owner ? null : this.r.deliveryArea,
    }).subscribe({
      next: res => this.router.navigateByUrl(HOME[res.user.role]),
      error: err => { this.error.set(problemText(err)); this.busy.set(false); },
    });
  }
}
