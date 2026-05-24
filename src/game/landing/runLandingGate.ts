import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from '../../firebase.js';
import {
  fetchUserLedger,
  finalizeCharacterSelection,
  type RemoteUserLedger,
  registerNewUser,
  syncProfileNicknameFromGoogleAccount,
} from '../services/rtdbUsers';
import { mergeUserLedgerIntoSession } from '../services/userSession';
import {
  saveNickname,
  saveSelectedCharacterId,
  saveSelectedCharacterSkin,
} from '../services/playerProfile';
import { createKeyedLogoObjectUrl } from '../utils/logoTexture';
import { MAIN_LOGO_ALT, MAIN_LOGO_URL } from '../constants/mainLogo';
import { markBackgroundMusicUnlocked } from '../audio/BackgroundMusic';
import { clearGameUserSession } from '../services/userSession';
import { clearSavedPlayerProfile } from '../services/playerProfile';

/** Set before reload so boot shows email/password login instead of anonymous auto-sign-in. */
export const REQUIRE_LOGIN_AFTER_LOGOUT_KEY = 'sky-climber:require-login';

export function markRequireLoginAfterLogout(): void {
  try {
    sessionStorage.setItem(REQUIRE_LOGIN_AFTER_LOGOUT_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function consumeRequireLoginAfterLogout(): boolean {
  try {
    const flagged = sessionStorage.getItem(REQUIRE_LOGIN_AFTER_LOGOUT_KEY) === '1';
    if (flagged) {
      sessionStorage.removeItem(REQUIRE_LOGIN_AFTER_LOGOUT_KEY);
    }
    return flagged;
  } catch {
    return false;
  }
}

/** Sign out, clear cached profile, reload into the existing login gate. */
export async function logoutAndReturnToLogin(): Promise<void> {
  markRequireLoginAfterLogout();
  try {
    await signOut(auth);
  } catch {
    /* still return to login */
  }
  clearGameUserSession();
  clearSavedPlayerProfile();
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

export const CHARACTER_PRESETS = [
  { id: 'chromatic', label: 'Chromatic', hint: 'Vivid default' },
  { id: 'ember', label: 'Ember', hint: 'Warm trails' },
  { id: 'jade', label: 'Jade', hint: 'Cool focus' },
] as const;

function waitUntilFirstAuthUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

function qs<T extends HTMLElement>(root: HTMLElement, sel: string): T {
  const el = root.querySelector(sel);
  if (!el) {
    throw new Error(`Missing ${sel}`);
  }
  return el as T;
}

function isRegisteredLoginUser(user: User): boolean {
  return !user.isAnonymous;
}

/**
 * Mandatory full-screen gate: persists auth (Firebase), ensures RTDB profile + character flow,
 * then mirrors nickname/character into localStorage for leaderboard + gameplay hints.
 */
export async function runMandatoryLandingGate(root: HTMLElement): Promise<void> {
  await setPersistence(auth, browserLocalPersistence);

  const initialUser = await waitUntilFirstAuthUser();

  const shell = document.createElement('div');
  shell.className = 'sk-landing';
  root.appendChild(shell);

  const settleSession = async (user: User): Promise<void> => {
    await syncProfileNicknameFromGoogleAccount(user);
    let ledger = await fetchUserLedger(user.uid);
    if (!ledger) {
      ledger = await showProfileRepair(shell, user);
    }
    if (ledger.profile.registrationComplete === false) {
      await showCharacterPicker(shell, user);
      ledger = await fetchUserLedger(user.uid);
    }
    if (!ledger) {
      throw new Error('Profile failed to load after setup');
    }
    const session = mergeUserLedgerIntoSession(ledger);
    saveNickname(session.nickname);
    saveSelectedCharacterId(session.selectedCharacterId);
    saveSelectedCharacterSkin(session.selected_character);
  };

  try {
    if (initialUser && isRegisteredLoginUser(initialUser)) {
      await settleSession(initialUser);
    } else {
      if (initialUser?.isAnonymous) {
        try {
          await signOut(auth);
        } catch {
          /* show login anyway */
        }
      }
      await showAuthScreens(shell, settleSession);
    }
  } finally {
    const blobAttr = shell.getAttribute('data-auth-logo-blob-url');
    if (blobAttr?.startsWith('blob:')) {
      URL.revokeObjectURL(blobAttr);
    }
    shell.remove();
  }
}

async function showProfileRepair(shell: HTMLElement, user: User): Promise<RemoteUserLedger> {
  return new Promise((resolve) => {
    shell.innerHTML = `
      <div class="sk-landing__panel">
        <h1 class="sk-landing__title">Complete profile</h1>
        <p class="sk-landing__sub">Set a nickname for the leaderboard.</p>
        <input class="sk-landing__input" type="text" maxlength="20" placeholder="Nickname" autocomplete="username" />
        <button class="sk-landing__btn" type="button" data-action="save">Continue</button>
        <p class="sk-landing__err" data-field="err"></p>
      </div>`;
    const nick = qs<HTMLInputElement>(shell, 'input');
    const err = qs<HTMLElement>(shell, '[data-field="err"]');
    const go = async (): Promise<void> => {
      const v = nick.value.trim();
      if (!v) {
        err.textContent = 'Nickname required';
        return;
      }
      if (!user.email) {
        err.textContent = 'Account has no email on file';
        return;
      }
      try {
        await registerNewUser(user.uid, v, user.email);
        const ledger = await fetchUserLedger(user.uid);
        if (!ledger) {
          throw new Error('Profile write failed');
        }
        resolve(ledger);
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : 'Could not save profile';
      }
    };
    qs<HTMLButtonElement>(shell, '[data-action="save"]').addEventListener('click', () => {
      void go();
    });
    nick.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        void go();
      }
    });
    nick.focus();
  });
}

async function showCharacterPicker(shell: HTMLElement, user: User): Promise<void> {
  return new Promise((resolve) => {
    const cards = CHARACTER_PRESETS.map(
      (c) => `
      <button type="button" class="sk-landing__char" data-id="${c.id}">
        <span class="sk-landing__char-title">${c.label}</span>
        <span class="sk-landing__char-hint">${c.hint}</span>
      </button>`,
    ).join('');
    shell.innerHTML = `
      <div class="sk-landing__panel sk-landing__panel--wide">
        <h1 class="sk-landing__title">Choose your climber</h1>
        <p class="sk-landing__sub">You can change this later in a future update.</p>
        <div class="sk-landing__char-grid">${cards}</div>
        <p class="sk-landing__err" data-field="err"></p>
      </div>`;
    const err = qs<HTMLElement>(shell, '[data-field="err"]');
    for (const btn of shell.querySelectorAll<HTMLButtonElement>('.sk-landing__char')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) {
          return;
        }
        void (async (): Promise<void> => {
          try {
            await finalizeCharacterSelection(user.uid, id);
            resolve();
          } catch (e) {
            err.textContent = e instanceof Error ? e.message : 'Could not save choice';
          }
        })();
      });
    }
  });
}

