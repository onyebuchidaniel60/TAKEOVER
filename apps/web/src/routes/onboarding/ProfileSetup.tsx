// Step 3 — Profile setup (Phase 5j). Full name is required (becomes
// provider_profiles.display_name); avatar, bio, DOB, phone, and location
// are optional. "Skip for now" still requires the name and skips only the
// rest. Continue/Skip both save, then POST /me/onboarded, then →
// /onboarding/interests. DOB/phone are private (stored, never public).
//
// Phase 5o-A (D25): a USERNAME is also required here — but only for an
// account that does not already have one. Email signup chose a handle at
// registration; wallet signup never collected one, and without a handle the
// provider row on slot detail has nothing to link to (112 of 115 accounts
// were in exactly that dead state). So: wallet users choose a handle on
// this step, and it is required — D25 makes "completes onboarding" imply
// "has a handle". An existing handle renders disabled, because D26 makes it
// immutable and an editable field that always 409s is worse than no field.
import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Avatar from '../../components/Avatar';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import UsernameField from '../../components/UsernameField';
import OnboardingShell, {
  ONBOARDING_INPUT_CLASS,
  ONBOARDING_LABEL_CLASS,
  ONBOARDING_PRIMARY_CTA_CLASS,
  OnboardingFieldError,
} from '../../components/onboarding/OnboardingShell';
import { ApiError } from '../../lib/api';
import { prepareImage } from '../../lib/image';
import { usePageMeta } from '../../lib/meta';
import { updateMeAvatar, updateProviderProfile, validateDisplayName } from '../../lib/slots';
import {
  setUsername,
  updateUserProfile,
  validateBio,
  validateDob,
  validateLocation,
  validatePhone,
  validateUsernameInput,
} from '../../lib/identity';
import { useAuth } from '../../store/auth';

function todayInput(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function ProfileSetup() {
  // Phase 5k-B: `?from=settings` is an ADDITIVE variant. The Profile page
  // reuses this screen as its Edit form (one form for one set of fields —
  // the standalone display-name form on Profile was a duplicate that could
  // drift). Without the param this is byte-for-byte the onboarding step 2:
  // same copy, same skip, same forward navigation, same markOnboarded.
  const [searchParams] = useSearchParams();
  const isSettings = searchParams.get('from') === 'settings';
  usePageMeta({ title: isSettings ? 'Edit profile — TAKEOVER' : 'Set up your profile — TAKEOVER' });
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const initialized = useAuth((s) => s.initialized);
  const markOnboarded = useAuth((s) => s.markOnboarded);

  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Phase 5o-A: an email user already has a handle (chosen at signup); a
  // wallet user never collected one. `hasHandle` drives BOTH whether the
  // field is required and whether the skip button can bypass it.
  const currentUser = useAuth((s) => s.user);
  const existingUsername = currentUser?.username ?? null;
  const hasHandle = existingUsername !== null && existingUsername !== '';
  const [username, setUsernameValue] = useState(existingUsername ?? '');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  // D25: onboarding cannot be completed without a handle. In settings mode
  // this screen is not the onboarding gate, so the rule does not apply there.
  const usernameRequired = !isSettings && !hasHandle;

  if (!initialized) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8" aria-label="Loading">
        <LoadingSkeleton rows={2} />
      </main>
    );
  }
  if (status !== 'authenticated') {
    // The guard redirects guests to /welcome; render nothing meanwhile.
    return null;
  }

  const nameError = nameTouched ? validateDisplayName(fullName) : null;

  /**
   * Phase 5o-A: claim the handle BEFORE the rest of the save, and only when
   * the account has none. Ordering matters — markOnboarded() (called at the
   * end of saveAll) returns a fresh /me projection, so setting the handle
   * first is what puts it into the refreshed auth store. A separate call
   * rather than a /me/profile field, because the server owns set-once (D26)
   * and answers 409 USERNAME_IMMUTABLE / USERNAME_TAKEN.
   */
  async function saveUsername(): Promise<boolean> {
    if (hasHandle) return true;
    setUsernameTouched(true);
    setUsernameError(null);
    const candidate = username.trim().toLowerCase();
    if (validateUsernameInput(candidate)) {
      return false;
    }
    try {
      await setUsername(candidate);
      return true;
    } catch (err) {
      setUsernameError(err instanceof ApiError ? err.message : 'Something went wrong.');
      return false;
    }
  }

  function handleAvatarFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setAvatarBusy(true);
    void prepareImage(file, 400)
      .then(({ dataUrl }) => setAvatarPreview(dataUrl))
      .catch((err: unknown) => {
        setAvatarError(err instanceof Error ? err.message : 'Something went wrong.');
      })
      .finally(() => setAvatarBusy(false));
  }

