// Step 3 — Profile setup (Phase 5j). Full name is required (becomes
// provider_profiles.display_name); avatar, bio, DOB, phone, and location
// are optional. "Skip for now" still requires the name and skips only the
// rest. Continue/Skip both save, then POST /me/onboarded, then →
// /onboarding/interests. DOB/phone are private (stored, never public).
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../../components/Avatar';
import LoadingSkeleton from '../../components/LoadingSkeleton';
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
import { updateUserProfile } from '../../lib/identity';
import { useAuth } from '../../store/auth';

function validateBio(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) return null;
  if (value.length > 160) return 'Keep it to 160 characters or fewer.';
  if (/https?:\/\//i.test(value) || /www\./i.test(value)) return 'Bio must not contain links.';
  return null;
}

function validatePhone(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) return null;
  if (value.length < 3) return 'Phone number looks too short.';
  if (value.length > 32) return 'Phone number must be at most 32 characters.';
  if (!/^[+0-9()\-.\s]+$/.test(value)) return 'Phone number contains invalid characters.';
  return null;
}

function validateDob(input: string): string | null {
  const value = input.trim();
  if (value.length === 0) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Use a valid date.';
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    dt.getUTCFullYear() !== Number(match[1]) ||
    dt.getUTCMonth() !== Number(match[2]) - 1 ||
    dt.getUTCDate() !== Number(match[3])
  ) {
    return 'Use a valid date.';
  }
  if (dt.getTime() > Date.now()) return 'Date of birth must be in the past.';
  return null;
}

function validateLocation(input: string): string | null {
  if (input.trim().length === 0) return null;
  if (input.trim().length > 200) return 'Keep it to 200 characters or fewer.';
  return null;
}

function todayInput(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function ProfileSetup() {
  usePageMeta({ title: 'Set up your profile — TAKEOVER' });
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
      navigate('/onboarding/interests');
    }
  }

  async function handleSkip(): Promise<void> {
    if (await saveAll(false)) {
      navigate('/onboarding/interests');
    }
  }

  const bioError = validateBio(bio);
  const phoneError = validatePhone(phone);
  const dobError = validateDob(dob);
  const locationError = validateLocation(location);

  return (
    <OnboardingShell
      step="Step 2 of 3"
      eyebrow="Set up your profile"
      title="What should people call you?"
      supporting="Your name shows on your openings. Everything else is optional — add it now or later."
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
            {busy ? 'Saving…' : 'Continue'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSkip()}
            className="min-h-touch w-full py-2 text-center text-body font-medium text-muted"
          >
            Skip for now
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}
