import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { API_URL } from './api';

export interface SignedInUser {
  id: number;
  fullName: string;
  email: string;
  role: string;
  businessName: string | null;
}

interface Session { token: string; expiresAt: string; user: SignedInUser; }

const KEY = 'intellistock.session';

// FR-02: the JWT from POST /api/auth/login, kept for this browser tab only
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private session = signal<Session | null>(AuthService.restore());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);

  login(email: string, password: string) {
    return this.http.post<Session>(`${API_URL}/api/auth/login`, { email, password }).pipe(
      tap(s => {
        this.session.set(s);
        try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
      }));
  }

  logout() {
    this.session.set(null);
    try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
    this.router.navigate(['/login']);
  }

  private static restore(): Session | null {
    try {
      const s: Session | null = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
      return s && new Date(s.expiresAt) > new Date() ? s : null;
    } catch { return null; }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const authed = token && req.url.startsWith(API_URL)
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;
  return next(authed).pipe(catchError((err: HttpErrorResponse) => {
    // an expired or rejected token sends the owner back to sign in
    if (err.status === 401 && !req.url.endsWith('/api/auth/login')) auth.logout();
    return throwError(() => err);
  }));
};

export const authGuard: CanActivateFn = () =>
  inject(AuthService).user() ? true : inject(Router).createUrlTree(['/login']);
