import { Pipe, PipeTransform } from '@angular/core';
import { money } from '../api';

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(n: number | null | undefined): string { return n === null || n === undefined ? '—' : money(n); }
}
