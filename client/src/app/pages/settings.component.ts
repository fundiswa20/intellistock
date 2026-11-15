import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Account, InventoryApi, problemText } from '../api';
import { AuthService } from '../auth';

// The signed-in user's own profile, for either role
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, DatePipe, PercentPipe],
  template: `
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <p class="subtitle">Your profile and {{ owner ? 'shop' : 'company' }} details.</p>
      </div>
    </div>

    @if (error()) { <div class="notice notice-error">{{ error() }}</div> }

    @if (account(); as a) {
      <div class="layout">
        <form class="card" (ngSubmit)="save()" #f="ngForm">
          <div class="card-head"><h2>Profile</h2></div>
          <div class="form-grid">
            <div class="field span-2">
              <label for="fullName">Your name</label>
              <input class="input" id="fullName" name="fullName" [(ngModel)]="form.fullName" required minlength="2" />
            </div>
            @if (owner) {
              <div class="field">
                <label for="businessName">Shop name</label>
                <input class="input" id="businessName" name="businessName" [(ngModel)]="form.businessName" required />
              </div>
              <div class="field">
                <label for="location">Location</label>
                <input class="input" id="location" name="location" [(ngModel)]="form.location" required />
              </div>
            } @else {
              <div class="field">
                <label for="companyName">Company name</label>
                <input class="input" id="companyName" name="companyName" [(ngModel)]="form.companyName" required />
              </div>
              <div class="field">
                <label for="deliveryArea">Delivery area</label>
                <input class="input" id="deliveryArea" name="deliveryArea" [(ngModel)]="form.deliveryArea" />
              </div>
            }
            <div class="field">
              <label for="phone">Phone</label>
              <input class="input" id="phone" name="phone" [(ngModel)]="form.phone" maxlength="20" />
            </div>
            <div class="field">
              <label for="email">Email</label>
              <input class="input" id="email" name="email" [value]="a.email" readonly />
              <span class="hint">Your email is how you sign in, so it can't be changed here.</span>
            </div>
          </div>
          @if (saved()) { <div class="notice notice-success saved">Saved.</div> }
          <div class="foot">
            <button class="btn btn-primary" type="submit" [disabled]="saving() || !f.valid">
              {{ saving() ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </form>

        <aside class="card">
          <div class="card-head"><h2>Account</h2></div>
          <dl class="dl">
            <dt>Type</dt><dd>{{ owner ? 'Shop owner' : 'Supplier' }}</dd>
            <dt>Member since</dt><dd>{{ a.createdAt | date: 'd MMM y' }}</dd>
            @if (!owner) {
              <dt>Reliability</dt><dd>{{ a.reliabilityScore === null ? '—' : (a.reliabilityScore | percent) }}</dd>
            }
          </dl>
          @if (!owner) {
            <p class="muted small note">Reliability is the share of your orders delivered on time. Shops see it next to your listings.</p>
          }
        </aside>
      </div>
    } @else if (!error()) {
      <div class="card loading">Loading your profile…</div>
    }
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 2fr 1fr; gap: var(--space-5); align-items: start; }
    .foot { display: flex; justify-content: flex-end; margin-top: var(--space-5); }
    .saved { margin: var(--space-4) 0 0; }
    .note { margin-top: var(--space-4); }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
  `],
})
export class SettingsComponent implements OnInit {
  private api = inject(InventoryApi);
  private auth = inject(AuthService);

  owner = this.auth.role() === 'BusinessOwner';
  account = signal<Account | null>(null);
  form: Partial<Account> = {};
  error = signal<string | null>(null);
  saving = signal(false);
  saved = signal(false);

  ngOnInit() {
    this.api.account().subscribe({
      next: a => { this.account.set(a); this.form = { ...a }; },
      error: err => this.error.set(problemText(err)),
    });
  }

  save() {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.api.updateAccount(this.form).subscribe({
      next: a => {
        this.account.set(a);
        this.form = { ...a };
        this.auth.updateUser({ fullName: a.fullName, businessName: a.businessName, companyName: a.companyName });
        this.saving.set(false);
        this.saved.set(true);
      },
      error: err => { this.error.set(problemText(err)); this.saving.set(false); },
    });
  }
}
