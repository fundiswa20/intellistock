import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Listing, ListingRequest, SupplierApi, problemText } from './api';

// FR-06: the signed-in supplier's price list, and adding to it
@Component({
  selector: 'app-supplier-listings',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="heading">
      <div>
        <h1>Listings</h1>
        @if (listings().length) { <p class="muted">{{ listings().length }} products on your price list</p> }
      </div>
    </div>

    <form class="card add" (ngSubmit)="add(f)" #f="ngForm">
      <h2>Add listing</h2>
      <div class="fields">
        <label class="wide">Product name
          <input name="productName" [(ngModel)]="draft.productName" required /></label>
        <label>Category
          <input name="category" [(ngModel)]="draft.category" required /></label>
        <label>Pack size
          <input name="packSize" type="number" min="1" step="1" [(ngModel)]="draft.packSize" required /></label>
        <label>Pack price (R)
          <input name="packPrice" type="number" min="0" step="0.01" [(ngModel)]="draft.packPrice" required /></label>
        <label>Available (units)
          <input name="availableQuantity" type="number" min="0" step="1" [(ngModel)]="draft.availableQuantity" required /></label>
        <label>Lead time (days)
          <input name="leadTimeDays" type="number" min="0" step="1" [(ngModel)]="draft.leadTimeDays" required /></label>
        <label>Delivery cost (R)
          <input name="deliveryCost" type="number" min="0" step="0.01" [(ngModel)]="draft.deliveryCost" required /></label>
      </div>
      @if (saveError()) { <div class="error">{{ saveError() }}</div> }
      <button class="btn btn-primary" type="submit" [disabled]="saving() || !f.valid">
        {{ saving() ? 'Adding…' : 'Add listing' }}
      </button>
    </form>

    @if (error()) { <div class="error">{{ error() }}</div> }
    @if (loading()) { <div class="card empty muted">Loading listings…</div> }
    @else if (!listings().length && !error()) { <div class="card empty muted">No listings yet.</div> }

    @if (listings().length) {
      <div class="card table-card">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th class="num">Pack size</th>
              <th class="num">Pack price</th>
              <th class="num">Available</th>
              <th class="num">Lead time</th>
              <th class="num">Delivery</th>
            </tr>
          </thead>
          <tbody>
            @for (l of listings(); track l.supplierListingId) {
              <tr>
                <td class="name">{{ l.productName }}</td>
                <td>{{ l.category }}</td>
                <td class="num">{{ l.packSize }}</td>
                <td class="num">R {{ l.packPrice.toFixed(2) }}</td>
                <td class="num">{{ l.availableQuantity }}</td>
                <td class="num">{{ l.leadTimeDays }} {{ l.leadTimeDays === 1 ? 'day' : 'days' }}</td>
                <td class="num">R {{ l.deliveryCost.toFixed(2) }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .heading { display: flex; align-items: flex-end; margin-bottom: 18px; }
    h1 { margin: 0 0 4px; }
    .heading p { margin: 0; }
    .add { padding: 20px 22px; margin-bottom: 20px; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px 16px;
              margin-bottom: 14px; }
    .fields .wide { grid-column: span 2; }
    label { display: block; font-size: 13px; font-weight: 600; }
    label input { display: block; width: 100%; margin-top: 6px; font-weight: 400; }
    .add .error { margin-bottom: 14px; }
    .name { font-weight: 600; }
  `],
})
export class SupplierListingsComponent implements OnInit {
  private api = inject(SupplierApi);

  listings = signal<Listing[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  saving = signal(false);
  saveError = signal<string | null>(null);
  draft = SupplierListingsComponent.blank();

  ngOnInit() { this.load(); }

  load() {
    this.api.listings().subscribe({
      next: listings => { this.listings.set(listings); this.error.set(null); this.loading.set(false); },
      error: err => { this.error.set(problemText(err)); this.loading.set(false); },
    });
  }

  add(form: NgForm) {
    this.saving.set(true);
    this.saveError.set(null);
    this.api.createListing({ ...this.draft, productName: this.draft.productName.trim(),
                             category: this.draft.category.trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        form.resetForm(SupplierListingsComponent.blank());
        this.load();
      },
      error: err => { this.saveError.set(problemText(err)); this.saving.set(false); },
    });
  }

  private static blank(): ListingRequest {
    return { productName: '', category: '', packSize: 1, packPrice: 0,
             availableQuantity: 0, leadTimeDays: 1, deliveryCost: 0 };
  }
}
