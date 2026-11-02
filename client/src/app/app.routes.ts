import { Routes } from '@angular/router';
import { authGuard, supplierGuard } from './auth';
import { LoginComponent } from './login.component';
import { StockListComponent } from './stock-list.component';
import { StockItemComponent } from './stock-item.component';
import { SupplierListingsComponent } from './supplier-listings.component';
import { SupplierOrdersComponent } from './supplier-orders.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Sign in · IntelliStock' },
  { path: 'stock', component: StockListComponent, canActivate: [authGuard], title: 'Stock · IntelliStock' },
  { path: 'stock/:id', component: StockItemComponent, canActivate: [authGuard], title: 'Item · IntelliStock' },
  { path: 'supplier/listings', component: SupplierListingsComponent, canActivate: [supplierGuard],
    title: 'Listings · IntelliStock' },
  { path: 'supplier/orders', component: SupplierOrdersComponent, canActivate: [supplierGuard],
    title: 'Orders · IntelliStock' },
  { path: '', pathMatch: 'full', redirectTo: 'stock' },
  { path: '**', redirectTo: 'stock' },
];
