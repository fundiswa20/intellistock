import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './auth';
import { ShellComponent } from './layout/shell.component';
import { LandingComponent } from './pages/landing.component';
import { LoginComponent } from './pages/login.component';
import { RegisterComponent } from './pages/register.component';
import { NotAuthorisedComponent } from './pages/not-authorised.component';
import { SettingsComponent } from './pages/settings.component';
import { OwnerDashboardComponent } from './owner/owner-dashboard.component';
import { StockListComponent } from './owner/stock-list.component';
import { StockItemComponent } from './owner/stock-item.component';
import { AlertsComponent } from './owner/alerts.component';
import { SuppliersComponent } from './owner/suppliers.component';
import { OrdersComponent } from './pages/orders.component';
import { OrderDetailComponent } from './pages/order-detail.component';
import { SupplierDashboardComponent } from './supplier/supplier-dashboard.component';
import { ListingsComponent } from './supplier/listings.component';

const owner = roleGuard('BusinessOwner');
const supplier = roleGuard('Supplier');

export const routes: Routes = [
  // signed out
  { path: '', pathMatch: 'full', component: LandingComponent, canActivate: [guestGuard], title: 'IntelliStock' },
  { path: 'login', component: LoginComponent, canActivate: [guestGuard], title: 'Sign in · IntelliStock' },
  { path: 'register', component: RegisterComponent, canActivate: [guestGuard], title: 'Create an account · IntelliStock' },

  // signed in: the shell, then a guard per role
  {
    path: '', component: ShellComponent, canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: OwnerDashboardComponent, canActivate: [owner], title: 'Dashboard · IntelliStock' },
      { path: 'stock', component: StockListComponent, canActivate: [owner], title: 'Stock · IntelliStock' },
      { path: 'stock/:id', component: StockItemComponent, canActivate: [owner], title: 'Item · IntelliStock' },
      { path: 'alerts', component: AlertsComponent, canActivate: [owner], title: 'Alerts · IntelliStock' },
      { path: 'suppliers', component: SuppliersComponent, canActivate: [owner], title: 'Suppliers · IntelliStock' },
      { path: 'orders', component: OrdersComponent, canActivate: [owner], title: 'Orders · IntelliStock' },
      { path: 'orders/:id', component: OrderDetailComponent, canActivate: [owner], title: 'Order · IntelliStock' },
      { path: 'settings', component: SettingsComponent, canActivate: [owner], title: 'Settings · IntelliStock' },

      { path: 'supplier/dashboard', component: SupplierDashboardComponent, canActivate: [supplier], title: 'Dashboard · IntelliStock' },
      { path: 'supplier/listings', component: ListingsComponent, canActivate: [supplier], title: 'Listings · IntelliStock' },
      { path: 'supplier/orders', component: OrdersComponent, canActivate: [supplier], title: 'Orders · IntelliStock' },
      { path: 'supplier/orders/:id', component: OrderDetailComponent, canActivate: [supplier], title: 'Order · IntelliStock' },
      { path: 'supplier/settings', component: SettingsComponent, canActivate: [supplier], title: 'Settings · IntelliStock' },

      { path: 'not-authorised', component: NotAuthorisedComponent, title: 'Not authorised · IntelliStock' },
    ],
  },

  { path: '**', redirectTo: '' },
];
