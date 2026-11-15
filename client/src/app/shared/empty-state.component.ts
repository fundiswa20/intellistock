import { Component, Input, booleanAttribute } from '@angular/core';
import { IconComponent } from './icon.component';

// Never a blank panel: an icon, one line of explanation, and (projected) an action.
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="empty" [class.compact]="compact">
      <div class="badge" [class.ok]="tone === 'ok'"><app-icon [name]="icon" [size]="22" /></div>
      <h3>{{ title }}</h3>
      @if (text) { <p>{{ text }}</p> }
      <div class="actions"><ng-content /></div>
    </div>
  `,
  styles: [`
    .empty { display: grid; justify-items: center; text-align: center; gap: var(--space-2);
             padding: var(--space-8) var(--space-5); }
    .empty.compact { padding: var(--space-6) var(--space-5); }
    .badge { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--radius-lg);
             background: var(--gray-100); color: var(--gray-600); margin-bottom: var(--space-2); }
    .badge.ok { background: var(--green-50); color: var(--green-700); }
    h3 { font-size: var(--text-md); }
    p { max-width: 380px; color: var(--text-secondary); font-size: var(--text-sm); }
    .actions { margin-top: var(--space-3); display: flex; gap: var(--space-2); }
    .actions:empty { display: none; }
  `],
})
export class EmptyStateComponent {
  @Input() icon = 'inbox';
  @Input() title = '';
  @Input() text = '';
  @Input() tone: 'neutral' | 'ok' = 'neutral';
  @Input({ transform: booleanAttribute }) compact = false;
}