async function showAuthScreens(
  shell: HTMLElement,
  settleSession: (user: User) => Promise<void>,
): Promise<void> {
  const logoSrc = await createKeyedLogoObjectUrl(MAIN_LOGO_URL);
  if (logoSrc.startsWith('blob:')) {
    shell.setAttribute('data-auth-logo-blob-url', logoSrc);
  }

  shell.innerHTML = `
    <div class="sk-landing__panel">
      <div class="sk-landing__brand" role="img" aria-label="${MAIN_LOGO_ALT}">
        <img class="sk-landing__logo" src="${logoSrc}" alt="${MAIN_LOGO_ALT}" decoding="async" />
      </div>
      <div class="sk-landing__tabs">
        <button type="button" class="sk-landing__tab sk-landing__tab--on" data-tab="login">LOG IN</button>
        <button type="button" class="sk-landing__tab" data-tab="signup">SIGN UP</button>
      </div>
      <div class="sk-landing__form" data-form="login">
        <input class="sk-landing__input" type="email" autocomplete="username" placeholder="Email" />
        <input class="sk-landing__input" type="password" autocomplete="current-password" placeholder="Password" />
        <button class="sk-landing__btn" type="button" data-action="login">Log in</button>
      </div>
      <div class="sk-landing__form" data-form="signup" style="display:none">
        <input class="sk-landing__input" type="email" autocomplete="email" placeholder="Email" />
        <input class="sk-landing__input" type="password" autocomplete="new-password" placeholder="Password (6+ chars)" />
        <input class="sk-landing__input" type="text" maxlength="20" autocomplete="nickname" placeholder="Nickname (leaderboard name)" />
        <button class="sk-landing__btn" type="button" data-action="signup">Create account</button>
      </div>
      <p class="sk-landing__divider">or</p>
      <button class="sk-landing__btn sk-landing__btn--google" type="button" data-action="google">Continue with Google</button>
      <p class="sk-landing__err" data-field="err"></p>
    </div>`;

  const err = qs<HTMLElement>(shell, '[data-field="err"]');
  const tabLogin = qs<HTMLButtonElement>(shell, '[data-tab="login"]');
  const tabSignup = qs<HTMLButtonElement>(shell, '[data-tab="signup"]');
  const formLogin = qs<HTMLElement>(shell, '[data-form="login"]');
  const formSignup = qs<HTMLElement>(shell, '[data-form="signup"]');

  const showTab = (which: 'login' | 'signup'): void => {
    err.textContent = '';
    const loginOn = which === 'login';
    formLogin.style.display = loginOn ? 'grid' : 'none';
    formSignup.style.display = loginOn ? 'none' : 'grid';
    tabLogin.classList.toggle('sk-landing__tab--on', loginOn);
    tabSignup.classList.toggle('sk-landing__tab--on', !loginOn);
  };
  tabLogin.addEventListener('click', () => showTab('login'));
  tabSignup.addEventListener('click', () => showTab('signup'));

  const liEmail = qs<HTMLInputElement>(formLogin, 'input[type="email"]');
  const liPass = qs<HTMLInputElement>(formLogin, 'input[type="password"]');
  const suEmail = qs<HTMLInputElement>(formSignup, 'input[type="email"]');
  const suPass = qs<HTMLInputElement>(formSignup, 'input[type="password"]');
  const suNick = qs<HTMLInputElement>(formSignup, 'input[type="text"]');
  const googleProvider = new GoogleAuthProvider();

  return new Promise<void>((resolve) => {
    qs<HTMLButtonElement>(shell, '[data-action="login"]').addEventListener('click', () => {
      markBackgroundMusicUnlocked();
      void (async (): Promise<void> => {
        err.textContent = '';
        try {
          const cred = await signInWithEmailAndPassword(
            auth,
            liEmail.value.trim(),
            liPass.value,
          );
          await settleSession(cred.user);
          resolve();
        } catch (e) {
          err.textContent = mapAuthErr(e);
        }
      })();
    });

    qs<HTMLButtonElement>(shell, '[data-action="signup"]').addEventListener('click', () => {
      markBackgroundMusicUnlocked();
      void (async (): Promise<void> => {
        err.textContent = '';
        const email = suEmail.value.trim();
        const pass = suPass.value;
        const nick = suNick.value.trim();
        if (!nick) {
          err.textContent = 'Nickname required';
          return;
        }
        if (pass.length < 6) {
          err.textContent = 'Password must be at least 6 characters';
          return;
        }
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, pass);
          await registerNewUser(cred.user.uid, nick, cred.user.email ?? email);
          await settleSession(cred.user);
          resolve();
        } catch (e) {
          err.textContent = mapAuthErr(e);
        }
      })();
    });

    qs<HTMLButtonElement>(shell, '[data-action="google"]').addEventListener('click', () => {
      markBackgroundMusicUnlocked();
      void (async (): Promise<void> => {
        err.textContent = '';
        try {
          const cred = await signInWithPopup(auth, googleProvider);
          await settleSession(cred.user);
          resolve();
        } catch (e) {
          err.textContent = mapAuthErr(e);
        }
      })();
    });
  });
}

function mapAuthErr(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = String((e as { code: string }).code);
    if (code === 'auth/email-already-in-use') {
      return 'That email is already registered — try logging in.';
    }
    if (code === 'auth/invalid-email') {
      return 'Invalid email address.';
    }
    if (code === 'auth/weak-password') {
      return 'Password is too weak (use at least 6 characters).';
    }
    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return 'Invalid email or password.';
    }
    if (code === 'auth/too-many-requests') {
      return 'Too many attempts — wait a minute and retry.';
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Sign-in was cancelled.';
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return 'This email already uses another sign-in method — try email/password.';
    }
    return code.replace('auth/', '').replace(/-/g, ' ');
  }
  return 'Something went wrong. Try again.';
}
