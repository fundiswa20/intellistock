// Shared look of the sign-in and register pages: a centred card on the tinted background
export const AUTH_STYLES = `
  .page { min-height: 100vh; display: grid; place-items: center; padding: var(--space-6) var(--space-4); }
  .panel { width: min(440px, 100%); display: grid; gap: var(--space-5); }
  .brand { display: flex; align-items: center; gap: var(--space-3); font-weight: 700; font-size: var(--text-lg);
           color: var(--green-900); text-decoration: none; justify-self: center; }
  .mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--radius);
          background: var(--green-700); color: #fff; font-size: var(--text-xs); }
  .card { padding: var(--space-6); display: grid; gap: var(--space-4); }
  .head { display: grid; gap: var(--space-1); }
  h1 { font-size: var(--text-xl); }
  .head p { color: var(--text-secondary); }
  .notice { margin: 0; }
  .switch { text-align: center; color: var(--text-secondary); font-size: var(--text-sm); }
  .switch a { font-weight: 600; text-decoration: none; }
`;
