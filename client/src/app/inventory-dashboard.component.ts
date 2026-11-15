import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// UML: InventoryDashboard - the Angular client's root component. The signed-in layout
// (sidebar, header) lives in ShellComponent; the landing and sign-in pages sit outside it.
@Component({
  selector: 'inventory-dashboard',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class InventoryDashboard {}
