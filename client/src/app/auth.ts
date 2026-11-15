import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { API_URL } from './api';

export type Role = 'BusinessOwner' | 'Supplier';

export interface SignedInUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  businessName: string | null;
  companyName: string | null;
}

interface Session { token: string; expiresAt: string; user: SignedInUser; }

export interface Registration {
  role: Role;
  fullName: string;
  email: string;
  password: string;
  phone: string | null;
  businessName: string | null;
  location: string | null;
  companyName: string | null;
  deliveryArea: string | null;
}

const KEY = 'intellistock.session';

// where each role lands after signing in
export const HOME: Record<Role, string> = { BusinessOwner: '/dashboard', Supplier: '/supplier/dashboard' };

// FR-01 / FR-02: the JWT from login or registration, kept for this browser tab only
@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private session = signal<Session | null>(AuthService.restore());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);
  readonly role = computed(() => this.user()?.role ?? null);
  readonly home = computed(() => (this.role() ? HOME[this.role()!] : '/'));
  // the shop's or the company's name, whichever this user has
  readonly orgName = computed(() => this.user()?.businessName ?? this.user()?.companyName ?? '');

  login(email: string, password: string) {
    return this.http.post<Session>(`${API_URL}/api/auth/login`, { email, password }).pipe(tap(s => this.store(s)));
  }

  register(r: Registration) {
    return this.http.post<Session>(`${API_URL}/api/auth/register`, r).pipe(tap(s => this.store(s)));
  }

  // after Settings saves, so the header shows the new names
  updateUser(patch: Partial<SignedInUser>) {
    const s = this.session();
    if (s) this.store({ ...s, user: { ...s.user, ...patch } });
  }

  logout() {
    this.session.set(null);
    try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
    this.router.navigate(['/']);
  }

  private store(s: Session) {
    this.session.set(s);
    try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
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
  const router = inject(Router);
  const token = auth.token();
  const authed = token && req.url.startsWith(API_URL)
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;
  return next(authed).pipe(catchError((err: HttpErrorResponse) => {
    const isAuthCall = req.url.includes('/api/auth/');
    // an expired or rejected token sends the user back to sign in
    if (err.status === 401 && !isAuthCall) auth.logout();
    // the API refused this role: the guards should prevent it, so say so plainly
    if (err.status === 403 && !isAuthCall) router.navigate(['/not-authorised']);
    return throwError(() => err);
  }));
};

// signed in, or off to sign in (and back here afterwards)
export const authGuard: CanActivateFn = (_route, state) =>
  inject(AuthService).user()
    ? true
    : inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

// signed in with the right role, or the "not authorised" page
export const roleGuard = (role: Role): CanActivateFn => () => {
  const auth = inject(AuthService);
  if (!auth.user()) return inject(Router).createUrlTree(['/login']);
  return auth.role() === role ? true : inject(Router).createUrlTree(['/not-authorised']);
};

// the landing, sign-in and register pages are for signed-out visitors only
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.user() ? inject(Router).createUrlTree([auth.home()]) : true;
};
