export interface PillarItem {
  id: string;
  number: number;
  title: string;
  tagline: string;
  belief: string;
  description: string;
  topics: string[];
  realLifePrompt: string;
  themeColor: 'teal' | 'yellow' | 'orange' | 'purple' | 'navy';
  iconName: string;
}

export interface EcosystemBrand {
  id: string;
  name: string;
  subtitle: string;
  badge: string;
  lead: string;
  description: string;
  highlightFeatures: string[];
  actionPrompt: string;
  themeColor: 'teal' | 'yellow' | 'orange' | 'purple' | 'navy';
  locationOrType: string;
}

export interface EpisodeSample {
  id: string;
  title: string;
  runtime: string;
  bayLocation: string;
  storyPremise: string;
  quietLesson: string;
  offlineAction: string;
  tag: string;
  color: string;
}

export interface FaqItem {
  question: string;
  answer: string;
  category: 'content' | 'philosophy' | 'sustainability' | 'starter-kit';
}

export interface LeadFormData {
  email: string;
  parentName: string;
  childAge: string;
  primaryInterest: string;
  newsletterOptIn: boolean;
}
