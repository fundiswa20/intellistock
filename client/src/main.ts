import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { InventoryDashboard } from './app/inventory-dashboard.component';

bootstrapApplication(InventoryDashboard, appConfig)
  .catch((err) => console.error(err));