async function saveAll(includeOptional: boolean): Promise<boolean> {
    setNameTouched(true);
    setFormError(null);
    const nameProblem = validateDisplayName(fullName);
    if (nameProblem) return false;
    if (
      includeOptional &&
      (validateBio(bio) ?? validatePhone(phone) ?? validateDob(dob) ?? validateLocation(location))
    ) {
      return false;
    }
    // D25: the handle is claimed first, so a rejected handle never leaves a
    // half-saved profile behind (display name written, no handle, onboarding
    // marked done — the exact dead state this phase exists to remove).
    if (!(await saveUsername())) {
      setBusy(false);
      return false;
    }
    setBusy(true);
    try {
      await updateProviderProfile(fullName.trim());
      if (includeOptional && avatarPreview) {
        await updateMeAvatar(avatarPreview);
      }
      if (includeOptional) {
        const patch: { bio?: string | null; phone?: string | null; dob?: string | null; location?: string | null } = {};
        if (bio.trim()) patch.bio = bio.trim();
        if (phone.trim()) patch.phone = phone.trim();
        if (dob.trim()) patch.dob = dob.trim();
        if (location.trim()) patch.location = location.trim();
        if (Object.keys(patch).length > 0) {
          await updateUserProfile(patch);
        }
      }
      await markOnboarded();
      return true;
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
      return false;
    }
  }

  async function handleContinue(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (await saveAll(true)) {
      // Settings mode returns to the profile it was editing; onboarding
      // continues forward to step 3.
      navigate(isSettings ? '/profile' : '/onboarding/interests');
    }
  }

  async function handleSkip(): Promise<void> {
    if (await saveAll(false)) {
      navigate(isSettings ? '/profile' : '/onboarding/interests');
    }
  }

  const bioError = validateBio(bio);
  const phoneError = validatePhone(phone);
  const dobError = validateDob(dob);
  const locationError = validateLocation(location);

  return (
    <OnboardingShell
      step={isSettings ? 'Profile' : 'Step 2 of 3'}
      eyebrow={isSettings ? 'Your profile' : 'Set up your profile'}
      title={isSettings ? 'Edit your profile' : 'What should people call you?'}
supporting={
        isSettings
          ? 'Your name shows on your openings. Everything else is optional.'
          : usernameRequired
            ? 'Your name shows on your openings, and your username is your public link.'
            : 'Your name shows on your openings. Everything else is optional — add it now or later.'
      }
    >
      <form onSubmit={(e) => void handleContinue(e)} noValidate aria-label="Profile setup">
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="profile-name" className={ONBOARDING_LABEL_CLASS}>
              Full name
            </label>
            <input
              id="profile-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              placeholder="Jordan Lee"
              className={ONBOARDING_INPUT_CLASS}
            />
{nameError ? <OnboardingFieldError message={nameError} /> : null}
          </div>

          {/* Phase 5o-A (D25/D26). Sits directly under the name because the
              two are one identity block: the name is what people read, the
              handle is what they can reach. Required for handle-less wallet
              accounts; disabled (pre-filled) once a handle exists. */}
          {hasHandle || usernameRequired ? (
            <UsernameField
              id="profile-username"
              value={username}
              onChange={setUsernameValue}
              onBlur={() => setUsernameTouched(true)}
              disabled={hasHandle}
              touched={usernameTouched}
              serverError={usernameError}
            />
          ) : null}

          <div>
            <span id="profile-avatar-label" className={ONBOARDING_LABEL_CLASS}>
              Profile picture (optional)
            </span>
            <div
              className="flex items-center gap-3"
              role="group"
              aria-labelledby="profile-avatar-label"
            >
              <Avatar data={avatarPreview} name={fullName || '?'} size={48} />
              <button
                type="button"
                disabled={avatarBusy || busy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex min-h-touch items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-body font-medium text-muted disabled:opacity-50"
              >
                {avatarBusy ? 'Preparing…' : avatarPreview ? 'Change picture' : 'Upload picture'}
              </button>
              {avatarPreview ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAvatarPreview(null)}
                  className="inline-flex min-h-touch items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-body font-medium text-muted disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Choose a profile picture"
              onChange={handleAvatarFile}
            />
            {avatarError ? <OnboardingFieldError message={avatarError} /> : null}
          </div>

          <div>
            <label htmlFor="profile-bio" className={ONBOARDING_LABEL_CLASS}>
              Bio (optional)
            </label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A short line about you."
              rows={2}
              maxLength={200}
              className={`${ONBOARDING_INPUT_CLASS} min-h-area`}
            />
            {bioError ? <OnboardingFieldError message={bioError} /> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="profile-dob" className={ONBOARDING_LABEL_CLASS}>
                Birthday (optional, private)
              </label>
              <input
                id="profile-dob"
                type="date"
                value={dob}
                max={todayInput()}
                onChange={(e) => setDob(e.target.value)}
                className={ONBOARDING_INPUT_CLASS}
              />
              {dobError ? <OnboardingFieldError message={dobError} /> : null}
            </div>
            <div>
              <label htmlFor="profile-phone" className={ONBOARDING_LABEL_CLASS}>
                Phone (optional, private)
              </label>
              <input
                id="profile-phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+49 170 000000"
                className={ONBOARDING_INPUT_CLASS}
              />
              {phoneError ? <OnboardingFieldError message={phoneError} /> : null}
            </div>
          </div>

          <div>
            <label htmlFor="profile-location" className={ONBOARDING_LABEL_CLASS}>
              Location (optional)
            </label>
            <input
              id="profile-location"
              type="text"
              autoComplete="address-level2"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Kreuzberg"
              className={ONBOARDING_INPUT_CLASS}
            />
            {locationError ? <OnboardingFieldError message={locationError} /> : null}
          </div>

{formError ? <OnboardingFieldError message={formError} /> : null}
          <button type="submit" disabled={busy} className={ONBOARDING_PRIMARY_CTA_CLASS}>
            {busy ? 'Saving…' : isSettings ? 'Save' : 'Continue'}
          </button>
          {/* D25: while a handle is still required there is nothing to skip —
              offering "Skip for now" would be a control that cannot do what
              it says. The requirement replaces it with the reason, so the
              screen never looks like it is withholding an exit. */}
          {isSettings || !usernameRequired ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSkip()}
              className="min-h-touch w-full py-2 text-center text-body font-medium text-muted"
            >
              {isSettings ? 'Cancel' : 'Skip for now'}
            </button>
          ) : (
            <p className="text-center text-small text-faint">
              A username keeps your profile linkable. Everything else on this
              screen is optional.
            </p>
          )}
        </div>
      </form>
    </OnboardingShell>
  );
}
