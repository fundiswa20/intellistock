import { Routes } from '@angular/router';
import { authGuard } from './auth';
import { LoginComponent } from './login.component';
import { StockListComponent } from './stock-list.component';
import { StockItemComponent } from './stock-item.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Sign in · IntelliStock' },
  { path: 'stock', component: StockListComponent, canActivate: [authGuard], title: 'Stock · IntelliStock' },
  { path: 'stock/:id', component: StockItemComponent, canActivate: [authGuard], title: 'Item · IntelliStock' },
  { path: '', pathMatch: 'full', redirectTo: 'stock' },
  { path: '**', redirectTo: 'stock' },
];
