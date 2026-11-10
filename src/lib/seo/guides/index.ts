import type { Guide } from '../types';
import { guide as hireAFreelancer } from './hire-a-freelancer';
import { guide as compareFreelancerQuotes } from './compare-freelancer-quotes';
import { guide as freelancerOrAgency } from './freelancer-or-agency';
import { guide as websiteCostFactors } from './website-cost-factors';
import { guide as freelancePricingModels } from './freelance-pricing-models';
import { guide as writeAWinningProposal } from './write-a-winning-proposal';
import { guide as freelanceContractChecklist } from './freelance-contract-checklist';
import { guide as freelanceSitesIsrael } from './freelance-sites-israel';

// Authored guides (each becomes /guides/<slug>). Entries must exist as pages before they are added here.
export const guides: Guide[] = [
  hireAFreelancer,
  compareFreelancerQuotes,
  freelancerOrAgency,
  websiteCostFactors,
  freelancePricingModels,
  writeAWinningProposal,
  freelanceContractChecklist,
  freelanceSitesIsrael,
];
