import { useState } from 'react'
import { api } from '../../lib/api'
import { buildPresetCategories } from './presets'
import { ProgressRing } from './ui'
import IntroVideoStep from './IntroVideoStep'
import { RoleStep, ReasonStep, ReferralStep } from './surveys'
import ProviderChoiceStep, { type ProviderChoice } from './ProviderChoiceStep'
import ProviderSetupStep from './ProviderSetupStep'
import CategoriesStep from './CategoriesStep'
import CompletionStep from './CompletionStep'
import './Onboarding.css'

// Onboarding flow (Windows port). Steps: intro video → role → download reason
// → referral → provider choice → provider setup → categories → completion.

type Step =
  | 'intro'
  | 'role'
  | 'reason'
  | 'referral'
  | 'provider'
  | 'setup'
  | 'categories'
  | 'completion'

const RING_TOTAL = 6
// Filled segments per step; null hides the ring (intro video + provider chooser).
const RING_FILLED: Record<Step, number | null> = {
  intro: null,
  role: 0,
  reason: 1,
  referral: 2,
  provider: null,
  setup: 4,
  categories: 5,
  completion: 6
}

export default function OnboardingFlow(): React.JSX.Element {
  const [step, setStep] = useState<Step>('intro')
  const [provider, setProvider] = useState<ProviderChoice | null>(null)

  const handleRole = (role: string, otherDetail: string): void => {
    void api.categories.save(buildPresetCategories(role))
    void api.settings.set('onboardingSelectedRole', role)
    void api.settings.set('onboardingAppliedCategoryPreset', role)
    if (role === 'Other' && otherDetail) {
      void api.settings.set('onboardingSelectedRoleDetail', otherDetail)
    }
    setStep('reason')
  }

  const handleReasons = (reasons: string[], otherDetail: string): void => {
    void api.settings.set('onboardingDownloadReasons', reasons)
    void api.settings.set('onboardingDownloadReasonOther', otherDetail || undefined)
    setStep('referral')
  }

  const handleReferral = (source: string, detail: string): void => {
    void api.settings.set('onboardingReferralSource', source)
    void api.settings.set('onboardingReferralDetail', detail || undefined)
    setStep('provider')
  }

  const handleProviderSelect = (p: ProviderChoice): void => {
    setProvider(p)
    setStep('setup')
  }

  const ringFilled = RING_FILLED[step]

  if (step === 'intro') {
    return (
      <div className="ob-root intro">
        <IntroVideoStep onDone={() => setStep('role')} />
      </div>
    )
  }

  return (
    <div className="ob-root">
      {step === 'role' && <RoleStep onContinue={handleRole} />}
      {step === 'reason' && <ReasonStep onContinue={handleReasons} />}
      {step === 'referral' && <ReferralStep onContinue={handleReferral} />}
      {step === 'provider' && <ProviderChoiceStep onSelect={handleProviderSelect} />}
      {step === 'setup' && provider !== null && (
        <ProviderSetupStep
          provider={provider}
          onBack={() => setStep('provider')}
          onComplete={() => setStep('categories')}
        />
      )}
      {step === 'categories' && (
        <CategoriesStep onBack={() => setStep('setup')} onNext={() => setStep('completion')} />
      )}
      {step === 'completion' && <CompletionStep provider={provider} />}
      {ringFilled !== null && <ProgressRing total={RING_TOTAL} filled={ringFilled} />}
    </div>
  )
}
